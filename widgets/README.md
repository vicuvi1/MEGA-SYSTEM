# Widgets for the Life System island

Widgets are small add-ons shown on the island's pages (Home, PC, Fun). Each one
is one JavaScript file that runs in a locked box: an iframe with
`sandbox="allow-scripts"` only (an opaque origin), its own strict Content
Security Policy (no network, no frames, no forms), and nothing of the app's:
no database, no PIN, no sign-in, no Electron, no Node. It talks to the island
only through a small bridge, and the island checks every call.

## A widget's folder

```
widgets/<id>/
  manifest.json    what it is and what it asks for
  widget.js        the code (32 KB at most)
  screenshot.png   a picture for the gallery (made-up data only)
```

### manifest.json

```json
{
  "id": "my-widget",
  "name": "My widget",
  "version": "1.0.0",
  "author": "Your name",
  "about": "One plain line about what it does.",
  "size": "1x1",
  "refresh": 300,
  "permissions": ["read"],
  "hosts": [],
  "settings": [{ "key": "label", "label": "What it is", "kind": "text" }]
}
```

- `id`: 2–32 lower-case letters, digits or `-`, the same as the folder name.
- `size`: `1x1`, `2x1` or `2x2`.
- `refresh`: how often it gets fresh data, in seconds (15–3600). Nothing is sent while the island is closed or the page isn't shown.
- `permissions` (asked once at install, each can be switched off later in Settings → Widgets):
  - `read`: today's plan, focus, points, weather and next event, read only.
  - `network`: https requests to the `hosts` you list (at most 5). The app makes the request and checks it: https only, those hosts only, no logins or ports in the address, text answers only, 64 KB at most.
  - `add`: add a task or a note. The island asks the user each time.
  - `sound`: play one of the app's short sounds (`done`, `tick`, `chime`).
- `settings` (optional, at most 4): things the user sets per widget (`text` or `date`).

### widget.js

The code gets a `widget` object:

```js
const w = window.widget
w.root                       // the element to draw in
w.data                       // { now, day, today? } (today only with "read")
w.config                     // the user's settings for this widget
w.on('data', (data) => {})   // fresh data at your refresh rate
w.on('visible', (on) => {})  // shown / hidden: stop your timers when hidden
await w.fetch(url)           // { status, type, body } ("network" only)
await w.addTask(text)        // the user confirms ("add" only)
await w.addNote(text)
w.sound('done')
```

Keep it light: draw with the DOM or SVG, animate only `transform` and
`opacity`, don't loop. The island pings each widget every few seconds; a
widget that keeps the PC busy (slow answers, long tasks) is paused and shown
as "slowed down". No outside scripts, fonts or images: they are blocked.

## Sending one in (pull request)

1. Fork `vicuvi1/MEGA-SYSTEM` and add your folder under `widgets/`.
2. Add an entry to `widgets/gallery.json` (id, name, author, version, screenshot), then run
   `node scripts/widget-hashes.mjs --write` to fill in the `sha256` of your `widget.js`.
3. Run `npx vitest run src/core/widgets` (it checks your manifest, the hash and the screenshot).
4. Open a pull request saying what it does and why it needs each permission.
   Use made-up data in the screenshot: the repo is public.

Installs are pinned to the hash: when a widget changes (a new version), users
reinstall it from the gallery to run the new code. Widgets ship inside the
app (nothing is downloaded at run time), so a merged widget appears with the
next app update.
