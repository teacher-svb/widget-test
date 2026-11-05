# Code Walkthrough for GitBook

A GitBook integration with one custom block, **Code walkthrough**, that embeds a lesson from the [code-walkthrough player](../code-walkthrough/) in a GitBook page.

GitBook runs a block's code on its own servers and only accepts ContentKit output, so the block cannot run the player directly. Instead it renders a `webframe` (an iframe) that loads `embed.html` from wherever you host the player:

```
GitBook page
 └─ Code walkthrough block      src/index.tsx, runs on GitBook's backend
     ├─ editors: lesson picker (and audio language for multilingual lessons)
     └─ webframe ──────────────▶ https://your-host/code-walkthrough/embed.html?lesson=…
                                 the player itself: editor, audio, subtitles, preview
```

## 1. Host the player

The player is a static site. Publish the `code-walkthrough/` folder on any HTTPS host, for example GitHub Pages, Netlify or Cloudflare Pages. You don't need `narration-stack/`, `tools/` or `docs/` on the host.

Check that these load in a browser:

- `https://your-host/code-walkthrough/embed.html?lesson=clicker-button`
- `https://your-host/code-walkthrough/lessons/index.json`

The block reads `lessons/index.json` to fill its lesson picker, so every lesson you want to offer must be listed there.

## 2. Configure the integration

In `gitbook-manifest.yaml`:

- `organization`: your GitBook organization's ID or subdomain.
- `urlUnfurl`: replace `YOUR-HOST` with your player's address. When an editor pastes a link that matches, GitBook turns it into the block. Both `embed.html?lesson=<id>&lang=<lang>` and `index.html#<id>` links work.

## 3. Publish

```bash
npm install
npx gitbook auth --token <personal API token>   # app.gitbook.com/account/developer
npx gitbook integration check                   # validate the manifest and build
npx gitbook integration publish
```

Publishing needs a personal API token; `gitbook login` (browser sign-in) cannot publish. With `visibility: private` the integration is only visible to your organization.

## 4. Install and use

1. In GitBook, open **Integrations**, find **Code Walkthrough** and install it on the spaces where you want it.
2. Fill in **Player URL** with the folder where you host the player, for example `https://your-host/code-walkthrough/`.
3. In a page, insert the **Code walkthrough** block from the `/` menu, or paste a player link.
4. Pick a lesson. For lessons with several languages you can also fix the audio language. *Reader's language* follows each reader's browser.

Readers see only the player. The pickers are only shown while editing.

## Development

```bash
npm run typecheck
npx gitbook integration dev    # live-reload against your GitBook organization
```

## How it fits together

| Piece | What it does |
|---|---|
| `src/index.tsx` | The block: reads the Player URL from the installation settings, fetches `lessons/index.json` and the lesson's `lesson.json` for the pickers, renders the `webframe` |
| `embed.html` (in `code-walkthrough/`) | Player only, configured by query parameters. Reports its height to GitBook with `@webframe.resize`, so the block always fits the player |
| `?theme=` | The block passes GitBook's light or dark theme on to the player |

Lesson ids are checked against `^[a-z0-9][a-z0-9_-]*$` in the block and in `embed.html`, so a block or a pasted link cannot point the player at another path or site.

## Limits

- **The player must be public.** The iframe loads in the reader's browser, and GitBook's servers fetch `lessons/index.json`. Neither can reach a localhost or intranet address.
- **The frame starts at a fixed aspect ratio** (`INITIAL_ASPECT_RATIO` in `src/index.tsx`) and resizes as soon as the player has loaded.
- **Readers' settings** (typing speed, pause after each step, languages) are stored in the browser's storage for the player's host, shared by every embed on that host. Some browsers partition or block storage in third-party iframes. The player then just doesn't remember the settings.
