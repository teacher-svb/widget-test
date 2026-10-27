"""Text handling, clip cache and audio assembly for Narration Studio.

The rules match tools/narrate.py in the Code Walkthrough project:
- one clip per subtitle cue, cached by text + engine + voice + settings
- clips are trimmed, joined with fixed pauses, and loudness normalized
- subtitles get the real timings of the generated audio
- [[shown|spoken]] shows the first part and speaks the second
"""
import hashlib
import json
import os
import re
import subprocess
import tempfile
import wave
from pathlib import Path

SAMPLE_RATE = 24000
OVERRIDE_RE = re.compile(r"\[\[([^|\]]*)\|([^\]]*)\]\]")

# Words ending in a period that do not end a sentence (Dutch and English).
ABBREVIATIONS = {
    "bv", "bijv", "o.a", "d.w.z", "enz", "nl", "ca", "vb", "m.a.w", "i.p.v", "t.o.v", "z.g.a", "evt", "resp",
    "e.g", "i.e", "etc", "vs", "dr", "mr", "mrs", "prof", "nr", "fig", "ex",
}


class StudioError(Exception):
    """An error with a message that can be shown to the user as is."""

    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


# ---------------------------------------------------------------------------
# Text
# ---------------------------------------------------------------------------

def _protect(text):
    """Hide [[...]] blocks and code-ish dots so sentence splitting ignores them."""
    stash = []

    def keep(m):
        stash.append(m.group(0))
        return f"\u0000{len(stash) - 1}\u0000"

    text = re.sub(r"\[\[[^\]]*\]\]|`[^`]*`", keep, text)
    return text, stash


def _restore(text, stash):
    return re.sub(r"\u0000(\d+)\u0000", lambda m: stash[int(m.group(1))], text)


def split_sentences(line):
    protected, stash = _protect(line)
    parts, start = [], 0
    for m in re.finditer(r"[.!?…]+[\"'”’)]*\s+", protected):
        end = m.end()
        before = protected[start:m.start()]
        last_word = re.split(r"\s", before)[-1].lower().rstrip(".") if before else ""
        if last_word in ABBREVIATIONS:
            continue
        # Do not split "3. Bla" in numbered lists or "1.5" style numbers.
        if re.fullmatch(r"\d+", last_word):
            continue
        parts.append(protected[start:end].strip())
        start = end
    rest = protected[start:].strip()
    if rest:
        parts.append(rest)
    return [_restore(p, stash) for p in parts if p]


def split_text(text, mode="sentence"):
    """Split text into cues. Blank lines and line breaks always split.
    mode "sentence" also splits each line into sentences."""
    cues = []
    for line in (text or "").replace("\r", "").split("\n"):
        line = " ".join(line.split())
        if not line:
            continue
        cues.extend(split_sentences(line) if mode == "sentence" else [line])
    return cues


def shown_text(cue):
    return OVERRIDE_RE.sub(lambda m: m.group(1), cue)


def spoken_text(cue, lexicon):
    text = OVERRIDE_RE.sub(lambda m: m.group(2), cue)
    text = re.sub(r"<[^>]+>", "", text)
    text = text.replace("`", "")
    text = " ".join(text.split())
    for word in sorted(lexicon or {}, key=len, reverse=True):
        if not word:
            continue
        pattern = r"(?<![\w])" + re.escape(word) + r"(?![\w])"
        text = re.sub(pattern, lambda _m, w=word: lexicon[w], text)
    return text


def parse_lexicon(text):
    """'word = spoken' per line. Lines starting with # are comments."""
    lex = {}
    for line in (text or "").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        word, spoken = line.split("=", 1)
        if word.strip():
            lex[word.strip()] = spoken.strip()
    return lex


def parse_vtt(text):
    cues = []
    for block in re.split(r"\n{2,}", (text or "").replace("\r", "").strip()):
        lines = block.split("\n")
        idx = next((i for i, l in enumerate(lines) if "-->" in l), None)
        if idx is None:
            continue
        cue = "\n".join(lines[idx + 1:]).strip()
        if cue:
            cues.append(" ".join(cue.split()))
    return cues


