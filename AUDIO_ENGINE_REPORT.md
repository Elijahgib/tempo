# Tempo — Audio Engine Report

**Branch:** `feature/audius-audio-engine` (NOT merged, NOT deployed)
**Version:** 0.4.0
**Date:** 2026-09-18

Tempo now has a real audio engine. Audius is the primary provider and streams actual
MP3 through one persistent `<audio>` element with Media Session metadata. YouTube is
retained, intact, and explicitly demoted to a foreground-only fallback.

---

## 1. Audius API method used

Public REST API at **`https://api.audius.co/v1`** — read-only, documented endpoints only.
No scraping, no undocumented endpoints, no gated-content bypass.

| Purpose | Endpoint |
|---|---|
| Track search | `GET /v1/tracks/search?query=&limit=30&app_name=Tempo` |
| Artist search | `GET /v1/users/search?query=&limit=12&app_name=Tempo` |
| Artist's tracks | `GET /v1/users/{id}/tracks?limit=30&app_name=Tempo` |
| Discovery | `GET /v1/tracks/trending?limit=30&app_name=Tempo` |
| Audio stream | `GET /v1/tracks/{id}/stream?app_name=Tempo` |
| Artwork | `track.artwork` → `150x150` / `480x480` / `1000x1000` |

**Host discovery:** `GET https://api.audius.co` now returns `api.audius.co` itself as the
single node, so Tempo targets it directly rather than picking a discovery node.

**Stream URLs are resolved at play time and never persisted** — `providers.audius.streamUrl(t)`
builds the endpoint on demand. Verified by assertion: no saved track object contains the
substring `stream`.

### Gating is respected

A track is only offered if **all** of these hold:

```js
is_streamable === true && !is_delete && !stream_conditions && access.stream !== false
```

`stream_conditions !== null` means the track is paid/gated — those are filtered out and
never played. This is not cosmetic: a search hit with `is_streamable: false` returned
`{"code":404,"error":"track not found"}` from the stream endpoint, confirming the flag is
the real gate. Note `access.stream` can read `true` on a track that is *not* streamable,
so `is_streamable` is the authoritative field.

## 2. Were credentials required?

**No.** Every endpoint above works anonymously from the browser with only the
`app_name=Tempo` identifier. **No API key, no secret, nothing to keep out of the public
repo.**

Audius CORS headers are present and survive the redirect to content nodes, so a static
PWA with no backend can call them directly — this was verified before any code was
written, because it was the make-or-break question for the whole architecture.

An API key exists for higher rate limits and user auth; V1 deliberately does not use one.

## 3. Search result quality

Good and directly usable. Every result carries title, artist, artwork and duration.

| Query | Returned | Playable after gating |
|---|---|---|
| `lofi` | 19 | 18 |
| `jazz` | 18 | 18 |
| `electronic` | 20 | 19 |
| `lofi jazz` | 26 | 26 |

Roughly **95% of results are playable**. Artist search returns 10–12 artists with
avatars and track counts, and tapping one loads that artist's tracks.

Caveat: this is Audius's catalogue — independent and electronic-leaning. You will find
plenty of lofi, jazz, house and hip-hop, but **not** major-label chart music. That is the
trade-off for free, background-capable streaming with no subscription.

## 4. Five tested tracks

All five fetched through Tempo's own provider code, then decoded with WebAudio to prove
the bytes are genuinely playable audio:

| # | Track | Artist | ID | Result |
|---|---|---|---|---|
| 1 | Siberian Jazz | EIME | `DX0Xb` | HTTP 206 · audio/mpeg · **decoded 2ch @48kHz** |
| 2 | Breaking Jazz | Ljazz | `q4Wobxb` | HTTP 206 · audio/mpeg · **decoded 2ch @48kHz** |
| 3 | Abana - Sativa Jazz (Original) | Abana | `NlkRN` | HTTP 206 · audio/mpeg · **decoded 2ch @48kHz** |
| 4 | mango heist & Koresma - under | Arden Records | `gmkNdP2` | HTTP 206 · audio/mpeg · **decoded 2ch @48kHz** |
| 5 | romance lofi jazz hop | JazzHop | `0XRjV` | HTTP 206 · audio/mpeg · **decoded 2ch @48kHz** |

