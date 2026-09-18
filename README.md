# Tempo

Elijah's lightweight, Musi-style personal music player. Paste a YouTube link, build a
library, and play it through YouTube's official embedded player.

Dependency-free static HTML/CSS/JavaScript — no build step, no npm, no framework, no
backend, no API key.

**Project path:** `C:\Users\ELaptop800\Projects\music-player`
**Version:** 0.3.1

## Public site

Deploy with one command — double-click **`DEPLOY.bat`** (or run `.\DEPLOY.ps1`).

It publishes to **GitHub Pages** and prints your permanent HTTPS URL, which is also
saved to `LIVE_URL.txt`:

```
https://<your-github-username>.github.io/tempo/
```

Free, HTTPS, works over cellular, and **your laptop does not need to be on**. Full
details in [DEPLOYMENT.md](DEPLOYMENT.md).

## Local development

Double-click **`START_TEMPO.bat`**, then open `http://localhost:5173`.

The script also prints your LAN IP so you can test from a phone on the same Wi-Fi. No
install step is required — it runs on Python's built-in HTTP server.

## What works

- Paste a YouTube URL (`watch`, `youtu.be`, `/shorts/`, `/embed/`, `/live/`,
  `music.youtube.com`, or a bare 11-character ID)
- **Automatic metadata** — title, artist, and artwork are fetched from YouTube's public
  oEmbed endpoint. No API key. You only type a title if you want to override it.
- Official YouTube IFrame Player API playback
- Library, Favorites, Queue, Recently Played
- **Queue auto-advance** — when a track ends, the next queued track starts
- **Graceful handling of embed-restricted videos** — Tempo's own "can't play here" card
  with the artwork, title, and an *Open in YouTube* button, instead of YouTube's error box
- **Export / Import library** as a JSON backup
- Installable to the iPhone home screen (PWA, standalone mode)
- Offline app shell via service worker
- All state in `localStorage` — no account, no database

## Deliberate limitations

Tempo does not bypass any YouTube restriction. It does not extract audio, download
media, proxy streams, suppress ads, or force background playback. Videos whose owners
disable embedding open on YouTube instead.

Because everything is stored in `localStorage`, your library is **per-browser and
per-origin** — the public HTTPS site starts empty even if your local copy has tracks.
Use Export/Import to move a library between them.

Expect playback to stop when you lock the phone or switch apps; that is YouTube/iOS
policy, not a bug.

## Files

| File | Purpose |
|---|---|
| `index.html` | Shell, meta tags, service worker registration |
| `app.js` | The whole application |
| `styles.css` | All styling |
| `sw.js` | Service worker (versioned cache) |
| `manifest.webmanifest` | PWA manifest |
| `DEPLOY.ps1` / `DEPLOY.bat` | One-command deploy to GitHub Pages |
| `START_TEMPO.bat` | Local dev server |
| `DEPLOYMENT.md` | Hosting, updates, rollback |
| `FIELD_TEST.md` | iPhone test checklist |
| `TEST_REPORT.md` | Full QA history |

## Changing the app

When you edit `app.js` or `styles.css`, **bump the version in two places** so phones
don't serve stale code:

- `sw.js` → `const VERSION = '0.3.1';`
- `index.html` → `app.js?v=0.3.1` and `styles.css?v=0.3.1`

They must match. See [DEPLOYMENT.md](DEPLOYMENT.md).

## Roadmap

Next candidates: YouTube Data API search, named playlists, queue reordering, and cloud
sync. Deliberately not started yet.
