# Tempo — Test Report

**Last updated:** 2026-09-18 (V0.2 — Phases A/B/C)
**Project path:** `C:\Users\ELaptop800\Projects\music-player`
**Asset version:** `0.2.2`

| Phase | Status |
|---|---|
| A — embed-failure handling | ✅ Complete, verified on a **real** blocked video |
| B — automatic metadata | ✅ Complete, no API key required |
| C — IFrame Player API + queue auto-advance | ✅ Complete |

Everything below was driven through the live app in real Chrome against the running
server. **Zero uncaught errors and zero console messages** across a full interaction
sweep.

One item could not be verified by automation and needs 10 seconds from you — see
**"The one thing I could not confirm"**.

---

## URLs

| Device | URL |
|---|---|
| **Laptop** | `http://localhost:5173` |
| **iPhone 16** | `http://192.168.1.181:5173` |

Server: `py -m http.server 5173 --bind 0.0.0.0` (PID 13796), still running.

> Firewall (unchanged from V0.1): the iPhone still needs an inbound **Private**-profile
> allow rule for `python.exe` on TCP 5173. See the V0.1 section at the bottom.

---

## 1. Is official YouTube playback confirmed?

**Confirmed at the player level. Not confirmed at the "I heard audio" level** — and I
want to be precise about the difference rather than overclaim.

**What was positively verified:**

| Check | Result |
|---|---|
| Official IFrame Player API loads (`https://www.youtube.com/iframe_api`) | ✅ `YT.Player` available, full `PlayerState` enum |
| Real `YT.Player` instance is driving the embed | ✅ not a bare iframe |
| Player reports real video metadata | ✅ `getDuration()` → 282s / 359s / 214s — correct, per-video |
| `getVideoUrl()` host | ✅ `www.youtube.com` |
| `enablejsapi=1` present on the iframe | ✅ |
| Player reaches `CUED` state | ✅ state 5 |
| Event channel works | ✅ `onReady`, `onStateChange`, `onError` all fire |
| `loadVideoById()` swaps tracks without rebuilding the player | ✅ duration updated 282s → 359s on the same instance |

**What I could not observe:** frames actually rolling. Chrome suspends media playback
in a **backgrounded** tab, and the automation tab reports
`document.visibilityState = "hidden"` for its whole lifetime. `playVideo()` therefore
leaves the player at `UNSTARTED` with `currentTime` pinned at 0. I foregrounded the
Chrome window and retried; the automation tab still never became the active tab, so I
stopped rather than burn time on it.

This is an automation-environment limit, not an app defect — the same hidden-tab rule
also suppressed `loading="lazy"` thumbnails during V0.1 testing, and those render fine
in a real window (confirmed by screenshot). The player is fully wired; only the final
"press play and hear it" step needs a human.

### The one thing I could not confirm

Open `http://localhost:5173`, add any song, and **press play**. If you see and hear the
video, playback is fully confirmed. Everything around it already is.

---

## 2. Which test videos worked

Verified embeddable through the official API (each returned a correct duration and
reached `CUED` with no error):

| Video ID | Title | Channel |
|---|---|---|
| `dQw4w9WgXcQ` | Rick Astley — Never Gonna Give You Up (4K Remaster) | Rick Astley |
| `9bZkp7q19f0` | PSY — GANGNAM STYLE | officialpsy |
| `kJQP7kiw5Fk` | Luis Fonsi — Despacito ft. Daddy Yankee | LuisFonsiVEVO |
| `JGwWNGJdvx8` | Ed Sheeran — Shape of You | Ed Sheeran |
| `fJ9rUzIMcZQ` | Queen — Bohemian Rhapsody (Remastered) | Queen Official |
| `hTWKbfoikeg` | Nirvana — Smells Like Teen Spirit | NirvanaVEVO |
| `60ItHLz5WEA` | Alan Walker — Faded | Alan Walker |
| `OPf0YbXqDm0` | Mark Ronson — Uptown Funk | MarkRonsonVEVO |
| `YQHsXMglC9A` | Adele — Hello | Adele |
| `CevxZvSJLk8` | Katy Perry — Roar | KatyPerryVEVO |
| `2Vv-BfVoq4g` | Ed Sheeran — Perfect | Ed Sheeran |
| `RgKAFK5djSk` | Wiz Khalifa — See You Again | — |
| `jNQXAC9IVRw` | Me at the zoo | — |
| `5qap5aO4i9A`, `hLQl3WQQoQ0`, `1w7OgIMMRc4`, `pRpeEdMmmQ0`, `QcIy9NiNbmo`, `JZjAg6fK-BQ`, `ktvTqknDobU` | additional spot-checks | — |

**20 of 22 tested videos embedded cleanly.**

### Videos that refuse embedding (found by testing, used as fixtures)

