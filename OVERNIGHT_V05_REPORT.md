# Tempo — Overnight Report (V0.6)

**Night of 2026-09-18 → 19**

---

## 1. STATUS

# ✅ READY FOR IPHONE TEST

All merge gates passed. Merged to `main`, deployed, and verified live over HTTPS.

## 2. Branch

Work done on `feature/audius-audio-engine`, then merged to `main` with `--no-ff`.
Both branches exist; history was not rewritten.

## 3. Version

**0.6.3** (`sw.js` VERSION and both `index.html` `?v=` strings agree).

## 4. Production URL

# https://elijahgib.github.io/tempo/

Serving 0.6.3, verified live. Saved to `LIVE_URL.txt`. **Your laptop can be off.**

## 5. Git commits

| SHA | Commit |
|---|---|
| `f6beb22` | **Merge V0.6** into main (`--no-ff`) |
| `b9aac88` | Raise local ownership bonus above the engagement ceiling |
| `658d7a2` | Release version 0.6.2 |
| `dff1b05` | **V0.6: durable local music library (IndexedDB)** + DEPLOY.ps1 fix |
| `0bd45e1` | V0.5: search ranking + Jamendo |
| `108596f` | V0.4: provider architecture + real audio engine |
| `fb887cc` | *(previous production)* |

**Rollback tag `v0.3.1-rollback` → `fb887cc`, pushed to GitHub.** Untouched.

```powershell
git checkout main; git reset --hard v0.3.1-rollback; git push --force
```

## 6. Was main changed?

**Yes — deliberately, and only after every gate passed.** `main` moved
`fb887cc` → `f6beb22` and production went 0.3.1 → 0.6.3. The V0.3 rollback point
is preserved as a pushed tag.

## 7. IndexedDB local library

**Working.** Database `tempo-media` v1, object store `files`, keyed by a durable
`lf_<base36>_<random>` id.

- Audio stored as **Blobs**, as-is. Never base64'd, never in `localStorage`,
  never altered.
- Object URLs minted only for playback, revoked when another track takes over.
  Verified: **at most one local object URL is ever held.**
- Metadata/blob reconciliation on boot flags orphans as `MISSING` instead of
  silently failing.
- Verified on the **live production origin**: import → blob stored → retrieved.

## 8. Audio formats

Accepted when the browser reports them playable: **MP3, M4A/AAC, WAV**, plus
FLAC/OGG/Opus where supported. iOS frequently reports an empty MIME type for
Files.app picks, so a filename-extension fallback is used. Non-audio is rejected
cleanly (tested: a `.txt` was rejected while 2 audio files imported).

## 9. Local persistence

**Verified across reload.** 3 imported tracks, their blobs, favourites, queue and
a mixed-provider playlist all survived. Durable ids unchanged, provider stayed
`local`, no track flagged missing.

⚠️ **Not verified: surviving a full Safari/PWA restart on iOS.** That is test
step 9–10 tomorrow.

## 10. Local offline playback

Architecturally supported and the shell is precached, but **not verified under
real network loss** — the automation tab cannot exercise it honestly. Streaming
rows dim and show *NEEDS INTERNET* when `navigator.onLine` is false. No streaming
media is ever cached. **Airplane-mode test is step 11.**

## 11. Audius

**Working.** 26 results for "lofi" from the production origin; ranking intact
(≥4/5 exact-or-prefix in top 5).

Finding: Audius **content-node CORS varies per node** — some allow `fetch()`,
some don't. This does not affect playback, because `<audio>` uses a no-cors media
load. It is why removing `crossOrigin='anonymous'` mattered for Audius too, not
just Jamendo.

## 12. Jamendo

**Implemented, cleanly disabled, no nagging.** Returns `[]` without throwing and
adds no note to results. No client ID is committed anywhere (verified against the
deployed bundle). Enable at **More → Jamendo**.

## 13. YouTube

**Unchanged, foreground-only.** Regression passed: player creates, iframe mounts,
real duration (214s), audio engine pauses so there is no double playback, and
switching away destroys it cleanly. Note shown: *"YouTube playback pauses when
Tempo is backgrounded."*

## 14. Playlists

**Create, rename, delete, add, remove, reorder (▲▼), shuffle, play.** Mixed
providers in one playlist verified (local + Audius). Playlists reference uids —
**a local blob is never duplicated**, no matter how many playlists contain it.

## 15. Search

Local library searched **instantly and synchronously**, never gated on network.
Providers merged and ranked by one scorer; **provider response timing does not
affect order**.

Local tracks get a **+35 ownership bonus, deliberately above the 30-point
engagement ceiling** — so at equal relevance your own file always wins, while a
better text match (exact over prefix) still wins overall. This was a real bug
caught in final verification: at 25 the bonus lost to engagement.

## 16. Media Session

Title, artist, **album** (new), artwork, `playbackState`, `setPositionState`, and
handlers for play/pause/next/previous/seekto/seekforward/seekbackward. Verified
updating for local tracks including album.

⚠️ Whether iOS renders it on the Lock Screen is **test step 7**.

## 17. Storage management

**More → My Music**: track count, bytes used in Tempo, and
`navigator.storage.estimate()` quota. **Manage files** gives per-track edit and
delete; **Clear all** is confirmed.

