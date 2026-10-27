#!/usr/bin/env python3
"""Narration Studio: a small web interface for local TTS.

Standard library only (plus piper-tts for the Piper engine and ffmpeg).

Environment:
  PORT            port to listen on (default 8080)
  DATA_DIR        outputs, clip cache, Piper voices and settings (default /data)
  CHATTERBOX_URL  chatterbox-tts-api base URL (default http://chatterbox:4123, empty to disable)
  LESSONS_DIR     optional folder with Code Walkthrough lessons (default /lessons)
"""
import email.parser
import email.policy
import json
import mimetypes
import os
import queue
import re
import shutil
import tempfile
import threading
import traceback
import urllib.parse
from datetime import datetime
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import core
from core import StudioError
from engines import describe, load_engines

PORT = int(os.environ.get("PORT", "8080"))
DATA = Path(os.environ.get("DATA_DIR", "/data"))
CHATTERBOX_URL = os.environ.get("CHATTERBOX_URL", "http://chatterbox:4123")
LESSONS = Path(os.environ.get("LESSONS_DIR", "/lessons"))
STATIC = Path(__file__).parent / "static"
MAX_UPLOAD = 60 * 1024 * 1024

OUTPUTS = DATA / "outputs"
CACHE = DATA / "cache"
SETTINGS_FILE = DATA / "settings.json"
for d in (OUTPUTS, CACHE):
    d.mkdir(parents=True, exist_ok=True)

ENGINES = load_engines(DATA, CHATTERBOX_URL, DATA / "piper-voices")

DEFAULT_SETTINGS = {
    "lexicon": "# One per line: word = how to say it\ngetElementById = get element by id\nC# = C sharp\n",
    "last": {},
}

ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,80}$")
VOICE_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 _.-]{0,60}$")
_settings_lock = threading.Lock()
_jobs_lock = threading.RLock()


# ---------------------------------------------------------------------------
# Settings and outputs on disk
# ---------------------------------------------------------------------------

def load_settings():
    with _settings_lock:
        try:
            s = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            s = {}
    return {**DEFAULT_SETTINGS, **s}


def save_settings(update):
    with _settings_lock:
        try:
            s = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            s = dict(DEFAULT_SETTINGS)
        s.update(update)
        tmp = SETTINGS_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(s, indent=2, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, SETTINGS_FILE)
    return s


def out_dir(job_id):
    if not ID_RE.match(job_id or ""):
        raise StudioError("Invalid output id", 404)
    d = OUTPUTS / job_id
    return d


def read_job(job_id):
    path = out_dir(job_id) / "job.json"
    if not path.exists():
        raise StudioError("Output not found", 404)
    with _jobs_lock:
        return json.loads(path.read_text(encoding="utf-8"))


