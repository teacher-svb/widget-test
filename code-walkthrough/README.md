# Code Walkthrough Player

A Khan Academy style "talk-through" player for code lessons. The left side is a player: an editable code editor that writes the lesson code while narration plays, with subtitles and transport controls. The right side shows the explainer text for the current step and, for HTML/CSS/JS or plain JavaScript lessons, a live preview tab.

Every step is built from separate files, so you can swap or re-record one piece without touching anything else.

## Quick start

The player loads lesson files with `fetch`, so it needs to be served over HTTP (opening `index.html` from disk will not work).

```bash
cd code-walkthrough
python3 -m http.server 8000
# open http://localhost:8000
```

Any static host works: GitHub Pages, Forgejo pages, nginx, a Moodle/Canvas file area that serves HTML, and so on.

## Folder structure

```
code-walkthrough/
  index.html              page shell with a lesson picker
  player/
    player.js             the player (no build step)
    player.css            layout, theme (light and dark), editor colors
  lessons/
    index.json            list of lessons shown in the picker
    clicker-button/
      lesson.json         lesson settings and step order
      steps/
        01-markup/
          step.json       title and timing
          code.html       the code at the END of this step
          audio.mp3       narration (optional)
          subtitles.vtt   captions
          explainer.md    text for the explainer panel
        02-style/
          ...
  tools/
    new-step.py           scaffold a new step
    narrate.py            generate audio.mp3 from subtitles with local TTS
  docs/
    narration-setup.md    Chatterbox (GPU) and Piper (CPU) setup
  narration.example.json  TTS profiles, copy to narration.json
```

## How a step works

Each step's code file contains the **complete** code as it should look when the step ends. The player diffs it against the previous step and types out the difference while the step plays: new text is typed, removed text is backspaced, and everything added in the current step is highlighted.

Because the editor state is calculated from "which step, how many seconds in", you can:

- seek anywhere on the timeline
- change one code file and the typing for that step (and only that step) updates
- reorder, add or remove steps by editing the `steps` array in `lesson.json`

If a step has no code file, it keeps the previous step's code. That is useful for a pure "talking" step.

### Playback speed and typing speed

The player has two separate speed controls:

- **Playback** (0.75x to 2x) changes the speed of the audio, subtitles and timeline. The typing follows along, so it stays in sync with the narration.
- **Typing** (1x, 2x, Instant) only changes how fast the code is typed inside each step. The audio, subtitles and step length stay the same. At 2x the step's code is finished in half the typing time; with Instant the step's full code appears as soon as the step starts.

The typing speed is remembered per browser. You can also set it when embedding: `CodePlayer.mount(el, url, { typingSpeed: 'instant' })` (`1`, `2` or `'instant'`).

### Pause after each step

Tick **Pause after each step** to stop at the end of every step. The step's finished code and explainer stay visible, so students can read, try things in the editor or check the preview. Pressing play continues with the next step.

The setting is remembered per browser, and can be set when embedding: `CodePlayer.mount(el, url, { pauseAfterStep: true })`.

### Editing while watching

Students can pause and edit the code at any time. The preview updates with their changes. Pressing play (or "Restore lesson code") puts the lesson code back and continues.

## lesson.json

```json
{
  "title": "Build a click counter",
  "languageLabel": "HTML / CSS / JS",
  "mode": "htmlmixed",
  "preview": "html",
  "lang": "en-US",
  "tabSize": 2,
  "cps": 16,
  "files": {
    "code": "code.html",
    "audio": "audio.mp3",
    "subtitles": "subtitles.vtt",
    "explainer": "explainer.md"
  },
  "steps": ["01-markup", "02-style", "03-behavior", "04-polish"]
}
```

| Key | Meaning |
|---|---|
| `title` | Lesson title |
| `languageLabel` | Label shown in the player header |
| `mode` | CodeMirror 5 mode: `htmlmixed`, `javascript`, `css`, `text/x-csharp`, `text/x-java`, `text/x-c++src`, ... |
| `preview` | `"html"` renders the code as a page, `"console"` runs JavaScript and shows `console.log` output, `null` hides the preview tab |
| `lang` | Language for the browser voice fallback, for example `nl-BE` or `en-US` |
| `tabSize` | Indentation width in the editor |
| `cps` | Default typing speed in characters per second |
| `files` | Default file names inside each step folder. Set one to `null` to disable it for every step |
| `starterCode` | Optional code that is already in the editor before step 1 |
| `stepsDir` | Optional, defaults to `steps` |

To use audio in every step, set `"audio": "audio.mp3"` in `files` and drop an `audio.mp3` in each step folder. The demo lessons have `"audio": null` and use the browser voice instead (see below).

## step.json

```json
{
  "title": "Center and style it",
  "typing": { "fromCue": 1, "toCue": 5 }
}
```

| Key | Meaning |
|---|---|
| `title` | Shown in the player header and the step list |
| `typing.fromCue` | Typing starts when this subtitle cue starts (cue numbers start at 1) |
| `typing.toCue` | Typing is finished when this cue ends |
| `typing.start` / `typing.end` | The same in seconds, if you prefer fixed times |
| `typing.cps` | Typing speed when no end is given, overrides the lesson `cps` |
| `duration` | Only needed when there is no audio. Otherwise the step lasts as long as its audio file, or until the last subtitle ends |
| `files` | Override file names for this step only, for example `{ "audio": "take2.mp3" }` |

Use cue numbers rather than seconds. When the narration is regenerated the timings change, but "typing happens while sentences 2 to 4 are spoken" stays true.

## Subtitles

Standard WebVTT. The cue times are relative to the start of the step.

```
WEBVTT

1
00:00.000 --> 00:04.500
Every web page starts from the same skeleton.

2
00:04.500 --> 00:09.500
Inside the body we add a main element.
```

