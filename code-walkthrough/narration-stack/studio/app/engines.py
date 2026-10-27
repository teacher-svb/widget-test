"""TTS engines used by Narration Studio.

- ChatterboxEngine: talks to chatterbox-tts-api (GPU container in the same stack).
  Supports voice cloning through its voice library.
- PiperEngine: runs Piper voices in this container on the CPU. Voices are
  downloaded from the rhasspy/piper-voices catalog into the data folder.
- OpenAIEngine: any other server with an OpenAI-style /v1/audio/speech
  endpoint, configured in /data/engines.json (for example Qwen TTS).
"""
import json
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import wave
from pathlib import Path

from core import StudioError

USER_AGENT = "narration-studio/1.0"


def http(method, url, body=None, headers=None, timeout=30):
    req = urllib.request.Request(url, data=body, method=method,
                                 headers={"User-Agent": USER_AGENT, **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.headers.get("Content-Type", ""), resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get("Content-Type", ""), e.read()
    except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
        reason = getattr(e, "reason", e)
        raise StudioError(f"Could not reach {urllib.parse.urlsplit(url).netloc}: {reason}", 502)


def http_json(method, url, payload=None, timeout=30):
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    headers = {"Content-Type": "application/json"} if body else {}
    status, ctype, data = http(method, url, body, headers, timeout)
    try:
        parsed = json.loads(data.decode("utf-8")) if data else {}
    except ValueError:
        parsed = {"raw": data[:300].decode("utf-8", "replace")}
    return status, parsed


def error_message(parsed, fallback):
    """Pull a readable message out of a FastAPI style error body."""
    if isinstance(parsed, dict):
        d = parsed.get("detail", parsed)
        if isinstance(d, dict):
            d = d.get("error", d)
            if isinstance(d, dict):
                return d.get("message") or fallback
        if isinstance(d, str):
            return d
        if isinstance(d, list) and d and isinstance(d[0], dict):
            return d[0].get("msg", fallback)
    return fallback


def multipart(fields, files):
    """Encode multipart/form-data. files: {name: (filename, bytes, content_type)}."""
    boundary = "----studio" + uuid.uuid4().hex
    out = []
    for name, value in fields.items():
        out += [f"--{boundary}", f'Content-Disposition: form-data; name="{name}"', "", str(value)]
    body = "\r\n".join(out).encode("utf-8") + (b"\r\n" if out else b"")
    for name, (filename, data, ctype) in files.items():
        head = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"; filename=\"{filename}\"\r\n"
                f"Content-Type: {ctype}\r\n\r\n").encode("utf-8")
        body += head + data + b"\r\n"
    body += f"--{boundary}--\r\n".encode("utf-8")
    return body, f"multipart/form-data; boundary={boundary}"


# ---------------------------------------------------------------------------
# Chatterbox
# ---------------------------------------------------------------------------

CHATTERBOX_LANGUAGES = {
    "ar": "Arabic", "da": "Danish", "de": "German", "el": "Greek", "en": "English", "es": "Spanish",
    "fi": "Finnish", "fr": "French", "he": "Hebrew", "hi": "Hindi", "it": "Italian", "ja": "Japanese",
    "ko": "Korean", "ms": "Malay", "nl": "Dutch", "no": "Norwegian", "pl": "Polish", "pt": "Portuguese",
    "ru": "Russian", "sv": "Swedish", "sw": "Swahili", "tr": "Turkish", "zh": "Chinese",
}


class ChatterboxEngine:
    id = "chatterbox"
    name = "Chatterbox Multilingual"
    description = "GPU, natural sounding, clones a voice from a short recording"
    can_clone = True
    params = [
        {"key": "exaggeration", "label": "Expressiveness", "min": 0.25, "max": 1.2, "step": 0.05, "default": 0.4,
         "help": "Around 0.3 to 0.5 suits explanations. Higher sounds theatrical."},
        {"key": "cfg_weight", "label": "Pace", "min": 0.0, "max": 1.0, "step": 0.05, "default": 0.5,
         "help": "Lower is slower and more deliberate."},
        {"key": "temperature", "label": "Variation", "min": 0.1, "max": 1.5, "step": 0.05, "default": 0.7,
         "help": "Lower is more consistent between sentences. Re-roll needs some variation."},
    ]

    def __init__(self, base_url):
        self.base = base_url.rstrip("/")
        self._status = None
        self._status_at = 0

    # -- status and voices --------------------------------------------------

    def status(self, fresh=False):
        if not fresh and self._status and time.time() - self._status_at < 10:
            return self._status
        try:
            code, data = http_json("GET", self.base + "/health", timeout=4)
            if code == 200:
                state = str(data.get("status", "healthy")).lower()
                ready = state in ("healthy", "ok", "ready") or data.get("model_loaded") is True
                msg = "Ready" if ready else f"Starting ({state})"
                if data.get("initialization_progress") and not ready:
                    msg = f"Starting: {data['initialization_progress']}"
                self._status = {"online": True, "ready": ready, "message": msg}
            else:
                self._status = {"online": True, "ready": False, "message": f"Health check returned HTTP {code}"}
        except StudioError:
            self._status = {"online": False, "ready": False, "message": f"Not reachable at {self.base}"}
        self._status_at = time.time()
        return self._status

    def voices(self):
        if not self.status()["online"]:
            return []
        code, data = http_json("GET", self.base + "/voices", timeout=8)
        if code != 200:
            return []
        out = []
        for v in data.get("voices", []):
            out.append({"id": v.get("name"), "name": v.get("name"), "language": v.get("language", "en"),
                        "uploaded": v.get("upload_date"), "size": v.get("file_size")})
        return sorted(out, key=lambda v: v["name"].lower())

    def languages(self):
        try:
            code, data = http_json("GET", self.base + "/languages", timeout=5)
            if code == 200 and data.get("languages"):
                return {l["code"]: l["name"] for l in data["languages"]}
        except StudioError:
            pass
        return dict(CHATTERBOX_LANGUAGES)

    def clone(self, name, language, wav_bytes):
        body, ctype = multipart({"voice_name": name, "language": language},
                                {"voice_file": (f"{name}.wav", wav_bytes, "audio/wav")})
        code, _, data = http("POST", self.base + "/voices", body, {"Content-Type": ctype}, timeout=60)
        if code not in (200, 201):
            try:
                parsed = json.loads(data.decode("utf-8"))
            except ValueError:
                parsed = {}
            raise StudioError(error_message(parsed, f"Chatterbox refused the voice (HTTP {code})"), 400)
        self._status_at = 0

    def delete_voice(self, name):
        code, data = http_json("DELETE", self.base + "/voices/" + urllib.parse.quote(name), timeout=15)
        if code != 200:
            raise StudioError(error_message(data, f"Could not delete voice (HTTP {code})"), 400)

    def voice_sample(self, name):
        code, ctype, data = http("GET", self.base + "/voices/" + urllib.parse.quote(name) + "/download", timeout=30)
        if code != 200:
            raise StudioError("Voice sample not found", 404)
        return ctype or "audio/wav", data

    # -- synthesis ----------------------------------------------------------

    def synth(self, text, voice, params, out_path):
        payload = {"input": text, "voice": voice, "response_format": "wav"}
        for p in self.params:
            if p["key"] in params and params[p["key"]] is not None:
                payload[p["key"]] = float(params[p["key"]])
        body = json.dumps(payload).encode("utf-8")
        code, _, data = http("POST", self.base + "/v1/audio/speech", body,
                             {"Content-Type": "application/json"}, timeout=600)
        if code != 200:
            try:
                parsed = json.loads(data.decode("utf-8"))
            except ValueError:
                parsed = {}
            raise StudioError(error_message(parsed, f"Chatterbox returned HTTP {code}"), 502)
        if len(data) < 100:
            raise StudioError("Chatterbox returned no audio", 502)
        Path(out_path).write_bytes(data)


# ---------------------------------------------------------------------------
# Piper
# ---------------------------------------------------------------------------

# Override PIPER_VOICES_BASE to use a mirror of the rhasspy/piper-voices repository.
PIPER_BASE = os.environ.get("PIPER_VOICES_BASE", "https://huggingface.co/rhasspy/piper-voices/resolve/main").rstrip("/")
PIPER_CATALOG_URL = PIPER_BASE + "/voices.json?download=true"
PIPER_FILE_URL = PIPER_BASE + "/{path}?download=true"


class PiperEngine:
    id = "piper"
    name = "Piper"
    description = "CPU, fast, robotic. Good for drafts. No voice cloning"
    can_clone = False
    params = [
        {"key": "speed", "label": "Speed", "min": 0.6, "max": 1.6, "step": 0.05, "default": 1.0,
         "help": "Speaking rate. 1 is the voice's normal speed."},
    ]

    def __init__(self, voices_dir):
        self.dir = Path(voices_dir)
        self.dir.mkdir(parents=True, exist_ok=True)
        self._loaded = {}
        self._lock = threading.Lock()
        self._catalog = None
        self._catalog_at = 0
        self.installs = {}  # key -> {"state", "progress", "error"}
        try:
            import piper  # noqa: F401
            self.available = True
            self.import_error = None
        except Exception as e:  # pragma: no cover - depends on the image
            self.available = False
            self.import_error = str(e)

    def status(self, fresh=False):
        if not self.available:
            return {"online": False, "ready": False, "message": f"piper-tts is not installed: {self.import_error}"}
        n = len(self.voices())
        if n == 0:
            return {"online": True, "ready": False, "message": "No voices installed yet"}
        return {"online": True, "ready": True, "message": f"{n} voice{'s' if n != 1 else ''} installed"}

    def voices(self):
        out = []
        for onnx in sorted(self.dir.glob("*.onnx")):
            cfg = onnx.with_suffix(".onnx.json")
            info = {}
            if cfg.exists():
                try:
                    info = json.loads(cfg.read_text(encoding="utf-8"))
                except ValueError:
                    info = {}
            lang = (info.get("language") or {}).get("code") or onnx.stem.split("-")[0]
            out.append({"id": onnx.stem, "name": onnx.stem, "language": lang,
                        "speakers": len(info.get("speaker_id_map") or {}) or 1,
                        "size": onnx.stat().st_size})
        return out

    def _voice(self, key):
        with self._lock:
            if key not in self._loaded:
                path = self.dir / f"{key}.onnx"
                if not path.exists():
                    raise StudioError(f"Piper voice {key} is not installed", 400)
                from piper import PiperVoice
                self._loaded[key] = PiperVoice.load(str(path))
            return self._loaded[key]

    def synth(self, text, voice, params, out_path):
        if not self.available:
            raise StudioError("Piper is not installed in this container", 500)
        from piper import SynthesisConfig
        v = self._voice(voice)
        speed = float(params.get("speed") or 1.0)
        cfg = SynthesisConfig(length_scale=round(1.0 / max(0.3, speed), 3))
        with self._lock:  # one synthesis at a time per process keeps memory predictable
            with wave.open(str(out_path), "wb") as wav_file:
                v.synthesize_wav(text, wav_file, syn_config=cfg)

    # -- catalog ------------------------------------------------------------

    def catalog(self):
        if self._catalog is None or time.time() - self._catalog_at > 3600:
            code, _, data = http("GET", PIPER_CATALOG_URL, timeout=30)
            if code != 200:
                raise StudioError(f"Could not download the Piper voice list (HTTP {code})", 502)
            self._catalog = json.loads(data.decode("utf-8"))
            self._catalog_at = time.time()
        installed = {v["id"] for v in self.voices()}
        out = []
        for key, v in self._catalog.items():
            lang = v.get("language", {})
            size = sum(f.get("size_bytes", 0) for p, f in v.get("files", {}).items() if p.endswith(".onnx"))
            out.append({
                "id": key, "name": v.get("name", key), "quality": v.get("quality"),
                "language": lang.get("code", key.split("-")[0]),
                "languageName": " / ".join(x for x in (lang.get("name_english"), lang.get("country_english")) if x),
                "speakers": v.get("num_speakers", 1), "size": size, "installed": key in installed,
                "install": self.installs.get(key),
            })
        return sorted(out, key=lambda x: (x["language"], x["name"], x["quality"] or ""))

    def install(self, key):
        if self.installs.get(key, {}).get("state") == "running":
            return
        if self._catalog is None:
            self.catalog()
        entry = self._catalog.get(key)
        if not entry:
            raise StudioError(f"Unknown Piper voice {key}", 404)
        files = [p for p in entry.get("files", {}) if p.endswith((".onnx", ".onnx.json"))]
        if len(files) < 2:
            raise StudioError(f"The catalog entry for {key} has no model files", 502)
        total = sum(entry["files"][p].get("size_bytes", 0) for p in files) or 1
        self.installs[key] = {"state": "running", "progress": 0.0, "error": None}

        def run():
            done = 0
            try:
                for p in files:
                    target = self.dir / Path(p).name
                    tmp = target.with_suffix(target.suffix + ".part")
                    req = urllib.request.Request(PIPER_FILE_URL.format(path=p), headers={"User-Agent": USER_AGENT})
                    with urllib.request.urlopen(req, timeout=60) as resp, open(tmp, "wb") as fh:
                        while True:
                            chunk = resp.read(1 << 16)
                            if not chunk:
                                break
                            fh.write(chunk)
                            done += len(chunk)
                            self.installs[key]["progress"] = min(0.99, done / total)
                    os.replace(tmp, target)
                self.installs[key] = {"state": "done", "progress": 1.0, "error": None}
            except Exception as e:
                for part in self.dir.glob("*.part"):
                    part.unlink(missing_ok=True)
                self.installs[key] = {"state": "error", "progress": 0.0, "error": str(e)}

        threading.Thread(target=run, daemon=True).start()

    def remove(self, key):
        found = False
        for suffix in (".onnx", ".onnx.json"):
            f = self.dir / f"{key}{suffix}"
            if f.exists():
                f.unlink()
                found = True
        with self._lock:
            self._loaded.pop(key, None)
        self.installs.pop(key, None)
        if not found:
            raise StudioError(f"Piper voice {key} is not installed", 404)


# ---------------------------------------------------------------------------
# Other OpenAI-style servers
# ---------------------------------------------------------------------------

class OpenAIEngine:
    can_clone = False
    params = [
        {"key": "speed", "label": "Speed", "min": 0.6, "max": 1.6, "step": 0.05, "default": 1.0,
         "help": "Sent as the speed field. Not every server supports it."},
    ]

    def __init__(self, cfg):
        self.id = cfg["id"]
        self.name = cfg.get("name", self.id)
        self.description = cfg.get("description", "OpenAI-compatible speech server")
        self.base = cfg["baseUrl"].rstrip("/")
        self.path = cfg.get("path", "/v1/audio/speech")
        self.model = cfg.get("model")
        self.voice_list = cfg.get("voices") or ["default"]
        self.language = cfg.get("language", "")
        self.extra = cfg.get("extra", {})
        self.api_key = os.environ.get(cfg["apiKeyEnv"]) if cfg.get("apiKeyEnv") else cfg.get("apiKey")

    def status(self, fresh=False):
        try:
            http("GET", self.base + "/", timeout=4)
            return {"online": True, "ready": True, "message": "Reachable"}
        except StudioError:
            return {"online": False, "ready": False, "message": f"Not reachable at {self.base}"}

    def voices(self):
        return [{"id": v, "name": v, "language": self.language} for v in self.voice_list]

    def synth(self, text, voice, params, out_path):
        payload = {"input": text, "voice": voice, "response_format": "wav", **self.extra}
        if self.model:
            payload["model"] = self.model
        if params.get("speed") and float(params["speed"]) != 1.0:
            payload["speed"] = float(params["speed"])
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        code, _, data = http("POST", self.base + self.path, json.dumps(payload).encode("utf-8"), headers, timeout=600)
        if code != 200 or len(data) < 100:
            raise StudioError(f"{self.name} returned HTTP {code}", 502)
        Path(out_path).write_bytes(data)


def load_engines(data_dir, chatterbox_url, piper_dir):
    engines = {}
    if chatterbox_url:
        engines["chatterbox"] = ChatterboxEngine(chatterbox_url)
    engines["piper"] = PiperEngine(piper_dir)
    extra = Path(data_dir) / "engines.json"
    if extra.exists():
        try:
            for cfg in json.loads(extra.read_text(encoding="utf-8")):
                if cfg.get("id") and cfg.get("baseUrl") and cfg["id"] not in engines:
                    engines[cfg["id"]] = OpenAIEngine(cfg)
        except (ValueError, KeyError, TypeError) as e:
            print(f"warning: could not read {extra}: {e}")
    return engines


def describe(engine, with_voices=True):
    st = engine.status()
    out = {"id": engine.id, "name": engine.name, "description": engine.description,
           "canClone": engine.can_clone, "params": engine.params, "status": st}
    if with_voices:
        try:
            out["voices"] = engine.voices() if st["online"] else []
        except StudioError:
            out["voices"] = []
    return out

