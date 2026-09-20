# Tempo — Musi Migration Report

**2026-09-20**

---

## 1. STATUS

# ✅ SHIPPED — Musi import is live

But read §12 before you import: **Audius does not have your music.** The importer,
matching engine and Audiomack adapter are all built and working. Audiomack — the one
provider likely to actually have your catalogue — is **blocked on credentials that
Audiomack does not document how to obtain.**

## 2. Branch / version

Built on `feature/musi-migration-audiomack`, merged to `main` (`--no-ff`), deployed.
**v0.7.3** live at https://elijahgib.github.io/tempo/

Rollback tag `v0.3.1-rollback` untouched.

## 3. Musi importer — working

**More → Import from Musi.** Paste a public share link.

The share page is a thin shell; the real data comes from Musi's own public endpoint,
which returns exactly what we need:

```json
{"video_duration":348,"video_name":"Marvins Room","video_creator":"Drake","video_id":"JDb3ZZD4bA0"}
```

`video_id` is a **YouTube id**, so every imported track is playable immediately (in the
foreground) even before any matching happens. `video_duration` gives the matcher real
duration evidence.

Only the one URL you paste is ever fetched. No crawling, no enumeration, no private
data, no audio downloaded from anywhere.

### ⚠️ Musi sends no CORS headers

Verified directly: the endpoint returns no `Access-Control-Allow-Origin`, so a browser
on another site cannot read it. Two honest routes, no third-party proxy:

| Route | Status |
|---|---|
| **Tempo Worker** (one tap) | Built, not deployed — needs Node (§10) |
| **Manual paste** (works now) | Live. Tempo shows you the exact link, you copy the page, paste it in. ~20 seconds. |

## 4. Test playlist used

`https://feelthemusi.com/playlist/snups1` — a public playlist, **382 tracks**, used only
to verify the parser. Its real response shape drove every parser test.

## 5. Tracks extracted

From the live fixture: playlist title, and per track title / artist / YouTube id /
duration / position. Order preserved exactly.

Parser rejects cleanly: invalid JSON, empty payloads, missing track arrays, malformed
ids, non-objects, nulls, and duplicate video ids within one playlist.

## 6. Duplicate / re-import behaviour

Imported tracks use a stable `musi:<videoId>` identity, so re-importing reconciles
rather than duplicating. Verified **across a reload**:

| Behaviour | Result |
|---|---|
| Re-import same playlist | ✅ no duplicate playlist, no duplicate tracks |
| Reports new vs already-present | ✅ `{added:0, already:2}` |
| New source order adopted | ✅ |
| Track removed from Musi | ✅ **kept**, reported as `removedFromSource` — never auto-deleted |

## 7. Normalisation

Matching-only; your displayed title is never altered. Both `originalTitle` and the
normalised form are kept.

**Removed:** `(Official Music Video)`, `[Official Video]`, `Official Audio`,
`Lyric Video`, `Visualizer`, `4K`/`HD`, `prod. by …`, `dir. by …`.

**Deliberately kept:** `feat.` / `ft.`, `remix`, part numbers, subtitles — anything that
changes *which recording* this is.

Plus a fix for real YouTube channel naming: `QuandoRondoVEVO` → `QuandoRondo`, and artist
comparison is space-insensitive so that still matches `Quando Rondo`.

## 8. Matching engine

Exact title/artist → prefix → token overlap, with featured-artist credit and duration
agreement. Engagement is capped at **6 points** so popularity can never rescue a weak
text match.

**Hard rejects** (never accepted as the original): remix, live, acoustic, instrumental,
nightcore, slowed, reverb, sped up, cover, karaoke, mashup, edit, bootleg…

| Confidence | Score | Behaviour |
|---|---|---|
| **CONFIRMED** | ≥ 92 | auto-adopts the match |
| **LIKELY** | ≥ 74 | auto-adopts — *unless* a rival is within 8 points, then → REVIEW |
| **REVIEW** | ≥ 45 | keeps YouTube, waits for you |
| **UNMATCHED** | < 45 | keeps YouTube |