Subtitles do double duty: they are shown under the editor (toggle with CC), and when a step has no audio file the **Voice** toggle reads them aloud with the browser's speech synthesis. That lets you prototype a lesson before recording anything. Browser voices speak at their own pace, so in voice mode the timeline waits at the end of each subtitle until the sentence is finished. Steps can then take a little longer than their timings say.

### Showing one thing and saying another

Write `[[shown|spoken]]` inside a cue to display the first part and pronounce the second, for example `We use [[count++|count plus plus]] here.` The player shows "count++" and both the browser voice and `tools/narrate.py` say "count plus plus". For words that come back in every lesson, use the lexicon in `narration.json` instead.

### From a recording

If you record narration yourself, Whisper can create the subtitles:

```bash
whisper audio.mp3 --language en --output_format vtt
```

## Generating narration with local TTS

`tools/narrate.py` turns the subtitles of each step into `audio.mp3` with a local TTS engine, so the subtitles are the script and the audio follows from them.

For every step it:

1. reads the cue texts from `subtitles.vtt` (the timings in the file are ignored)
2. generates one clip per cue and caches it, so only new or changed sentences are generated again
3. joins the clips with short pauses into `audio.mp3`, with loudness normalized across steps
4. rewrites `subtitles.vtt` with the real timings and points the step at the new audio

Because typing uses cue numbers, it follows the new timings automatically.

```bash
cp narration.example.json narration.json      # then set your server, voice and lexicon
python3 tools/narrate.py lessons/clicker-button --dry-run    # what would be generated
python3 tools/narrate.py lessons/clicker-button              # generate
python3 tools/narrate.py lessons/clicker-button --steps 02-style   # one step after editing it
python3 tools/narrate.py lessons/clicker-button --profile piper    # fast draft voice
```

It needs Python 3.10 or newer and ffmpeg, nothing else.

### narration.json

| Key | Meaning |
|---|---|
| `default` | Profile used when neither the command line nor the lesson picks one |
| `settings` | Shared settings for all profiles |
| `profiles` | Named engine setups, for example `chatterbox`, `piper`, `qwen-en` |
| `engine` | `openai` (any OpenAI-style `/v1/audio/speech` server) or `command` (runs a program) |
| `baseUrl`, `path`, `model`, `voice` | Server settings for the `openai` engine |
| `extra` | Extra fields sent with every request, for example Chatterbox's `exaggeration` |
| `apiKeyEnv` | Name of an environment variable holding an API key, if the server needs one |
| `command` | Argument list for the `command` engine. Placeholders: `{out}`, `{text}`, `{text_file}`, `{speed}`, `{length_scale}` |
| `leadIn`, `gap`, `tail` | Seconds of silence before the first cue, between cues and after the last cue |
| `trimSilence` | Trim silence the engine adds around each clip, so the gaps are predictable |
| `loudnorm` | Normalize loudness so all steps play at the same volume |
| `lexicon` | Words to pronounce differently, for example `"getElementById": "get element by id"` |
| `cacheDir` | Where clips are cached, default `.narration-cache` next to `narration.json` |

A lesson can override any of these with a `narration` object in its `lesson.json`, for example a different profile or extra lexicon entries for that lesson:

```json
"narration": { "profile": "chatterbox", "lexicon": { "flexbox": "flex box" } }
```

Settings that change the sound (engine, voice, model, speed, `extra`) are part of the cache key, so changing them regenerates the clips. Changing the server address does not.

See [docs/narration-setup.md](docs/narration-setup.md) for running Chatterbox Multilingual on the GPU, cloning your own voice, and Piper as a CPU draft voice.

## Explainer

Plain Markdown. Supported: headings, paragraphs, bullet and numbered lists, blockquotes, fenced code blocks, inline code, bold, italic and links. Tables are not supported by the built-in renderer.

## Live preview

- `"preview": "html"` puts the editor content in a sandboxed iframe (`sandbox="allow-scripts"`), so student code cannot reach the parent page, cookies or storage.
- `"preview": "console"` runs the editor content as JavaScript in the same kind of sandbox and lists `console.log` output and errors.

While the lesson types, the preview refreshes at most every 0.7 seconds. While a student edits, it refreshes 0.3 seconds after they stop typing.

## Adding a step

```bash
python3 tools/new-step.py lessons/clicker-button 05-reset "Add a reset button"
```

This copies the previous step's code into the new folder, creates stub `subtitles.vtt`, `explainer.md` and `step.json` files, and appends the step to `lesson.json`. Then edit the code file to its end state.

## Adding a lesson

1. Create `lessons/<lesson-id>/lesson.json` and its step folders.
2. Add `{ "id": "<lesson-id>", "title": "...", "summary": "..." }` to `lessons/index.json`.
3. Link straight to it with `index.html#<lesson-id>`.

## Embedding the player in another page

```html
<link rel="stylesheet" href="player/player.css">
<div id="lesson"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/codemirror.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/javascript/javascript.min.js"></script>
<script src="player/player.js"></script>
<script>
  CodePlayer.mount(document.getElementById('lesson'), 'lessons/js-arrays/');
</script>
```

Load the CodeMirror modes your lesson needs (`htmlmixed` also needs `xml`, `javascript` and `css`; C# needs `clike`). Without CodeMirror the player falls back to a plain text editor, so it also works offline, just without syntax colors.

`mount` returns a promise. After mounting, `element.codePlayer` exposes `play()`, `pause()`, `seek(seconds)` and `step(index)`.

## Keyboard

| Key | Action |
|---|---|
| Space or K | Play / pause (when the editor does not have focus) |
| Left / Right | Back / forward 5 seconds |