Every one returned `206 Partial Content` with `Accept-Ranges` honoured (seeking will
work), `Content-Type: audio/mpeg`, and valid MP3 frame headers.

## 5. Direct audio playback status

**Confirmed at the data layer. Not confirmed at the "sound came out of a speaker" layer.**

| Check | Result |
|---|---|
| Stream returns real MP3 | ✅ 206, `audio/mpeg`, valid frame headers |
| **Bytes decode to real audio** | ✅ `decodeAudioData` → 2ch @ 48 kHz on all 5 tracks |
| Range requests supported (seeking) | ✅ |
| One persistent `<audio>` element | ✅ created once at boot; asserted identical across track changes and re-renders |
| Element never recreated by render | ✅ it lives outside `#app` entirely |
| `audio.src` points at the Audius endpoint | ✅ |
| Actual speaker output | ⚠️ **not verifiable here** |

**Why not:** Chrome suspends the entire media-element pipeline in a backgrounded tab, and
the automation tab reports `visibilityState: "hidden"` for its whole life. Proof it's the
environment and not the code: an `<audio>` element fed a **local blob** of the very same
bytes also refused to load metadata, while `decodeAudioData` decoded those bytes fine.
`play()` additionally rejects with `NotAllowedError` (no user gesture).

This is the same limitation that blocked YouTube playback verification in earlier
sessions. **It needs your iPhone.**

## 6. Background / Media Session capability

`navigator.mediaSession` is fully present, and Tempo wires all of it:

| Capability | Status |
|---|---|
| `MediaMetadata` (title / artist / album / artwork) | ✅ set and verified on every track change |
| `playbackState` | ✅ kept in sync |
| `setPositionState` (scrubber position) | ✅ updated on `timeupdate` |
| Action: `play` / `pause` | ✅ registered |
| Action: `nexttrack` / `previoustrack` | ✅ registered |
| Action: `seekto` | ✅ registered |
| Action: `seekforward` / `seekbackward` | ✅ registered |
| Action: `stop` | available (not wired — nothing to stop beyond pause) |

Verified live: metadata read back as title `Siberian Jazz`, artist `EIME`, album `Tempo`,
2 artwork sizes — and it followed correctly through an auto-advance.

**What this does NOT prove:** that iOS will show Tempo on the Lock Screen and Control
Center, or that audio continues when you lock the phone. Desktop Chrome registering
handlers says nothing about iOS Safari's behaviour. **Unverified until you test it.**

The honest expectation: an `<audio>` element playing a direct MP3 is the approach that
*can* work in iOS Safari, unlike the YouTube iframe which provably cannot. Whether it
survives lock/app-switch — especially for a PWA launched from the Home Screen — is
exactly what tomorrow's test must establish.

## 7. YouTube regression status

**No regression. Nothing was removed.** 10/10 checks passed:

| Check | Result |
|---|---|
| YouTube track still plays via IFrame API | ✅ player created, real duration 214s |
| iframe mounts in the Now Playing stage | ✅ |
| Audio engine pauses for YT (no double playback) | ✅ |
| Switching YT → Audius destroys the YT player cleanly | ✅ iframe removed, audio stage restored |
| Switching Audius → YT pauses the engine | ✅ |
| Embed-restricted video fallback card | ✅ still works, no YouTube error box |
| "Open in YouTube" on blocked tracks | ✅ |
| Labelled foreground-only in the UI | ✅ "YouTube · foreground only" |
| One-time explanatory notice | ✅ shown once, remembered |
| Provider flag `background: false` | ✅ |

YouTube tracks show a persistent note in Now Playing: *"YouTube playback pauses when
Tempo is backgrounded."* No bypass of any kind was added.

## 8. Files changed

| File | Change |
|---|---|
| `app.js` | **Rewritten** around the provider architecture: `providers.{audius,local,youtube}`, persistent audio engine, Media Session, playback controller with shuffle/repeat/queue, playlists, new 4-tab UI, mini player + Now Playing, V1→V2 migration, schema-2 backup |
| `styles.css` | **Rewritten** — black + Tempo orange identity, compact rows, shelves, mini player, Now Playing, bottom sheet |
| `index.html` | `#player-root` → `#np-root`; assets bumped to `?v=0.4.0` |
| `sw.js` | `VERSION` → `0.4.0` |
| `AUDIO_ENGINE_REPORT.md` | **New** — this file |

