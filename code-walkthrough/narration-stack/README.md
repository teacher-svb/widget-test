# Narration stack

A Dockge stack with two containers:

- **chatterbox**: [Chatterbox Multilingual](https://github.com/travisvn/chatterbox-tts-api) on the GPU. Natural sounding Dutch, voice cloning from a short recording.
- **studio**: Narration Studio, a web interface on top of it. It also runs **Piper** on the CPU for fast draft voices.

In the studio you can:

- **clone a voice**: record in the browser or upload a file, which is trimmed, normalized and added to the Chatterbox voice library
- **pick a TTS model and voice**: Chatterbox voices, Piper voices downloaded from the catalog, or any other OpenAI-style server
- **type or paste text**: every sentence (or line) becomes one subtitle and one clip
- **get MP3 and subtitles**: listen on a waveform with one region per sentence, generate a single sentence again, edit one sentence, and download `audio.mp3` and `subtitles.vtt`
- **save straight into a Code Walkthrough lesson step**, when the lessons folder is mounted

## Install

On the homelab, in Dockge's stacks folder (often `/opt/stacks`):

```bash
cd /opt/stacks
unzip narration-stack.zip            # creates narration-stack/
cd narration-stack
git clone https://github.com/travisvn/chatterbox-tts-api.git
cp .env.example .env                 # set the ports and the lessons path
```

Then open Dockge. The stack shows up as **narration-stack**. Press **Start**. The first start takes a while:

- the Chatterbox image installs PyTorch with CUDA (several GB)
- Chatterbox then downloads the model on its first run (`docker logs -f narration-chatterbox`)

Open the studio at `http://<homelab>:8090`. The status chips at the top turn green when the models are ready.

### GPU

The GPU reservation in `compose.yaml` is the standard Docker Compose format, the same thing ComfyUI needs. If Chatterbox starts but runs on the CPU (very slow), check that the NVIDIA Container Toolkit (or the TrueNAS SCALE NVIDIA support) is active for Docker.

Chatterbox Multilingual is small enough to stay loaded next to ComfyUI and Qwen TTS on a 16 GB card in most cases. If a big ComfyUI job runs out of memory, stop the chatterbox container while it runs.

### Recording in the browser

Browsers only allow the microphone on HTTPS (or `localhost`). On plain `http://homelab:8090` the Record button is disabled and you upload a recording instead. To record directly, put the studio behind your reverse proxy with HTTPS. If you use Authentik, put it behind Authentik as well: the studio has no login of its own.

## Using it

### 1. Clone your voice (Voices tab)

1. Enter a name, for example `syndias-nl`, and choose **Dutch (nl)**.
2. Record yourself reading the text on screen, or upload a file. Aim for 10 to 20 seconds in a quiet room, at your normal lesson pace. Chatterbox copies accent and rhythm, so this is also where the Flemish sound comes from.
3. Press **Add voice**, then **Test**.

The studio trims silence, removes rumble, normalizes the level and converts the clip to 24 kHz mono WAV before uploading. Clips shorter than 5 seconds of speech are refused.

### 2. Optional: Piper voices (Piper voices tab)

Download one or more voices from the catalog. Belgian Dutch voices are listed under Dutch / Belgium. They are stored in `data/piper-voices`.

### 3. Narrate (Narrate tab)

1. Choose **Text** and type, or choose **Lesson step** and press **Load subtitles**.
2. Pick the model and voice. The play button next to the voice previews the first sentence.
3. Press **Generate**.

When it is done you get the waveform, a player, downloads and the list of sentences. For each sentence:

- **Play** plays just that sentence.
- **Generate again** makes a new take of only that sentence. Chatterbox varies a little each time, so this fixes the occasional odd pronunciation. The take number is shown next to the sentence.
- **Edit** changes the sentence and regenerates only that one.

**Update** regenerates the whole output after you change the text or settings. Unchanged sentences come from the cache, and their takes are kept. **New** starts a fresh output.

`[[shown|spoken]]` works here too: `We gebruiken [[count++|count plus plus]].` shows "count++" in the subtitles and says "count plus plus".

### 4. Save to a lesson

With a lessons folder mounted, **Save audio and subtitles** writes these files into the chosen step:

- `audio.mp3`
- `subtitles.vtt`, with the real timings and your `[[shown|spoken]]` markup kept
- `step.json`, updated so the step uses the new audio

New files get the same owner as the step folder. Typing in the player follows the new timings when `step.json` uses `"typing": {"fromCue": n, "toCue": m}`. The studio warns you when a step still uses seconds.

### Pronunciation (Settings tab)

Words that come back in every lesson go in the pronunciation list, one per line as `word = how to say it`:

```
getElementById = get element by id
MonoBehaviour = mono behaviour
C# = C sharp
```

## Adding Qwen TTS or another server

Create `data/engines.json`:

```json
[
  {
    "id": "qwen",
    "name": "Qwen TTS (English)",
    "baseUrl": "http://192.168.50.10:8880",
    "path": "/v1/audio/speech",
    "model": "qwen-tts",
    "voices": ["default"],
    "language": "en"
  }
]
```

Restart the studio container. The server must accept an OpenAI-style request (`{"input", "voice", "model"}`) and return audio. Optional keys:

- `extra`: an object of extra request fields
- `apiKeyEnv`: the name of an environment variable holding an API key

## Files

| Path | What |
|---|---|
| `data/outputs/<id>/` | `audio.mp3`, `subtitles.vtt` and `job.json` for every output |
| `data/cache/` | one WAV per generated sentence. Safe to clear from Settings |
| `data/piper-voices/` | downloaded Piper voices |
| `data/settings.json` | pronunciation list and last used settings |
| `data/engines.json` | optional extra engines |
| volume `chatterbox-voices` | your cloned voices |
| volume `chatterbox-models` | the Chatterbox model download |

Back up `data/` and the `chatterbox-voices` volume. Everything else can be downloaded again.

## Notes

- The studio uses only the Python standard library, plus `piper-tts` and ffmpeg in the image.
- One generation runs at a time. Others wait in a queue, shown as "waiting" in the header.
- A generation that was interrupted by a restart is resumed when the studio starts.
- Environment variables (`compose.yaml` sets them):
  - `CHATTERBOX_URL`: empty disables Chatterbox
  - `LESSONS_DIR`
  - `DATA_DIR`
  - `PORT`
  - `PIPER_VOICES_BASE`: a mirror of the Piper voices repository
- To build once and reuse the image, set `STUDIO_IMAGE` in `.env` to your registry, for example `192.168.50.203:7000/narration-studio:latest`, then run `docker compose build studio && docker compose push studio`.
