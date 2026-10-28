#!/usr/bin/env python3
"""Generate narration audio for lesson steps from their subtitles.

For every step it:
  1. reads the cue texts from subtitles.vtt (the timings in the file are ignored)
  2. turns each cue into speech with a local TTS engine, caching every clip
     so only new or changed sentences are generated
  3. joins the clips with short pauses into audio.mp3
  4. rewrites subtitles.vtt with the real timings

Typing in step.json should use cue numbers ("typing": {"fromCue": 1, "toCue": 3})
so it stays in sync after the timings change.

Usage:
  python3 tools/narrate.py lessons/my-lesson
  python3 tools/narrate.py lessons/my-lesson --steps 02-style 03-behavior
  python3 tools/narrate.py lessons/my-lesson --profile piper     # quick draft voice
  python3 tools/narrate.py lessons/my-lesson --dry-run           # show what would be generated
  python3 tools/narrate.py lessons/my-lesson --force             # ignore the cache

Settings come from narration.json (searched from the lesson folder upwards), and
can be overridden per lesson with a "narration" object in lesson.json.

A profile with "engine": "studio" sends each step to Narration Studio instead,
which then does the generation (with its own models, cache and pronunciation list).

Only the Python standard library is needed, plus ffmpeg for the local engines.
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import wave
from pathlib import Path

SAMPLE_RATE = 24000

DEFAULTS = {
    "engine": "openai",
    "path": "/v1/audio/speech",
    "speed": 1.0,
    "leadIn": 0.4,
    "gap": 0.35,
    "tail": 0.8,
    "trimSilence": True,
    "loudnorm": True,
    "mp3Quality": 4,
    "output": "audio.mp3",
    "cacheDir": ".narration-cache",
    "timeout": 600,
    "lexicon": {},
}

# Settings that change the sound of a clip. Everything else (URLs, keys,
# timeouts) can change without regenerating audio.
CACHE_KEYS = ["engine", "model", "voice", "speed", "extra", "command", "responseFormat", "trimSilence"]

OVERRIDE_RE = re.compile(r"\[\[([^|\]]*)\|([^\]]*)\]\]")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def die(msg):
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(1)


def find_config(start: Path, explicit: str | None) -> Path:
    if explicit:
        p = Path(explicit)
        if not p.exists():
            die(f"config file {p} not found")
        return p
    for d in [start, *start.parents]:
        if (d / "narration.json").exists():
            return d / "narration.json"
    die("narration.json not found in the lesson folder or any parent folder. "
        "Copy narration.example.json to narration.json and edit it.")


def resolve_settings(config: dict, lesson: dict, profile_name: str | None):
    profiles = config.get("profiles", {})
    lesson_over = dict(lesson.get("narration", {}))
    name = profile_name or lesson_over.pop("profile", None) or config.get("default")
    lesson_over.pop("profile", None)
    if not name or name not in profiles:
        die(f"profile '{name}' not found. Available: {', '.join(profiles) or 'none'}")
    s = dict(DEFAULTS)
    lexicon = {}
    for layer in (config.get("settings", {}), profiles[name], lesson_over):
        lexicon.update(layer.get("lexicon", {}))
        s.update({k: v for k, v in layer.items() if k != "lexicon"})
    s["lexicon"] = lexicon
    return name, s


def parse_vtt(text: str):
    cues = []
    for block in re.split(r"\n{2,}", text.replace("\r", "").strip()):
        lines = block.split("\n")
        idx = next((i for i, l in enumerate(lines) if "-->" in l), None)
        if idx is None:
            continue
        cue_text = "\n".join(lines[idx + 1:]).strip()
        if cue_text:
            cues.append(cue_text)
    return cues


def fmt_ts(t: float) -> str:
    t = max(0.0, t)
    h = int(t // 3600)
    m = int((t % 3600) // 60)
    s = t - h * 3600 - m * 60
    return (f"{h:02d}:" if h else "") + f"{m:02d}:{s:06.3f}"


def spoken_text(cue: str, lexicon: dict) -> str:
    # [[shown|spoken]] lets a single cue say something different from what it shows.
    text = OVERRIDE_RE.sub(lambda m: m.group(2), cue)
    text = re.sub(r"<[^>]+>", "", text)  # VTT voice/style tags
    text = " ".join(text.split())
    for word in sorted(lexicon, key=len, reverse=True):
        pattern = r"(?<![\w])" + re.escape(word) + r"(?![\w])"
        text = re.sub(pattern, lexicon[word], text)
    return text


def cache_key(settings: dict, text: str) -> str:
    relevant = {k: settings.get(k) for k in CACHE_KEYS}
    blob = json.dumps({"s": relevant, "t": text}, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:24]


def run_ffmpeg(args):
    proc = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args],
                          capture_output=True, text=True)
    if proc.returncode != 0:
        die("ffmpeg failed: " + proc.stderr.strip())


# ---------------------------------------------------------------------------
# TTS engines
# ---------------------------------------------------------------------------

def synth_openai(text: str, s: dict, out: Path):
    """OpenAI-style POST {baseUrl}{path} returning audio bytes.

    Works with chatterbox-tts-api and other OpenAI-compatible speech servers.
    """
    if not s.get("baseUrl"):
        die("profile has no baseUrl")
    body = {"input": text}
    if s.get("model"):
        body["model"] = s["model"]
    if s.get("voice"):
        body["voice"] = s["voice"]
    if s.get("responseFormat"):
        body["response_format"] = s["responseFormat"]
    if s.get("speed", 1.0) != 1.0:
        body["speed"] = s["speed"]
    body.update(s.get("extra", {}))
    headers = {"Content-Type": "application/json"}
    key = s.get("apiKey") or (os.environ.get(s["apiKeyEnv"]) if s.get("apiKeyEnv") else None)
    if key:
        headers["Authorization"] = f"Bearer {key}"
    req = urllib.request.Request(s["baseUrl"].rstrip("/") + s["path"],
                                 data=json.dumps(body).encode("utf-8"), headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=s["timeout"]) as resp:
            data = resp.read()
    except urllib.error.HTTPError as e:
        die(f"TTS server returned HTTP {e.code}: {e.read().decode('utf-8', 'replace')[:500]}")
    except urllib.error.URLError as e:
        die(f"could not reach the TTS server at {s['baseUrl']}: {e.reason}")
    if len(data) < 100:
        die(f"TTS server returned no audio for: {text!r}")
    out.write_bytes(data)


def synth_command(text: str, s: dict, out: Path):
    """Run any command. Placeholders: {out} output file, {text} the text,
    {text_file} a file containing the text. The text is also sent on stdin."""
    cmd = s.get("command")
    if not cmd or not isinstance(cmd, list):
        die("profile with engine 'command' needs a \"command\" list")
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False, encoding="utf-8") as tf:
        tf.write(text)
        text_file = tf.name
    try:
        args = [part.format(out=str(out), text=text, text_file=text_file, speed=s.get("speed", 1.0),
                            length_scale=round(1 / float(s.get("speed", 1.0)), 3))
                for part in cmd]
        proc = subprocess.run(args, input=text, capture_output=True, text=True, timeout=s["timeout"])
    except FileNotFoundError:
        die(f"command not found: {cmd[0]}")
    finally:
        os.unlink(text_file)
    if proc.returncode != 0 or not out.exists():
        die(f"TTS command failed ({proc.returncode}): {proc.stderr.strip()[:500]}")


ENGINES = {"openai": synth_openai, "command": synth_command}


# ---------------------------------------------------------------------------
# Main work
# ---------------------------------------------------------------------------

def clip_for(text: str, s: dict, cache_dir: Path, force: bool) -> Path:
    """Return a normalized mono 24 kHz WAV for `text`, generating it if needed."""
    path = cache_dir / f"{cache_key(s, text)}.wav"
    if path.exists() and not force:
        return path
    engine = ENGINES.get(s["engine"])
    if not engine:
        die(f"unknown engine '{s['engine']}'. Use one of: {', '.join(ENGINES)}")
    with tempfile.TemporaryDirectory() as tmp:
        # .wav so tools that pick a format from the file name write WAV;
        # ffmpeg detects the real format when reading it back.
        raw = Path(tmp) / "raw.wav"
        engine(text, s, raw)
        filters = []
        if s["trimSilence"]:
            trim = "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05"
            filters = [trim, "areverse", trim, "areverse"]
        args = ["-i", str(raw)]
        if filters:
            args += ["-af", ",".join(filters)]
        args += ["-ar", str(SAMPLE_RATE), "-ac", "1", "-c:a", "pcm_s16le", str(path) + ".tmp.wav"]
        run_ffmpeg(args)
        os.replace(str(path) + ".tmp.wav", path)
    return path


def wav_frames(path: Path) -> bytes:
    with wave.open(str(path), "rb") as w:
        return w.readframes(w.getnframes())


def silence(seconds: float) -> bytes:
    return b"\x00\x00" * int(round(seconds * SAMPLE_RATE))


def narrate_step(step_dir: Path, lesson: dict, s: dict, cache_dir: Path, args) -> bool:
    files = {**lesson.get("files", {})}
    step_json_path = step_dir / "step.json"
    meta = json.loads(step_json_path.read_text()) if step_json_path.exists() else {}
    files.update(meta.get("files", {}))
    vtt_path = step_dir / (files.get("subtitles") or "subtitles.vtt")
    if not vtt_path.exists():
        print(f"  {step_dir.name}: no subtitles, skipped")
        return False

    cues = parse_vtt(vtt_path.read_text(encoding="utf-8"))
    if not cues:
        print(f"  {step_dir.name}: subtitles contain no cues, skipped")
        return False

    spoken = [spoken_text(c, s["lexicon"]) for c in cues]
    missing = [t for t in spoken if args.force or not (cache_dir / f"{cache_key(s, t)}.wav").exists()]

    if args.dry_run:
        print(f"  {step_dir.name}: {len(cues)} cues, {len(cues) - len(missing)} cached, {len(missing)} to generate")
        for t in missing:
            print(f"      + {t}")
        return False

    print(f"  {step_dir.name}: {len(cues)} cues, generating {len(missing)}")
    clips = []
    for i, text in enumerate(spoken, 1):
        clip = clip_for(text, s, cache_dir, args.force)
        clips.append(clip)
        if text in missing:
            print(f"      {i}/{len(spoken)} {text[:70]}")

    # Build the timeline and the joined audio.
    frames = [silence(s["leadIn"])]
    t = s["leadIn"]
    timings = []
    for i, clip in enumerate(clips):
        data = wav_frames(clip)
        dur = len(data) / 2 / SAMPLE_RATE
        timings.append([t, t + dur])
        frames.append(data)
        t += dur
        if i < len(clips) - 1:
            frames.append(silence(s["gap"]))
            t += s["gap"]
    frames.append(silence(s["tail"]))
    total = t + s["tail"]

    output_name = s["output"]
    with tempfile.TemporaryDirectory() as tmp:
        joined = Path(tmp) / "joined.wav"
        with wave.open(str(joined), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(SAMPLE_RATE)
            w.writeframes(b"".join(frames))
        ff = ["-i", str(joined)]
        if s["loudnorm"]:
            ff += ["-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ar", str(SAMPLE_RATE)]
        ff += ["-codec:a", "libmp3lame", "-qscale:a", str(s["mp3Quality"]), str(step_dir / output_name)]
        run_ffmpeg(ff)

    finish_step(step_json_path, meta, lesson, vtt_path, cues, timings, total, output_name)
    return True


def finish_step(step_json_path, meta, lesson, vtt_path, cues, timings, total, output_name):
    """Write subtitles with the real timings and point the step at its audio."""
    # Same text (markup kept), real timings. Each cue stays visible until the next starts.
    out = ["WEBVTT", ""]
    for i, (cue, (start, end)) in enumerate(zip(cues, timings)):
        shown_until = timings[i + 1][0] if i + 1 < len(timings) else total
        out += [str(i + 1), f"{fmt_ts(start)} --> {fmt_ts(max(end, shown_until))}", cue, ""]
    vtt_path.write_text("\n".join(out), encoding="utf-8")

    lesson_audio = lesson.get("files", {}).get("audio")
    if lesson_audio != output_name and meta.get("files", {}).get("audio") != output_name:
        meta.setdefault("files", {})["audio"] = output_name
        step_json_path.write_text(json.dumps(meta, indent=2, ensure_ascii=False) + "\n")

    print(f"      wrote {output_name} ({total:.1f}s) and updated {vtt_path.name}")


# ---------------------------------------------------------------------------
# Narration Studio as the engine: one job per step
# ---------------------------------------------------------------------------

class Studio:
    """Small client for the Narration Studio HTTP API (see the narration stack README)."""

    def __init__(self, s):
        if not s.get("baseUrl"):
            die("the studio profile needs a baseUrl, for example http://192.168.50.203:8090")
        self.base = s["baseUrl"].rstrip("/")
        self.timeout = s["timeout"]

    def call(self, method, path, payload=None, raw=False, timeout=60):
        body = json.dumps(payload).encode("utf-8") if payload is not None else None
        req = urllib.request.Request(self.base + path, data=body, method=method,
                                     headers={"Content-Type": "application/json"} if body else {})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = resp.read()
        except urllib.error.HTTPError as e:
            try:
                msg = json.loads(e.read().decode("utf-8")).get("error")
            except ValueError:
                msg = None
            die(f"Narration Studio: {msg or f'HTTP {e.code} for {path}'}")
        except urllib.error.URLError as e:
            die(f"could not reach Narration Studio at {self.base}: {e.reason}")
        return data if raw else json.loads(data.decode("utf-8"))

    def check(self, engine_id, voice):
        engines = {e["id"]: e for e in self.call("GET", "/api/engines")["engines"]}
        if engine_id not in engines:
            die(f"the studio has no model '{engine_id}'. Available: {', '.join(engines)}")
        e = engines[engine_id]
        if not e["status"].get("ready"):
            die(f"{e['name']} is not ready: {e['status'].get('message')}")
        ids = [v["id"] for v in e.get("voices", [])]
        if voice not in ids:
            names = ", ".join(f"{v['name']} ({v['id']})" if v["name"] != v["id"] else v["id"] for v in e.get("voices", []))
            die(f"{e['name']} has no voice '{voice}'. Available: {names or 'none'}")
        return e


def studio_jobs_file(cache_dir):
    return cache_dir / "studio-jobs.json"


def narrate_step_studio(step_dir, lesson_dir, lesson, s, cache_dir, studio, args):
    files = {**lesson.get("files", {})}
    step_json_path = step_dir / "step.json"
    meta = json.loads(step_json_path.read_text()) if step_json_path.exists() else {}
    files.update(meta.get("files", {}))
    vtt_path = step_dir / (files.get("subtitles") or "subtitles.vtt")
    if not vtt_path.exists():
        print(f"  {step_dir.name}: no subtitles, skipped")
        return False
    cues = parse_vtt(vtt_path.read_text(encoding="utf-8"))
    if not cues:
        print(f"  {step_dir.name}: subtitles contain no cues, skipped")
        return False

    # narration.json's lexicon and [[shown|spoken]] are applied here; the studio
    # then applies its own pronunciation list on top.
    spoken = [spoken_text(c, s["lexicon"]) for c in cues]
    if args.dry_run:
        print(f"  {step_dir.name}: {len(cues)} cues would be sent to the studio")
        return False

    # Reuse the same studio output per step: unchanged sentences come from the
    # studio's cache, retakes made in the studio are kept, and the Library
    # gets one entry per step instead of one per run.
    jobs_path = studio_jobs_file(cache_dir)
    try:
        jobs = json.loads(jobs_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        jobs = {}
    key = f"{lesson_dir.name}/{step_dir.name}"
    title = f"{lesson.get('title', lesson_dir.name)}, {meta.get('title', step_dir.name)}"
    payload = {
        "id": jobs.get(key),
        "engine": s["model"], "voice": s["voice"], "voiceLabel": s.get("voiceLabel", ""),
        "params": s.get("params", {}), "split": "line", "text": "\n".join(spoken), "name": title,
        "timing": {"leadIn": s["leadIn"], "gap": s["gap"], "tail": s["tail"]},
    }
    job = studio.call("POST", "/api/jobs", payload)
    jobs[key] = job["id"]
    jobs_path.write_text(json.dumps(jobs, indent=2), encoding="utf-8")
    print(f"  {step_dir.name}: {len(cues)} cues sent to the studio (output {job['id']})")

    started, last = time.time(), None
    while job["state"] in ("queued", "running"):
        if time.time() - started > s["timeout"]:
            die(f"the studio did not finish within {s['timeout']} seconds")
        time.sleep(1)
        job = studio.call("GET", f"/api/jobs/{job['id']}")
        prog = job.get("progress") or {}
        line = f"{prog.get('done', 0)}/{prog.get('total', '?')}"
        if job["state"] == "running" and line != last:
            print(f"      generating {line}")
            last = line
    if job["state"] != "done":
        die(f"the studio could not narrate {step_dir.name}: {job.get('error')}")
    if len(job["lines"]) != len(cues):
        die(f"the studio returned {len(job['lines'])} lines for {len(cues)} cues in {step_dir.name}")

    output_name = s["output"]
    audio = studio.call("GET", f"/files/{job['id']}/audio.mp3", raw=True, timeout=300)
    (step_dir / output_name).write_bytes(audio)
    timings = [[l["start"], l["end"]] for l in job["lines"]]
    finish_step(step_json_path, meta, lesson, vtt_path, cues, timings, job["result"]["duration"], output_name)

    if not s.get("keepOutputs", True):
        studio.call("DELETE", f"/api/outputs/{job['id']}")
        jobs.pop(key, None)
        jobs_path.write_text(json.dumps(jobs, indent=2), encoding="utf-8")
    return True


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("lesson", help="lesson folder, for example lessons/clicker-button")
    ap.add_argument("--steps", nargs="+", help="only these step ids")
    ap.add_argument("--profile", help="profile from narration.json (overrides the lesson and the default)")
    ap.add_argument("--config", help="path to narration.json")
    ap.add_argument("--dry-run", action="store_true", help="show what would be generated, do not call the TTS engine")
    ap.add_argument("--force", action="store_true", help="regenerate every clip, ignoring the cache")
    args = ap.parse_args()

    lesson_dir = Path(args.lesson).resolve()
    lesson_file = lesson_dir / "lesson.json"
    if not lesson_file.exists():
        die(f"{lesson_file} not found")
    lesson = json.loads(lesson_file.read_text())

    config_path = find_config(lesson_dir, args.config)
    config = json.loads(config_path.read_text())
    profile, s = resolve_settings(config, lesson, args.profile)

    use_studio = s["engine"] == "studio"
    if not args.dry_run and not use_studio and not shutil.which("ffmpeg"):
        die("ffmpeg is not installed or not on PATH")
    studio = None
    if use_studio:
        for k in ("model", "voice"):
            if not s.get(k):
                die(f"the studio profile needs \"{k}\" (model is the studio's model id, for example babbeldoos)")
        studio = Studio(s)
        e = studio.check(s["model"], s["voice"])
        s.setdefault("voiceLabel", next((v["name"] for v in e["voices"] if v["id"] == s["voice"]), s["voice"]))
        if args.force:
            print("note: --force has no effect with the studio; use Generate again in the studio for a new take")

    cache_dir = Path(s["cacheDir"])
    if not cache_dir.is_absolute():
        cache_dir = config_path.parent / cache_dir
    cache_dir = cache_dir / profile
    cache_dir.mkdir(parents=True, exist_ok=True)

    step_ids = lesson["steps"]
    if args.steps:
        unknown = [x for x in args.steps if x not in step_ids]
        if unknown:
            die(f"unknown step(s): {', '.join(unknown)}")
        step_ids = [x for x in step_ids if x in args.steps]

    steps_dir = lesson_dir / lesson.get("stepsDir", "steps")
    print(f"{lesson.get('title', lesson_dir.name)}  (profile: {profile}, voice: {s.get('voice', '-')})")
    done = 0
    for sid in step_ids:
        if use_studio:
            ok = narrate_step_studio(steps_dir / sid, lesson_dir, lesson, s, cache_dir, studio, args)
        else:
            ok = narrate_step(steps_dir / sid, lesson, s, cache_dir, args)
        if ok:
            done += 1
    if not args.dry_run:
        print(f"Done: {done} step(s) narrated.")


if __name__ == "__main__":
    main()