Deleting removes the blob, metadata, and every reference in favourites, queue,
playlists and history, and revokes the object URL — **all 8 cascade assertions
passed**.

## 18. Export / backup limitations

**Export is a METADATA BACKUP and is labelled as such** (`schema: 3`,
`kind: "metadata-backup"`, plus an explicit `note`). Verified: 2,902 characters
for 5 tracks — **no audio bytes, no base64, no blob URLs**.

Local tracks export as references with `audioIncluded: false` and
`requiresLocalFile: true`.

**Your MP3/M4A files are not in that JSON.** Keep originals in Files/iCloud. A
full audio-archive export was deliberately not built tonight.

## 19. Automated tests

**~140 assertions, 0 failures, 0 uncaught console errors.**

| Suite | Result |
|---|---|
| IndexedDB create / put / get / delete / clear | ✅ |
| Multi-file import + non-audio rejection | ✅ |
| Persistence across reload (blobs + metadata + refs) | ✅ |
| Object URL minting and revocation | ✅ |
| Tag parsing (ID3v2, MP4) + filename fallback | ✅ |
| Deletion cascade (8 checks) | ✅ |
| Engine: same element, transport, seek, queue, shuffle, repeat | ✅ |
| Media Session incl. album | ✅ |
| Local search + merged ranking | ✅ |
| Audius ranking regression | ✅ |
| Jamendo disabled state | ✅ |
| YouTube regression | ✅ |
| Export metadata-only + import round trip | ✅ |
| Malicious import sanitation | ✅ |
| V0.3 → V0.6 migration (14 checks) | ✅ |
| Service worker + versioned cache | ✅ |
| 390px layout, all tabs + sheets | ✅ |

**Two real bugs found and fixed by testing:**
1. Local object URLs leaked when switching to YouTube/Audius, and rapid track
   changes raced the async resolve.
2. The ownership bonus was below the engagement ceiling (§15).

**Not verifiable here:** speaker output, lock-screen behaviour, and duration
probing — Chrome suspends the media pipeline in a backgrounded automation tab.
Track duration self-heals on first real play via the `durationchange` handler.

## 20. Production deployment tests

Against the live HTTPS URL:

| Check | Result |
|---|---|
| index / CSS / JS / manifest / SW / 3 icons | ✅ all 200, correct MIME |
| Serving 0.6.3 | ✅ |
| Manifest name "Tempo", standalone, scope `./` | ✅ |
| Service worker registered, scope `/tempo/` | ✅ |
| **IndexedDB import on production origin** | ✅ |
| Audius search from production | ✅ 26 results |
| Merged search, local ranked first | ✅ |
| Subpath assets resolve under `/tempo/` | ✅ |
| No `localhost` / `192.168.x.x` / `:5173` | ✅ none |
| No mixed content | ✅ none |
| No committed secrets or client IDs | ✅ none |
| Uncaught errors on production | ✅ none |

My test data was removed from the production origin afterwards.

## 21. Files changed

`app.js` (IndexedDB store, import, tags, storage manager, offline state, local
search+ranking, playlist reorder/rename, metadata export), `styles.css`
(appended), `index.html`, `sw.js` (0.6.3), `DEPLOY.ps1` (first-run crash fix),
new `IPHONE_TEST_V05.md`, `OVERNIGHT_V05_REPORT.md`, `LIVE_URL.txt`.

**DEPLOY.ps1 fix:** `$ErrorActionPreference='Stop'` turned `gh`'s stderr on an
expected 404 into a *terminating* error, so first run died on "no repo" / "no
Pages". All native calls now route through `Invoke-Native`. I reproduced the old
crash and verified all four branches (missing/existing repo, missing/existing
Pages) now resolve.

No dependencies. No framework. No backend.

## 22. Your 5-minute iPhone test

Full list in `IPHONE_TEST_V05.md`. The essentials:

1. Open **https://elijahgib.github.io/tempo/** → **More** → **Import music** →
   pick 2–3 MP3/M4A from Files
2. Play one. **Lock the phone** — does it keep playing? Check the Lock Screen for
   artwork/title/artist
3. Queue the others, let one end — **does it auto-advance?**
4. **Close Tempo completely, reopen** — **are your files still there?** ← the
   headline
5. **Airplane Mode on** — does an imported track still play?

## 23. Known limitations

1. **Browser storage is not permanent ownership.** iOS can evict it under
   storage pressure. Tempo cannot prevent that. Keep originals in Files/iCloud.
   Adding to Home Screen makes eviction less likely, not impossible.
2. **Export contains no audio** — metadata only.
3. **Physical iPhone behaviour is unverified** — audio output, lock screen,
   background playback for local files, offline playback, and storage durability
   all need you.
4. **Duration shows 0:00 until first play** for imported tracks in this
   environment; it fills in on first real play.
5. **Catalog ceiling unchanged** — Audius/Jamendo are not mainstream catalogs.
   Living major-label artists still return covers and remixes. Your own imported
   files are the answer to that.
6. **Jamendo needs a free client ID** (More → Jamendo).
7. **YouTube remains foreground-only** by design.
8. **No reorder drag-and-drop** — playlists reorder with ▲▼ buttons.
9. **Artwork for imported files** only appears when embedded in the tags; there
   is no artwork lookup.