def fmt_ts(t):
    t = max(0.0, t)
    h = int(t // 3600)
    m = int((t % 3600) // 60)
    s = t - h * 3600 - m * 60
    return (f"{h:02d}:" if h else "") + f"{m:02d}:{s:06.3f}"


def build_vtt(cue_texts, timings, total):
    out = ["WEBVTT", ""]
    for i, (cue, (start, end)) in enumerate(zip(cue_texts, timings)):
        until = timings[i + 1][0] if i + 1 < len(timings) else total
        out += [str(i + 1), f"{fmt_ts(start)} --> {fmt_ts(max(end, until))}", cue, ""]
    return "\n".join(out)


def slugify(text, fallback="narration"):
    text = text.lower()
    for a, b in (("à", "a"), ("á", "a"), ("ä", "a"), ("é", "e"), ("è", "e"), ("ë", "e"), ("ê", "e"),
                 ("ï", "i"), ("í", "i"), ("ö", "o"), ("ó", "o"), ("ü", "u"), ("ú", "u"), ("ç", "c")):
        text = text.replace(a, b)
    text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    return text[:48] or fallback


# ---------------------------------------------------------------------------
# Audio
# ---------------------------------------------------------------------------

def ffmpeg(args, timeout=300):
    proc = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args],
                          capture_output=True, text=True, timeout=timeout)
    if proc.returncode != 0:
        raise StudioError("ffmpeg failed: " + proc.stderr.strip()[-400:], 500)


def normalize_clip(raw, out, trim=True):
    """Convert any audio file to mono 24 kHz 16-bit WAV, trimming silence at both ends."""
    args = ["-i", str(raw)]
    if trim:
        t = "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05"
        args += ["-af", ",".join([t, "areverse", t, "areverse"])]
    tmp = str(out) + ".tmp.wav"
    args += ["-ar", str(SAMPLE_RATE), "-ac", "1", "-c:a", "pcm_s16le", tmp]
    ffmpeg(args)
    os.replace(tmp, out)


def wav_duration(path):
    with wave.open(str(path), "rb") as w:
        return w.getnframes() / float(w.getframerate())


def wav_frames(path):
    with wave.open(str(path), "rb") as w:
        if w.getframerate() != SAMPLE_RATE or w.getnchannels() != 1 or w.getsampwidth() != 2:
            raise StudioError(f"unexpected clip format in {path}", 500)
        return w.readframes(w.getnframes())


def silence(seconds):
    return b"\x00\x00" * int(round(max(0.0, seconds) * SAMPLE_RATE))


def assemble(clips, out_mp3, lead_in=0.4, gap=0.35, tail=0.8, loudnorm=True, quality=4):
    """Join clips into one MP3. Returns (timings, total_seconds)."""
    frames = [silence(lead_in)]
    t = lead_in
    timings = []
    for i, clip in enumerate(clips):
        data = wav_frames(clip)
        dur = len(data) / 2 / SAMPLE_RATE
        timings.append([round(t, 3), round(t + dur, 3)])
        frames.append(data)
        t += dur
        if i < len(clips) - 1:
            frames.append(silence(gap))
            t += gap
    frames.append(silence(tail))
    total = t + tail
    with tempfile.TemporaryDirectory() as tmp:
        joined = Path(tmp) / "joined.wav"
        with wave.open(str(joined), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(SAMPLE_RATE)
            w.writeframes(b"".join(frames))
        args = ["-i", str(joined)]
        if loudnorm:
            args += ["-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ar", str(SAMPLE_RATE)]
        tmp_out = str(out_mp3) + ".tmp.mp3"
        args += ["-codec:a", "libmp3lame", "-qscale:a", str(quality), tmp_out]
        ffmpeg(args)
        os.replace(tmp_out, out_mp3)
    return timings, round(total, 3)


def cache_key(engine_id, voice, params, text, variant=0):
    blob = json.dumps({"e": engine_id, "v": voice, "p": params, "t": text, "n": variant},
                      sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:24]