| Video ID | oEmbed | Player | Notes |
|---|---|---|---|
| `jfKfPfyJRdk` | **200 — metadata available** | ❌ **error 150** | Lofi Girl radio — the exact failure you hit |
| `21X5lGlDOfg` | 200 | ❌ error 150 | same pattern |
| `XXXXXXXXXXX` / `aaaaaaaaaaa` | 400 | ❌ error 150 | invalid IDs |

**Important finding:** `jfKfPfyJRdk` returns **full oEmbed metadata (HTTP 200) yet
refuses to embed.** So embeddability *cannot* be predicted from metadata — the IFrame
API's `onError` is the only reliable authority. That's exactly why Phase C was needed to
make Phase A work.

---

## 3. How restricted / non-embeddable videos are handled

Verified end-to-end against the real blocked video `jfKfPfyJRdk` (not a simulation):

| Behaviour | Result |
|---|---|
| YouTube's "This video is unavailable" iframe shown | ❌ **never** — asserted absent |
| Tempo's own state shown instead | ✅ "This video can't play inside Tempo" |
| Explanation line | ✅ "Its owner has turned off embedded playback." |
| Artwork retained | ✅ blurred cover art behind the message |
| Title retained | ✅ "lofi hip hop radio 📚 beats to relax/study to" |
| Artist retained | ✅ "Lofi Girl" |
| **Open in YouTube** button | ✅ → `www.youtube.com/watch?v=jfKfPfyJRdk`, `target="_blank"` |
| Library row marked | ✅ amber **"YouTube only"** badge |
| Recovery: play a good track afterwards | ✅ fallback removed, real player restored, error cleared |
| Layout at 390px with fallback open | ✅ no overflow, button fully inside the viewport |
| False positives self-heal | ✅ reaching `PLAYING` clears a stale `blocked` flag |

Detection covers error codes **2, 5, 100, 101, 150** (bad request, HTML5 failure,
missing/private, embedding disabled ×2).

No restriction is bypassed. No yt-dlp, no audio extraction, no proxying, no ad blocking,
no undocumented endpoints, no background-playback hacks.

---

## 4. Metadata behaviour

**Source: YouTube's public oEmbed endpoint** — `https://www.youtube.com/oembed`.
Official, documented, **no API key, no npm package, and it sends CORS headers** (I
verified this empirically before building on it).

| Behaviour | Result |
|---|---|
| Stores video title | ✅ |
| Stores channel / artist | ✅ |
| Stores thumbnail | ✅ |
| Stores video ID | ✅ |
| Stores original YouTube URL | ✅ |
| `"YouTube • VIDEO_ID"` placeholder | ✅ **gone** — 0 remaining after migration |
| Manual title required? | ✅ No — the field is now an optional override |
| Add flow | Optimistic "Loading…" row appears instantly, real title/artist land ~1s later |
| Invalid ID | oEmbed returns 400 → falls back to `YouTube • <id>`, `meta:'failed'` |
| Cached after first fetch | ✅ `meta:'ok'` — no re-fetch on every page load |
| Custom title given | ✅ `meta:'manual'`, never overwritten by a later fetch |

**UI now reads:**

```
Luis Fonsi - Despacito ft. Daddy Yankee
LuisFonsiVEVO
```

### Migration of existing V0.1 data — verified

Seeded storage in the exact V0.1 shape (no `artist`, no `url`, legacy titles) and
reloaded:

- ✅ Legacy `"YouTube • <id>"` titles upgraded to real titles + artists — **0 left**
- ✅ A user's manual title (`meta:'manual'`) left untouched
- ✅ `url` and `thumb` backfilled for every track
- ✅ `favorites`, `history`, `queue` all preserved byte-for-byte
- ✅ Backfill is sequential, throttled 120ms, capped at 30 tracks per load

Storage key is still `tempo-state-v1`, so nothing on your phone or laptop is lost.

---

## 5. Queue auto-advance behaviour

Implemented via the official API's `onStateChange` → `ENDED` (state 0).

Verified chained advance across three tracks:

| Step | Result |
|---|---|
| Queue two tracks, play a third | ✅ queue `[Gangnam, Despacito]` |
| Playing track removed from "up next" | ✅ a track that's playing is no longer queued |
| "Up next · <title>" shown in the player | ✅ |
| Track ends → advance #1 | ✅ → Gangnam Style, queue drains to 1 |
| Track ends → advance #2 | ✅ → Despacito, queue empties |
| Up-next label clears when queue empties | ✅ |
| Track ends on an empty queue | ✅ stays put, no crash, no loop |
| `YT.Player` reused across advances | ✅ same instance — `loadVideoById()`, not a rebuild |
| Re-queueing an already-queued track | ✅ deduped, no duplicate row |
| Manual ✕ remove from queue | ✅ still works |

**Bug found and fixed during testing:** playing a track didn't consume it from the
queue, so a queue containing only the currently-playing track could never advance
(it would have tried to advance to itself). `play()` now removes the track from the
queue — it's playing, not "up next".

Deliberately **not** built (per "don't overbuild"): shuffle, repeat, reordering,
previous/next buttons, cross-track gapless. The architecture supports adding them —
`playNextFromQueue()` is the single hook.

