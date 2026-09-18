# Tempo V0.1

Tempo is Elijah's lightweight Musi-style personal player prototype.

## Permanent Windows project path

`C:\Users\ELaptop800\Projects\music-player`

## Fastest test

Double-click `START_TEMPO.bat`.

No npm install and no build step are required for V0.1. It is intentionally dependency-free HTML/CSS/JavaScript and runs with Python's built-in HTTP server.

Laptop URL:

`http://localhost:5173`

For iPhone testing, keep the laptop and iPhone on the same Wi-Fi and open:

`http://<LAPTOP-LAN-IP>:5173`

Claude Code should determine and report the exact LAN IP.

## What works now

- Mobile-first interface
- Paste a YouTube URL or video ID
- Official YouTube embedded playback
- Local library
- Favorites
- Queue
- Recent history
- Delete saved tracks
- Browser localStorage persistence
- PWA manifest/icons/service worker for later HTTPS deployment
- No backend
- No API key
- No package installation

## Important limitation

Tempo V0.1 intentionally does not bypass YouTube restrictions. It does not extract audio, download YouTube media, suppress YouTube ads, or force hidden/background YouTube playback.

## Permanent iPhone use later

The local server is just for development/testing. After V0.1 passes QA, deploy these static files to an HTTPS host. Then Tempo can be added to the iPhone Home Screen and used without the laptop running.

## Claude Code

Read `CLAUDE_HANDOFF.md` before changing anything.

## V0.2

After V0.1 works on the iPhone:

- YouTube Data API search
- automatic titles/channel/thumbnail metadata
- named playlists
- queue reordering
- library import/export
- cloud sync later