Untouched: `manifest.webmanifest`, icons, `DEPLOY.ps1`/`.bat`, `START_TEMPO.bat`,
`DEPLOYMENT.md`, `FIELD_TEST.md`, `OVERNIGHT_REPORT.md`, `README.md`, `TEST_REPORT.md`.

Still zero dependencies, zero build step, no framework, no backend, no accounts.

### Data model

```js
{ uid: "audius:DX0Xb",          // provider-namespaced, the primary key
  provider: "audius|local|youtube",
  providerTrackId, title, artist, artwork, duration,
  url, addedAt, meta?, blocked? }
```

State: `{ tracks:{uid:Track}, favorites:[uid], queue:[uid], history:[uid], playlists:[…] }`
in `tempo-state-v2`.

## 9. Tests passed

**86 assertions, 0 failures, 0 uncaught errors.**

| Suite | Result |
|---|---|
| V1 → V2 migration | ✅ 17/17 |
| Audius search / artists / gating | ✅ 8/8 |
| Audio engine + Media Session | ✅ 16/16 |
| Queue, auto-advance, shuffle, repeat, next/prev | ✅ 13/13 |
| Playlists (create, add, open, shuffle) | ✅ 5/5 |
| YouTube regression | ✅ 10/10 |
| Provider switching (YT ↔ Audius) | ✅ 10/10 |
| Export/import schema 2 + legacy + hostile input | ✅ 17/17 |
| 390px iPhone layout (all tabs, NP, mini player) | ✅ 16/16 |
| Five tracks stream + decode | ✅ 5/5 |

### Phase 8 checklist

- ✅ Audius search returns real results
- ✅ At least 5 tracks stream (5/5, verified to decoded audio)
- ⚠️ Play/pause — wired and asserted; **speaker output needs the iPhone**
- ✅ Queue works
- ✅ Track-end auto-advance works (chained through 2 tracks, player reused)
- ✅ Favorites work
- ✅ Playlists implemented and working
- ✅ Media Session metadata updates
- ✅ 390px iPhone layout — no horizontal overflow anywhere
- ✅ Existing YouTube playback still works

### Data preserved (Phase 7)

Migration verified against a real V0.3-shaped library: **favorites, queue, history,
titles, artists, artwork, URLs, `addedAt`, and the YouTube `blocked` flag all survived**,
with every track re-keyed to `youtube:<id>`.

**The old `tempo-state-v1` key is left untouched on disk**, so rolling back to `main`
restores the previous app with its data intact.

Export is now schema 2 and includes `provider` + `providerTrackId`. Schema-1 backups
still import, remapping bare video ids to `youtube:` uids. Local files are excluded from
export (they aren't portable).

## 10. What requires real iPhone testing

In priority order:

1. **Does Audius audio actually play through the speaker?** Everything up to the decode
   is proven; the final step is unverifiable in automation.
2. **Does audio continue when you lock the phone?** ← *the entire reason for this
   rearchitecture.* If this fails, the premise needs rethinking.
3. **Does audio continue when you switch apps?**
4. **Do Lock Screen / Control Center show Tempo** with title, artist and artwork, and do
   the play/pause/next/previous/scrub controls work?
5. **Does auto-advance fire while backgrounded** (iOS may require a gesture)?
6. **Standalone PWA behaviour** — is background audio better or worse launched from the
   Home Screen versus in Safari?
7. **Seeking** — does dragging the scrubber work smoothly over a ranged MP3 on cellular?
8. **Local file picker** on iOS — untested; files are session-only by design.

**I am not claiming background playback works.** It is architecturally the approach that
*can* work on iOS, and YouTube's iframe provably cannot — but until you lock your iPhone
and the music keeps going, it is unproven.

---

## Not merged, not deployed

Committed only to `feature/audius-audio-engine`. `main` still holds the shipping V0.3.
Test locally with `START_TEMPO.bat` → `http://localhost:5173`.

To deploy this branch later:

```powershell
git checkout main
git merge feature/audius-audio-engine
.\DEPLOY.ps1
```