def write_job(job):
    with _jobs_lock:
        d = out_dir(job["id"])
        d.mkdir(parents=True, exist_ok=True)
        job["updated"] = datetime.now().isoformat(timespec="seconds")
        tmp = d / "job.json.tmp"
        tmp.write_text(json.dumps(job, indent=2, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, d / "job.json")


def new_job_id(name):
    base = datetime.now().strftime("%Y%m%d-%H%M") + "-" + core.slugify(name)
    candidate, n = base, 2
    while (OUTPUTS / candidate).exists():
        candidate, n = f"{base}-{n}", n + 1
    return candidate


def list_outputs():
    items = []
    for f in OUTPUTS.glob("*/job.json"):
        try:
            j = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        items.append({k: j.get(k) for k in ("id", "name", "created", "updated", "state", "engine", "voice",
                                            "source", "savedTo", "error")}
                     | {"duration": (j.get("result") or {}).get("duration"), "lines": len(j.get("lines", []))})
    return sorted(items, key=lambda x: x.get("updated") or "", reverse=True)


# ---------------------------------------------------------------------------
# Generation worker
# ---------------------------------------------------------------------------

work = queue.Queue()


def engine_for(job):
    e = ENGINES.get(job["engine"])
    if not e:
        raise StudioError(f"Engine {job['engine']} is not available", 400)
    return e


def clip_path(key):
    return CACHE / f"{key}.wav"


def ensure_clip(engine, job, line):
    params = job.get("params", {})
    key = core.cache_key(engine.id, job["voice"], params, line["spoken"], line.get("variant", 0))
    line["key"] = key
    path = clip_path(key)
    if not path.exists():
        with tempfile.TemporaryDirectory() as tmp:
            raw = Path(tmp) / "raw.wav"
            engine.synth(line["spoken"], job["voice"], params, raw)
            core.normalize_clip(raw, path, trim=True)
    line["duration"] = round(core.wav_duration(path), 3)
    return path


def assemble_job(job):
    clips = [clip_path(l["key"]) for l in job["lines"]]
    t = job.get("timing", {})
    d = out_dir(job["id"])
    timings, total = core.assemble(clips, d / "audio.mp3", lead_in=float(t.get("leadIn", 0.4)),
                                   gap=float(t.get("gap", 0.35)), tail=float(t.get("tail", 0.8)))
    for line, (start, end) in zip(job["lines"], timings):
        line["start"], line["end"] = start, end
    (d / "subtitles.vtt").write_text(core.build_vtt([l["shown"] for l in job["lines"]], timings, total),
                                     encoding="utf-8")
    job["result"] = {"duration": total, "mp3": "audio.mp3", "vtt": "subtitles.vtt"}


def run_job(job_id, action, arg):
    job = read_job(job_id)
    job["state"], job["error"] = "running", None
    lexicon = core.parse_lexicon(load_settings().get("lexicon", ""))
    try:
        engine = engine_for(job)
        if action == "generate":
            todo = list(range(len(job["lines"])))
        else:
            todo = [arg]
        for line in job["lines"]:
            line["spoken"] = core.spoken_text(line["cue"], lexicon)
            line["shown"] = core.shown_text(line["cue"])
        job["progress"] = {"done": 0, "total": len(todo)}
        write_job(job)
        for n, i in enumerate(todo):
            job["progress"]["current"] = i
            write_job(job)
            ensure_clip(engine, job, job["lines"][i])
            job["progress"]["done"] = n + 1
        # Lines not regenerated must still have clips (cache may have been cleared).
        for line in job["lines"]:
            ensure_clip(engine, job, line)
        assemble_job(job)
        job["state"] = "done"
        job["progress"].pop("current", None)
    except StudioError as e:
        job["state"], job["error"] = "error", str(e)
    except Exception as e:  # keep the worker alive
        traceback.print_exc()
        job["state"], job["error"] = "error", f"Unexpected error: {e}"
    write_job(job)


def worker():
    while True:
        job_id, action, arg = work.get()
        try:
            run_job(job_id, action, arg)
        except Exception:
            traceback.print_exc()
        finally:
            work.task_done()


def start_job(payload, job_id=None):
    engine_id = payload.get("engine")
    if engine_id not in ENGINES:
        raise StudioError("Choose a TTS engine", 400)
    voice = (payload.get("voice") or "").strip()
    if not voice:
        raise StudioError("Choose a voice", 400)
    split = payload.get("split", "sentence")
    cues = core.split_text(payload.get("text", ""), split)
    if not cues:
        raise StudioError("Enter some text to narrate", 400)
    if len(cues) > 400:
        raise StudioError("That is more than 400 sentences. Split it into several outputs.", 400)
    name = (payload.get("name") or "").strip() or core.shown_text(cues[0])[:60]

    previous = None
    if job_id:
        try:
            previous = read_job(job_id)
        except StudioError:
            job_id = None
        if previous and previous.get("state") in ("queued", "running"):
            raise StudioError("This output is still being generated", 409)

    # Keep re-rolled variants for lines whose text did not change.
    variants = {}
    if previous and previous.get("engine") == engine_id and previous.get("voice") == voice:
        for l in previous.get("lines", []):
            variants.setdefault(l["cue"], l.get("variant", 0))

    job = previous or {"id": new_job_id(name), "created": datetime.now().isoformat(timespec="seconds")}
    job.update({
        "name": name, "engine": engine_id, "voice": voice,
        "params": {k: v for k, v in (payload.get("params") or {}).items() if isinstance(v, (int, float))},
        "split": split, "text": payload.get("text", ""),
        "timing": {k: float((payload.get("timing") or {}).get(k, d))
                   for k, d in (("leadIn", 0.4), ("gap", 0.35), ("tail", 0.8))},
        "source": payload.get("source") or None,
        "lines": [{"cue": c, "variant": variants.get(c, 0)} for c in cues],
        "state": "queued", "error": None, "result": job.get("result") if previous else None,
    })
    write_job(job)
    save_settings({"last": {"engine": engine_id, "voice": voice, "split": split, "timing": job["timing"],
                            "params": {**load_settings().get("last", {}).get("params", {}), engine_id: job["params"]}}})
    work.put((job["id"], "generate", None))
    return job


def change_line(job_id, index, text=None):
    job = read_job(job_id)
    if job.get("state") in ("queued", "running"):
        raise StudioError("This output is still being generated", 409)
    if not 0 <= index < len(job["lines"]):
        raise StudioError("No such line", 404)
    line = job["lines"][index]
    if text is not None:
        text = " ".join(text.split())
        if not text:
            raise StudioError("A line cannot be empty", 400)
        line["cue"], line["variant"] = text, 0
        job["text"] = "\n".join(l["cue"] for l in job["lines"])
        job["split"] = "line"
    else:
        line["variant"] = int(line.get("variant", 0)) + 1
    job["state"] = "queued"
    write_job(job)
    work.put((job_id, "line", index))
    return job


# ---------------------------------------------------------------------------
# Lessons (Code Walkthrough Player projects)
# ---------------------------------------------------------------------------

def lessons_root():
    return LESSONS if LESSONS.is_dir() else None


def list_lessons():
    root = lessons_root()
    if not root:
        return []
    found = []
    for lj in sorted(root.glob("**/lesson.json")):
        rel = lj.parent.relative_to(root)
        if len(rel.parts) > 4 or any(p.startswith(".") for p in rel.parts):
            continue
        try:
            data = json.loads(lj.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        steps_dir = lj.parent / data.get("stepsDir", "steps")
        steps = []
        for sid in data.get("steps", []):
            meta = {}
            sj = steps_dir / sid / "step.json"
            if sj.exists():
                try:
                    meta = json.loads(sj.read_text(encoding="utf-8"))
                except ValueError:
                    meta = {}
            files = {**data.get("files", {}), **meta.get("files", {})}
            audio = files.get("audio")
            steps.append({"id": sid, "title": meta.get("title", sid),
                          "hasAudio": bool(audio and (steps_dir / sid / audio).exists())})
        found.append({"id": str(rel), "title": data.get("title", str(rel)), "steps": steps})
    return found


def lesson_step_dir(lesson_id, step_id):
    root = lessons_root()
    if not root:
        raise StudioError("No lessons folder is mounted", 404)
    lesson_dir = (root / lesson_id).resolve()
    if root.resolve() not in lesson_dir.parents and lesson_dir != root.resolve():
        raise StudioError("Invalid lesson", 404)
    lj = lesson_dir / "lesson.json"
    if not lj.exists():
        raise StudioError("Lesson not found", 404)
    lesson = json.loads(lj.read_text(encoding="utf-8"))
    if step_id not in lesson.get("steps", []):
        raise StudioError("Step not found", 404)
    return lesson, lesson_dir / lesson.get("stepsDir", "steps") / step_id


def lesson_step_text(lesson_id, step_id):
    lesson, step_dir = lesson_step_dir(lesson_id, step_id)
    meta = json.loads((step_dir / "step.json").read_text(encoding="utf-8")) if (step_dir / "step.json").exists() else {}
    files = {**lesson.get("files", {}), **meta.get("files", {})}
    vtt = step_dir / (files.get("subtitles") or "subtitles.vtt")
    cues = core.parse_vtt(vtt.read_text(encoding="utf-8")) if vtt.exists() else []
    return {"lesson": lesson.get("title"), "step": meta.get("title", step_id), "text": "\n".join(cues),
            "lang": lesson.get("lang")}


def match_owner(path, like):
    try:
        st = like.stat()
        os.chown(path, st.st_uid, st.st_gid)
    except OSError:
        pass


def save_to_lesson(job_id, lesson_id, step_id):
    job = read_job(job_id)
    if job.get("state") != "done":
        raise StudioError("Generate the audio first", 409)
    lesson, step_dir = lesson_step_dir(lesson_id, step_id)
    step_json = step_dir / "step.json"
    meta = json.loads(step_json.read_text(encoding="utf-8")) if step_json.exists() else {}
    files = {**lesson.get("files", {}), **meta.get("files", {})}
    audio_name = "audio.mp3"
    vtt_name = files.get("subtitles") or "subtitles.vtt"
    d = out_dir(job_id)

    shutil.copyfile(d / "audio.mp3", step_dir / audio_name)
    timings = [[l["start"], l["end"]] for l in job["lines"]]
    # Lesson subtitles keep the [[shown|spoken]] markup; the player understands it.
    (step_dir / vtt_name).write_text(core.build_vtt([l["cue"] for l in job["lines"]], timings,
                                                    job["result"]["duration"]), encoding="utf-8")
    if lesson.get("files", {}).get("audio") != audio_name and meta.get("files", {}).get("audio") != audio_name:
        meta.setdefault("files", {})["audio"] = audio_name
        step_json.write_text(json.dumps(meta, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    for f in (step_dir / audio_name, step_dir / vtt_name, step_json):
        if f.exists():
            match_owner(f, step_dir)

    typing = meta.get("typing", {})
    warning = None
    if ("start" in typing or "end" in typing) and "fromCue" not in typing:
        warning = ("This step times its typing in seconds. Switch step.json to "
                   "\"typing\": {\"fromCue\": n, \"toCue\": m} so it follows the new audio.")
    job["savedTo"] = {"lesson": lesson_id, "step": step_id, "at": datetime.now().isoformat(timespec="seconds")}
    write_job(job)
    return {"ok": True, "warning": warning, "path": str(step_dir.relative_to(lessons_root()))}


# ---------------------------------------------------------------------------
# Voice cloning
# ---------------------------------------------------------------------------

def prepare_reference(upload_bytes, filename, trim=True):
    """Convert an uploaded or recorded clip to a clean 24 kHz mono WAV."""
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / ("in" + (Path(filename).suffix or ".bin"))
        src.write_bytes(upload_bytes)
        out = Path(tmp) / "ref.wav"
        filters = []
        if trim:
            t = "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.1"
            filters += [t, "areverse", t, "areverse"]
        filters += ["highpass=f=70", "loudnorm=I=-18:TP=-2:LRA=11"]
        core.ffmpeg(["-i", str(src), "-t", "40", "-af", ",".join(filters), "-ar", "24000", "-ac", "1",
                     "-c:a", "pcm_s16le", str(out)])
        dur = core.wav_duration(out)
        return out.read_bytes(), dur


def clone_voice(fields, files):
    engine = ENGINES.get("chatterbox")
    if not engine:
        raise StudioError("Chatterbox is not configured", 400)
    name = (fields.get("name") or "").strip()
    if not VOICE_NAME_RE.match(name):
        raise StudioError("Use a voice name of letters, digits, spaces, dots, dashes or underscores", 400)
    language = (fields.get("language") or "nl").strip()
    upload = files.get("file")
    if not upload:
        raise StudioError("Add a recording or an audio file", 400)
    data, dur = prepare_reference(upload[1], upload[0], trim=fields.get("trim", "1") != "0")
    if dur < 5:
        raise StudioError(f"The recording is only {dur:.1f} seconds after trimming silence. "
                          "Record at least 10 seconds of speech.", 400)
    engine.clone(name, language, data)
    return {"ok": True, "name": name, "duration": round(dur, 1),
            "note": "Longer than 30 seconds rarely helps." if dur > 30 else None}


def preview(payload):
    engine = ENGINES.get(payload.get("engine"))
    if not engine:
        raise StudioError("Choose a TTS engine", 400)
    voice = payload.get("voice")
    if not voice:
        raise StudioError("Choose a voice", 400)
    lexicon = core.parse_lexicon(load_settings().get("lexicon", ""))
    text = core.spoken_text((payload.get("text") or "").strip()[:500], lexicon)
    if not text:
        raise StudioError("Enter some text to preview", 400)
    params = {k: v for k, v in (payload.get("params") or {}).items() if isinstance(v, (int, float))}
    key = core.cache_key(engine.id, voice, params, text, payload.get("variant", 0))
    path = clip_path(key)
    if not path.exists():
        with tempfile.TemporaryDirectory() as tmp:
            raw = Path(tmp) / "raw.wav"
            engine.synth(text, voice, params, raw)
            core.normalize_clip(raw, path)
    return path


def cache_stats():
    files = list(CACHE.glob("*.wav"))
    return {"files": len(files), "bytes": sum(f.stat().st_size for f in files)}


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------

def parse_multipart(content_type, body):
    msg = email.parser.BytesParser(policy=email.policy.HTTP).parsebytes(
        f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode("utf-8") + body)
    fields, files = {}, {}
    if not msg.is_multipart():
        raise StudioError("Expected a form upload", 400)
    for part in msg.iter_parts():
        name = part.get_param("name", header="content-disposition")
        if not name:
            continue
        filename = part.get_filename()
        payload = part.get_payload(decode=True) or b""
        if filename is not None:
            files[name] = (filename, payload)
        else:
            fields[name] = payload.decode("utf-8", "replace")
    return fields, files


class Handler(BaseHTTPRequestHandler):
    server_version = "NarrationStudio/1.0"

    def log_message(self, fmt, *args):
        if "/api/jobs" in (args[0] if args else "") or "/api/status" in (args[0] if args else ""):
            return  # polling noise
        super().log_message(fmt, *args)

    # -- responses ------------------------------------------------------------

    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_file(self, path, ctype=None, download_name=None, cache="no-cache"):
        path = Path(path)
        if not path.is_file():
            raise StudioError("File not found", 404)
        data = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", ctype or mimetypes.guess_type(path.name)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", cache)
        if download_name:
            quoted = urllib.parse.quote(download_name)
            self.send_header("Content-Disposition", f"attachment; filename*=UTF-8''{quoted}")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def send_bytes(self, data, ctype):
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_UPLOAD:
            raise StudioError("Upload is too large (60 MB maximum)", 413)
        return self.rfile.read(n) if n else b""

    def json_body(self):
        raw = self.body()
        try:
            return json.loads(raw.decode("utf-8")) if raw else {}
        except ValueError:
            raise StudioError("Invalid JSON", 400)

    # -- routing --------------------------------------------------------------

    def do_GET(self):
        self.dispatch("GET")

    def do_HEAD(self):
        self.dispatch("GET")

    def do_POST(self):
        self.dispatch("POST")

    def do_PUT(self):
        self.dispatch("PUT")

    def do_DELETE(self):
        self.dispatch("DELETE")

    def dispatch(self, method):
        url = urllib.parse.urlsplit(self.path)
        path = urllib.parse.unquote(url.path)
        qs = urllib.parse.parse_qs(url.query)
        try:
            self.route(method, path, qs)
        except StudioError as e:
            self.send_json({"error": str(e)}, e.status)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:
            traceback.print_exc()
            self.send_json({"error": f"Unexpected error: {e}"}, 500)

    def route(self, method, path, qs):
        parts = [p for p in path.split("/") if p]

        # Static files
        if method == "GET" and (not parts or parts[0] == "static"):
            target = STATIC / ("index.html" if not parts else "/".join(parts[1:]))
            target = target.resolve()
            if STATIC.resolve() not in target.parents:
                raise StudioError("Not found", 404)
            return self.send_file(target)

        if parts[:1] == ["files"] and method == "GET" and len(parts) == 3:
            d = out_dir(parts[1])
            if parts[2] not in ("audio.mp3", "subtitles.vtt"):
                raise StudioError("Not found", 404)
            name = None
            if "download" in qs:
                job = read_job(parts[1])
                name = core.slugify(job.get("name", parts[1])) + Path(parts[2]).suffix
            ctype = "text/vtt; charset=utf-8" if parts[2].endswith(".vtt") else "audio/mpeg"
            return self.send_file(d / parts[2], ctype, name)

        if parts[:1] != ["api"]:
            raise StudioError("Not found", 404)
        api = parts[1:]

        # ---- status / engines
        if api == ["status"] and method == "GET":
            fresh = "fresh" in qs
            return self.send_json({
                "engines": [{"id": e.id, "name": e.name, "status": e.status(fresh)} for e in ENGINES.values()],
                "lessons": bool(lessons_root()), "queue": work.qsize(), "cache": cache_stats(),
            })
        if api == ["engines"] and method == "GET":
            return self.send_json({"engines": [describe(e) for e in ENGINES.values()]})

        # ---- settings
        if api == ["settings"]:
            if method == "GET":
                return self.send_json(load_settings())
            if method == "PUT":
                body = self.json_body()
                allowed = {k: body[k] for k in ("lexicon",) if k in body}
                return self.send_json(save_settings(allowed))
        if api == ["cache"] and method == "DELETE":
            for f in CACHE.glob("*.wav"):
                f.unlink(missing_ok=True)
            return self.send_json(cache_stats())

        # ---- preview
        if api == ["preview"] and method == "POST":
            path = preview(self.json_body())
            return self.send_file(path, "audio/wav")

        # ---- jobs / outputs
        if api == ["jobs"] and method == "POST":
            body = self.json_body()
            return self.send_json(start_job(body, body.get("id")), 201)
        if api[:1] == ["jobs"] and len(api) == 2 and method == "GET":
            return self.send_json(read_job(api[1]))
        if api == ["outputs"] and method == "GET":
            return self.send_json({"outputs": list_outputs()})
        if api[:1] == ["outputs"] and len(api) == 2 and method == "DELETE":
            d = out_dir(api[1])
            job = read_job(api[1])
            if job.get("state") in ("queued", "running"):
                raise StudioError("Wait until generation has finished", 409)
            shutil.rmtree(d)
            return self.send_json({"ok": True})
        if api[:1] == ["outputs"] and len(api) == 4 and api[2] == "lines":
            index = int(api[3]) if api[3].isdigit() else -1
            if method == "GET":
                job = read_job(api[1])
                if not 0 <= index < len(job["lines"]) or not job["lines"][index].get("key"):
                    raise StudioError("No audio for this line yet", 404)
                return self.send_file(clip_path(job["lines"][index]["key"]), "audio/wav")
            if method == "POST":
                body = self.json_body()
                return self.send_json(change_line(api[1], index, body.get("text") if "text" in body else None))
        if api[:1] == ["outputs"] and len(api) == 3 and api[2] == "save-to-lesson" and method == "POST":
            body = self.json_body()
            return self.send_json(save_to_lesson(api[1], body.get("lesson", ""), body.get("step", "")))

        # ---- voices (Chatterbox library)
        if api == ["voices"]:
            engine = ENGINES.get("chatterbox")
            if method == "GET":
                if not engine:
                    return self.send_json({"voices": [], "languages": {}, "status": None})
                return self.send_json({"voices": engine.voices(), "languages": engine.languages(),
                                       "status": engine.status(True)})
            if method == "POST":
                ctype = self.headers.get("Content-Type", "")
                if "multipart/form-data" not in ctype:
                    raise StudioError("Expected a form upload", 400)
                fields, files = parse_multipart(ctype, self.body())
                return self.send_json(clone_voice(fields, files), 201)
        if api[:1] == ["voices"] and len(api) >= 2:
            engine = ENGINES.get("chatterbox")
            if not engine:
                raise StudioError("Chatterbox is not configured", 404)
            name = api[1]
            if len(api) == 3 and api[2] == "sample" and method == "GET":
                ctype, data = engine.voice_sample(name)
                return self.send_bytes(data, ctype)
            if len(api) == 2 and method == "DELETE":
                engine.delete_voice(name)
                return self.send_json({"ok": True})

        # ---- Piper voices
        if api[:1] == ["piper"]:
            piper = ENGINES["piper"]
            if api == ["piper", "voices"] and method == "GET":
                return self.send_json({"voices": piper.voices(), "installs": piper.installs,
                                       "status": piper.status()})
            if api == ["piper", "catalog"] and method == "GET":
                return self.send_json({"voices": piper.catalog()})
            if len(api) == 3 and api[1] == "voices" and method == "POST":
                piper.install(api[2])
                return self.send_json({"ok": True}, 202)
            if len(api) == 3 and api[1] == "voices" and method == "DELETE":
                piper.remove(api[2])
                return self.send_json({"ok": True})

        # ---- lessons
        if api == ["lessons"] and method == "GET":
            return self.send_json({"mounted": bool(lessons_root()), "lessons": list_lessons()})
        if api == ["lesson-step"] and method == "GET":
            return self.send_json(lesson_step_text(qs.get("lesson", [""])[0], qs.get("step", [""])[0]))

        raise StudioError("Not found", 404)


def recover_interrupted():
    """Jobs that were running when the container stopped are queued again."""
    for f in OUTPUTS.glob("*/job.json"):
        try:
            job = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if job.get("state") in ("queued", "running"):
            job["state"] = "queued"
            write_job(job)
            work.put((job["id"], "generate", None))


def main():
    if not shutil.which("ffmpeg"):
        raise SystemExit("ffmpeg is required")
    threading.Thread(target=worker, daemon=True).start()
    recover_interrupted()
    httpd = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    httpd.daemon_threads = True
    print(f"Narration Studio on port {PORT}. Data in {DATA}. "
          f"Engines: {', '.join(ENGINES)}. Lessons: {LESSONS if lessons_root() else 'not mounted'}", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