---

## 6. Preserved from V0.1 — full regression pass

| Item | Result |
|---|---|
| Home / Add / Library / Liked / Queue tabs render | ✅ |
| Add via full URL, `youtu.be`, `music.youtube.com`, scheme-less, `/shorts/` | ✅ |
| Add via bare 11-character ID | ✅ |
| Enter key submits | ✅ |
| Non-YouTube host rejected | ✅ error shown, library unchanged |
| Favorites toggle on/off, persist | ✅ |
| Queue add / remove / dedupe | ✅ |
| Recently played (history) | ✅ newest-first |
| Delete + cascade to favorites/queue/history | ✅ |
| **Player is not torn down** by favorite/queue taps | ✅ same iframe node *and* same `YT.Player` object |
| localStorage survives refresh | ✅ library, favorites, queue, history, titles, artists, urls |
| Player does not auto-open on load | ✅ |
| **No horizontal overflow at 390px** | ✅ every tab, player open, blocked state, 100-char titles |

390px checks ran in a real 390px viewport (media queries evaluated against it), not a
scaled screenshot.

---

## 7. Files changed (V0.2)

| File | Change |
|---|---|
| `app.js` | oEmbed metadata + hydrate/backfill, IFrame Player API integration, embed-error detection, queue auto-advance, blocked-state fallback, V0.1→V0.2 data migration, queue-consumption fix |
| `styles.css` | Appended blocked-state fallback, up-next line, "YouTube only" badge. **No existing rules modified.** |
| `index.html` | Versioned asset URLs (`?v=0.2.2`) to defeat stale phone caches |
| `sw.js` | Cache name bumped, versioned shell, old caches now purged on activate |
| `TEST_REPORT.md` | This file |

`manifest.webmanifest`, `START_TEMPO.bat`, `README.md`, `CLAUDE_HANDOFF.md`, and all
icons are unchanged. No dependencies added — still zero-build, zero-backend,
zero-API-key, no npm, no framework. The mobile UI, layout, and colour system are
untouched apart from the additions above.

---

## 8. Blockers

**None blocking your testing.** Open items, in order of how much they matter:

1. **Frame-level playback needs your eyes** (§1). Everything around it is verified.
2. **iPhone Safari not tested on-device** — I have no way to drive your phone. All
   mobile verification was a true 390px viewport in Chrome. Safari-specific risks are
   low but real: `playsinline=1` is set (required for iOS inline playback), and iOS
   still requires a user tap before any playback starts, so auto-advance may pause at a
   track boundary on iPhone until tapped. **Worth checking specifically.**
3. **Firewall rule still pending** for iPhone access (unchanged from V0.1, needs admin).
4. **`apiBroken` fallback is untested.** If `iframe_api` fails to load, Tempo falls back
   to a plain embed. I could not simulate a network failure of that script, so this
   defensive path is code-only.
5. **Cache versioning is manual.** Bump `?v=` in `index.html` (and `sw.js`) when you edit
   `app.js`/`styles.css`. During this session a stale cached `app.js` briefly masked new
   code — that's what the versioning now prevents.
6. **Metadata needs internet.** Offline adds fall back to `YouTube • <id>` and will not
   retry automatically (a `meta:'failed'` track is skipped by backfill by design).
7. Unchanged V0.1 limits: no background/lock-screen audio, YouTube ads play normally,
   `localStorage` is per-origin/per-device, laptop must stay awake, DHCP IP can change,
   no Add-to-Home-Screen until HTTPS.

---

# Appendix — V0.1 report (2026-09-17)

V0.1 status: **READY**. 30/30 automated assertions + 14 follow-up checks, zero console
errors. Full matrix — home/add render, URL add, 11-char ID add, thumbnails, library,
official embed, favorites, queue, history, delete, refresh persistence, 390px layout,
PWA manifest/icons — all passed.

### Windows Firewall (still required for the iPhone)

Only inbound rules for this `python.exe` are two **Block** rules scoped to **Public**;
there is no **Private** allow rule, so the iPhone is refused by default. In an
**Administrator** PowerShell:

```powershell
New-NetFirewallRule -DisplayName "Tempo (port 5173, Private)" `
  -Direction Inbound -Action Allow -Protocol TCP -LocalPort 5173 `
  -Profile Private `
  -Program "C:\Users\ELaptop800\AppData\Local\Programs\Python\Python313\python.exe"
```

Private ✅, Public ❌. If Windows prompts instead, tick **Private networks** only. If it
still won't connect, check the router for AP/client isolation.

### V0.1 fixes (all still in place)

Player no longer restarts on favorite/queue · queue items removable · delegated event
handling · hardened `extractVideoId()` with host allowlist · Enter-to-submit · favicon ·
corrected project paths in docs · manifest `scope` · `100dvh` for iOS toolbar ·
`START_TEMPO.bat` prints LAN IPs.