Verified rejections: remix vs original, live, slowed+reverb, nightcore, unrelated title,
wrong artist (→ REVIEW, not accepted), 120-second duration gap.

**Review screen** (More → Review): shows your Musi track, the proposal with its score and
reasons, and four actions — Use match / Try another / Keep YouTube / Leave.

## 9. Audiomack credential status — ⚠️ BLOCKED, and not by me

- API is real and active: `https://api.audiomack.com/v1`, OAuth 1.0a.
- **Every endpoint returns `401 {"errorcode":1003,"message":"Invalid consumer key"}`** —
  tested search, music-by-slug and artist. There is no unauthenticated read access.
- **Audiomack's own documentation does not say how to obtain a consumer key/secret.**
  It documents the OAuth flow *once you have credentials*, and nothing about getting them.

I did not invent a signup procedure, and I did not scrape Audiomack. See §17.

## 10. Audiomack backend status — built, not deployed

`worker/` contains a complete Cloudflare Worker:

- `GET /health` — reports whether Musi and Audiomack are available
- `GET /musi/:code` — fetches one public playlist (solves the CORS problem)
- `GET /audiomack/search?q=` — OAuth 1.0a **HMAC-SHA1 signing implemented in full**
- `GET /audiomack/stream/:id` — stream URLs expire in ~10s, so they're fetched
  immediately before playback and never stored

Origin-locked to `https://elijahgib.github.io` (plus localhost), ~60 req/min per IP,
**no database, no auth, no analytics, no storage**. Secrets live as Worker secrets.

**Not deployed because this machine has no Node/npm/npx/wrangler.** I did not install
anything without asking. Commands are in §17.

## 11. Audius fallback status

Working and unchanged — but see below.

## 12. Match quality — the finding that matters

I ran your actual artists against the live Audius API:

| Musi query | Audius result | Selected | Confidence | Background? |
|---|---|---|---|---|
| Quando Rondo — 24 | 7 hits, **none the song** (type beats, a tribute) | YouTube | UNMATCHED | ❌ |
| Playboi Carti — Magnolia | 1 hit: *"Magnolia #Screwed"* | YouTube | UNMATCHED | ❌ |
| Playboi Carti — Sky | 2 hits, unrelated | YouTube | UNMATCHED | ❌ |
| Jdot Breezy — Bookbag | **0 hits** | YouTube | UNMATCHED | ❌ |
| 9lokknine — 10 Percent | **0 hits** | YouTube | UNMATCHED | ❌ |
| Allstar JR — Ride For Me | 1 hit, unrelated | YouTube | UNMATCHED | ❌ |
| Drake — Marvins Room | **0 hits** | YouTube | UNMATCHED | ❌ |

**0 of 7 matched.** Audiomack could not be tested — no credentials.

The engine behaved exactly as designed: `"Magnolia #Screwed"` was **blocked as a version
mismatch** rather than accepted. The tribute tracks were rejected as *"title too
different"*. **It refused to guess** — which is the correct outcome, not a failure.

**What this means for you:** importing your Musi playlists today gives you your library
structure, names, artwork and ordering, with every track playable through YouTube —
**foreground only**. It does not yet give you background playback of *your* music.
Audiomack is the provider most likely to change that, which is why §17 matters.

## 13. Tests

**~90 assertions across the new work, 0 genuine failures, 0 uncaught console errors.**

| Suite | Result |
|---|---|
| Musi URL validation (incl. host rejection) | ✅ 8/8 |
| Playlist parsing against the real shape | ✅ |
| Ordering preserved | ✅ |
| Title / artist normalisation | ✅ 15/15 |
| False-positive rejection | ✅ 7/7 |
| Confidence thresholds | ✅ 5/5 |
| Import, provenance, immediate playability | ✅ |
| Re-import reconciliation (incl. after reload) | ✅ |
| Review screen + all four actions | ✅ 12/12 |
| Audius / local / YouTube / IndexedDB / Media Session regressions | ✅ |
| Jamendo + Audiomack disabled states | ✅ |
| 390px layout incl. review + paste sheet | ✅ |
| Secret leakage (whole repo) | ✅ clean |

