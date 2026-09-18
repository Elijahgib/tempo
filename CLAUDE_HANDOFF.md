# Tempo — Claude Code Handoff

## Permanent Windows project path

`C:\Users\ELaptop800\Projects\music-player`

## Mission

Tempo is Elijah's personal Musi-style music player. V0.1 must stay small, fast, mobile-first, and easy to test on his iPhone 16. Do not turn it into a Spotify clone.

## Immediate task

1. Work only inside `C:\Users\ELaptop800\Projects\music-player`.
2. Read `README.md`, `index.html`, `app.js`, and `styles.css` before editing.
3. Do NOT run npm install. V0.1 is intentionally dependency-free.
4. Check JavaScript syntax and inspect for obvious runtime/path errors.
5. Start Tempo by running `START_TEMPO.bat` or `py -m http.server 5173 --bind 0.0.0.0`.
6. Determine this laptop's active LAN IPv4 address and report:
   - laptop URL: `http://localhost:5173`
   - iPhone URL: `http://<LAN-IP>:5173`
7. If Windows Firewall asks, allow Python on Private networks only so the iPhone can reach it on the home Wi-Fi.
8. Do a focused V0.1 QA pass:
   - Home renders.
   - Add screen accepts a valid YouTube URL and an 11-character ID.
   - Added item appears in Library.
   - YouTube thumbnail loads.
   - Clicking track opens official YouTube embed.
   - Favorite works.
   - Queue works.
   - History works.
   - Delete works.
   - Data survives browser refresh through localStorage.
   - No obvious horizontal overflow at iPhone-sized width.
   - manifest/icon/service-worker paths are valid for future HTTPS deployment.
9. Fix only defects necessary for V0.1 testing. Keep it dependency-free.
10. Create `TEST_REPORT.md` containing what passed, what was fixed, exact laptop/iPhone URLs, and known limitations.
11. Leave the local server running at the end if the terminal session allows it.

## Product rules

Use YouTube's official embed/player architecture. Do NOT add yt-dlp, audio extraction, YouTube downloading, YouTube ad blocking, proxying intended to suppress ads, hidden/background YouTube playback, or undocumented YouTube endpoints.

V0.1 is intentionally:
- static HTML/CSS/JS
- paste YouTube URL/video ID
- local library
- favorites
- queue
- recent history
- official YouTube playback
- localStorage
- no backend
- no API key
- no npm packages

Do not add authentication, databases, subscriptions, payments, analytics, admin panels, or frameworks yet.

## Next version only after V0.1 passes

V0.2 may add:
- YouTube Data API search
- automatic title/channel/thumbnail metadata
- named playlists
- queue reordering
- import/export backup
- HTTPS cloud deployment

## Final response format

Return:
1. V0.1 status: READY / BLOCKED
2. Changes made
3. Local server status
4. Laptop test URL
5. iPhone test URL
6. Exact 5-step test Elijah should perform
7. Known limitations
8. Files changed
