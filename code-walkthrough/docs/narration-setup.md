# Narration setup: Chatterbox and Piper

`tools/narrate.py` turns the subtitles of each step into `audio.mp3`. It talks to a TTS engine through a profile in `narration.json`. This page describes the two local engines it is set up for:

- **Chatterbox Multilingual** on the homelab GPU, for the final Dutch narration in your own voice
- **Piper** on the CPU, for quick drafts while you are still writing a lesson

The details below were correct when written, but both projects move fast. Check their READMEs if a command does not match.

## Chatterbox Multilingual (GPU)

Chatterbox itself is a Python library. [chatterbox-tts-api](https://github.com/travisvn/chatterbox-tts-api) wraps it in a Docker container with an OpenAI-style `/v1/audio/speech` endpoint and a voice library, which is what `narrate.py` expects. The multilingual model is on by default (`USE_MULTILINGUAL_MODEL=true`) and includes Dutch.

### 1. Start the container

The GPU needs to be available to Docker, the same way it already is for ComfyUI (NVIDIA Container Toolkit or the TrueNAS SCALE NVIDIA support).

```bash
git clone https://github.com/travisvn/chatterbox-tts-api.git
cd chatterbox-tts-api
cp .env.example.docker .env
docker compose -f docker/docker-compose.uv.gpu.yml up -d
docker logs chatterbox-tts-api -f     # first start downloads the model
```

The API listens on port **4123**. Adding `--profile frontend` also starts a web UI on port 4321, which is handy for trying out settings.

To manage it from Dockge, create a stack and paste the contents of `docker/docker-compose.uv.gpu.yml` as its compose file. Change any relative `build:` context to the absolute path of the cloned repository.

**VRAM:** the model is small enough to stay loaded next to ComfyUI and Qwen TTS on a 16 GB card in most cases. If you get out of memory errors during a large ComfyUI job, stop one of the two while generating narration. Narration is a batch job, so this is never urgent.

### 2. Record a reference clip of your voice

The voice is cloned from one short recording. Quality of the clip matters more than anything else.

- 10 to 20 seconds of continuous speech, in Dutch, at the pace and tone you use in lessons
- a quiet room, the microphone you would normally record with, no music or echo
- no long pauses, no clipping (keep peaks below about -3 dB)
- WAV or FLAC, mono is fine

A useful trick: read two or three sentences from a real lesson explainer. The model copies accent and rhythm, so this is also how you get a Flemish sound.

### 3. Add the voice to the library

```bash
curl -X POST http://homelab.lan:4123/voices \
  -F "voice_file=@referentie-nl.wav" \
  -F "voice_name=syndias-nl" \
  -F "language=nl"
```

The language is stored with the voice, so the speech requests do not need a language field. `GET /voices` lists the voices, `GET /languages` the supported languages.

### 4. Test it

```bash
curl -X POST http://homelab.lan:4123/v1/audio/speech \
  -H "Content-Type: application/json" \
  -d '{"input": "Hallo, in deze les bouwen we een klikteller.", "voice": "syndias-nl"}' \
  --output test.wav
```

### 5. Tune

These go in `"extra"` in the profile and are sent with every request:

| Setting | Effect |
|---|---|
| `exaggeration` | Expressiveness. Around 0.3 to 0.5 suits explanations; higher sounds theatrical |
| `cfg_weight` | How closely it follows the reference pacing. Lower is slower and more deliberate |
| `temperature` | Variation. Lower is more consistent between sentences |

Changing any of these creates new cache entries, so the next run regenerates the clips with the new sound.

Note: Chatterbox adds an inaudible watermark to its output that identifies it as generated audio. That is fine for course material.

## Piper (CPU)

Piper runs on the Ryzen CPU without touching the GPU. It sounds clearly synthetic, but it generates a whole lesson in seconds, which makes it ideal while you are still changing the text.

1. Install Piper on the machine where you run `narrate.py`, either a release binary from the Piper project or `pipx install piper-tts`.
2. Download a Dutch voice (an `.onnx` file plus its `.onnx.json`) from the [rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices) collection. Look in `nl/nl_BE` for Flemish voices.
3. Set the path to the `.onnx` file in the `piper` profile in `narration.json`.

The profile sends the text on stdin and passes `--model`, `--output_file` and `--length_scale`. Newer Piper versions changed some option names; if the command fails, run `piper --help` and adjust the `command` list. Placeholders you can use: `{out}`, `{text}`, `{text_file}`, `{speed}` and `{length_scale}`.

Draft run:

```bash
python3 tools/narrate.py lessons/klikteller --profile piper
```

Piper clips are cached separately from Chatterbox clips, so switching back and forth does not throw anything away.

## Qwen TTS (English lessons)

The `qwen-en` profile is a placeholder. If your Qwen TTS server has an OpenAI-style speech endpoint, set its `baseUrl`, `model` and `voice` and it works as is. If it uses a different API, use the `command` engine with a small script that calls it and writes the audio to `{out}`.