**Two real bugs found and fixed:**
1. **Auto-advancing to a YouTube track left it silent** — the iframe only mounts when Now
   Playing is open, so an auto-advanced YouTube track played nothing. This pre-dated
   tonight and matters far more now that Musi imports create many YouTube tracks.
2. **`normalizeState` dropped `sourceCode` on reload**, so re-importing the same playlist
   after restarting Tempo would have created a duplicate instead of reconciling.

## 14. Files changed

`app.js` (importer, normalisation, matching engine, Audiomack adapter, review screen,
import UI, reconciliation), `styles.css` (appended), `index.html`, `sw.js` (0.7.3),
**new `worker/`** (`src/index.js`, `wrangler.toml`, `package.json`, `.gitignore`),
new `MUSI_MIGRATION_REPORT.md`.

## 15 / 16. Main and production — both changed

`main`: `4353fc5` → `1cf8b4c`. Production: 0.6.3 → **0.7.3**, verified live (all assets
200, import works on the real origin, no secrets, no localhost refs, zero console
errors). Test data I created was removed afterwards.

---

## 17. What I need from you

### A. Import your playlist — you can do this right now, no setup

1. In Musi: make the playlist **Public**, tap **Share → Copy Link**
   (it looks like `https://feelthemusi.com/playlist/xxxxxx`)
2. Open **https://elijahgib.github.io/tempo/** → **More** → **Import from Musi**
3. Paste the link → **Import playlist**
4. Tempo will say it has no backend and show you a **direct link**. Tap it, **select all
   the text** on that page, copy it
5. Come back, paste it into the box, tap **Import pasted playlist**

Your playlist appears under **Playlists** with the original name and order. Every track
plays immediately via YouTube (foreground). Anything uncertain lands in **Review**.

> Do the import on your **iPhone**, since that is where your library should live —
> Tempo's storage is per-device.

### B. One-tap import instead of paste (optional, ~10 min)

Install Node, then:

```powershell
winget install OpenJS.NodeJS.LTS
cd C:\Users\ELaptop800\Projects\music-player\worker
npx wrangler login          # ← the one interactive step
npx wrangler deploy
```

Copy the printed `https://tempo-api.<you>.workers.dev` into **More → Tempo backend →
Save → Test**. Musi import then becomes one tap.

### C. Audiomack — the one that would actually fix your catalogue

Audiomack does not publish how to get API credentials. The only legitimate route I can
point you at is asking them directly:

- Docs: **https://audiomack.com/data-api/docs**
- Contact Audiomack support / partnerships and request **Data API consumer key + secret**
  for a personal, non-commercial player.

If they grant them, add them to the Worker — **never to the repo**:

```powershell
cd C:\Users\ELaptop800\Projects\music-player\worker
npx wrangler secret put AUDIOMACK_KEY
npx wrangler secret put AUDIOMACK_SECRET
npx wrangler deploy
```

Audiomack then lights up automatically, and re-importing your playlist will upgrade
YouTube-only tracks to background-playable ones. Nothing else needs changing.

---

## Known limitations

1. **Audius has essentially none of your music** (§12). Import works; background
   playback of *your* songs does not, yet.
2. **Audiomack is unverified end-to-end.** The adapter and OAuth signing are written and
   unit-reasoned but have never spoken to the live API — no credentials. I will not claim
   it works until it does.
3. **Musi import needs the paste step** until the Worker is deployed.
4. **Imported YouTube tracks are foreground-only** and stop when you lock the phone.
5. **Review is capped at 40 items** on screen at once.
6. Matching runs ~8 tracks/second (deliberately throttled). A 382-track playlist takes a
   few minutes; tracks are usable immediately while it runs.
7. **If a Musi playlist is private, nothing can read it** — it must be Public to share.
