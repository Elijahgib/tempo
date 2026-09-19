# Tempo — Catalog & Search Quality Report

**Branch:** `feature/audius-audio-engine` (NOT merged, NOT deployed)
**Version:** 0.5.5
**Date:** 2026-09-18

Headline: **ranking more than doubled result relevance — 99% of top-5 results are now
exact or prefix matches, up from 42% on the raw Audius API order.** Jamendo adds real
catalog depth in some genres and nothing at all in others.

And the honest part up front: **this does not approach a mainstream catalog, and no
amount of ranking will fix that.** Ranking fixed *relevance*. It cannot fix *coverage*.

---

## 1. What changed

### Ranking

One scorer, shared by every provider:

| Signal | Points |
|---|---|
| Exact title match | 100 |
| Exact "artist + title" | 96 |
| Exact artist match | 92 |
| Title prefix match | 70 |
| Artist prefix match | 56 |
| All query terms in title (word boundary) | 48 |
| Terms spread across title + artist | 40 |
| All terms present loosely | 30 |
| Partial term overlap | 0–18 |
| **Engagement** (plays / favourites / reposts) | **0–30** |
| **Low-engagement penalty** (non-exact matches only) | **−30** |

Engagement is `log10` weighted (plays ×1.0, favourites ×1.4, reposts ×1.2) and then
converted to a **percentile within that provider's own result set**. This is the key to
fair merging: Jamendo counts run into the millions while Audius counts run in the
thousands, so raw numbers would have let one provider win everything. Percentiles make
them comparable.

The low-engagement penalty buries tracks with `<50 plays && <5 favourites && <3 reposts`
— **unless** the match is exact, so a small artist searched by name still surfaces.

### Merging & dedupe

Both providers are queried in parallel; **one failing never kills the other**. Results
are pooled, scored, then deduplicated on normalised `title|artist`, keeping the
higher-scoring copy and recording which provider lost in the debug line.

### Search debug mode

**More → Search debug → Turn ON.** Every result then shows its breakdown:

```
#129 = text 100 (exact title) + eng 29 (p96) · 1335p/76f/52r
raw: audius 28 · jamendo 40 → 66 after ranking + dedupe
```

`p96` is the engagement percentile; `1335p/76f/52r` is plays/favourites/reposts;
penalties and dedupes are shown when they apply.

### Result rows

Now show artwork, title, artist, **provider tag** (purple AUDIUS / green JAMENDO),
duration, and play count.

---

## 2. Jamendo integration

**Documented REST API v3.0 only** — `https://api.jamendo.com/v3.0/tracks/`. No scraping.

| Finding | Detail |
|---|---|
| **CORS** | ✅ **Supported** — `response.type: "cors"`. Several sources claim Jamendo has no CORS; that is wrong, verified directly. This is what makes it usable with no backend. |
| Credentials | `client_id` required |
| Audio CDN CORS | ❌ **None** — `prod-1.storage.jamendo.com` sends no ACAO header |
| Engagement data | via `include=stats` → `rate_listened_total`, `favorited`, `playlisted` |
| Artwork | ✅ `image` at `imagesize=300` |

### ⚠️ Two real gotchas found

**1. The commonly published demo client ID `56d30c95` is suspended.**
It returns `"Your application has been suspended, please contact Jamendo"`. Any tutorial
using it is dead. This is exactly why you said not to depend on a shared ID.

**2. The audio CDN sends no CORS headers — which nearly broke playback.**
The audio engine was setting `audio.crossOrigin = 'anonymous'` (harmless for Audius,
which does send CORS). With `crossOrigin` set, the browser *requires* CORS headers, so
every Jamendo track would have failed to play. **Removed** — an `<audio>` element needs
only a plain media load. Verified both providers still work.

**3. Jamendo intermittently answers `status: success` with zero results** for queries
that definitely have matches (`lofi` returned 40, then 0, then 40 within seconds). It is
not an error and not obviously rate-limiting. Mitigated with **one automatic retry** on
an empty response, in both search and stream resolution. That took the 20-query run from
6 empty to 2 empty.

### The one action you need to take

Jamendo is **built and tested but switched off** until you supply your own client ID —
nothing is hardcoded, and no ID ships in the repo (this site is public).

1. Open **devportal.jamendo.com**, sign up (free)
2. Create an app, copy its **Client ID**
3. In Tempo: **More → Jamendo → paste → Save → Test**

Stored in `localStorage` only. Until then Tempo searches Audius alone and says so.

---

## 3. Twenty representative searches

`au` / `jam` = raw results per provider; `→` = after ranking and dedupe.
`mix` = provider of each of the top 5 (A = Audius, J = Jamendo).

| # | Query | au | jam | → | top-5 mix |
|---|---|---|---|---|---|
| 1 | lofi | 26 | 40 | 65 | J A A J J |
| 2 | jazz | 28 | 40 | 68 | J A A J J |
| 3 | daft punk | 28 | 40 | 54 | J A A A J |
| 4 | piano | 28 | **0** | 28 | A A A A A |
| 5 | techno | 21 | **0** | 21 | A A A A A |
| 6 | hip hop | 30 | 40 | 64 | J J J J A |
| 7 | acoustic guitar | 27 | 40 | 67 | J J J J J |
| 8 | ambient | 28 | 40 | 68 | A A A A A |
| 9 | drum and bass | 15 | 40 | 54 | J J J J J |
| 10 | classical | 29 | 40 | 69 | A A A A A |
| 11 | rock | 30 | 40 | 70 | A J J J J |
| 12 | chill | 30 | 40 | 70 | J A A J A |
| 13 | sunset | 29 | 40 | 68 | A J J J J |
| 14 | deadmau5 | 29 | 40 | 69 | A A A A A |
| 15 | beethoven | 30 | 40 | 70 | A A J A J |
| 16 | reggae | 30 | 40 | 68 | J A A J A |
| 17 | synthwave | 28 | 40 | 66 | J A J J J |
| 18 | study music | 30 | 40 | 67 | J A J J A |
| 19 | metal | 28 | 40 | 68 | A A J A A |
| 20 | taylor swift | 27 | 40 | 66 | J A J A A |

### Sample top 5 with scoring

**"lofi"**

| # | Src | Title / Artist | Score |
|---|---|---|---|
| 1 | JAM | Lofi / Lowtone Music | 126 = t100 + e26 |
| 2 | AUD | Lofi / sorrydeath | 102 = t100 + e2 |
| 3 | AUD | lofi type beat / bsdu | 100 = t70 + e30 *(68,821 plays)* |
| 4 | JAM | Lofi Chillout Hip Hop Beat / Joystock | 100 = t70 + e30 *(3.1M plays)* |
| 5 | JAM | Lofi Soul Chill RnB / Sevennotes | 99 = t70 + e29 |

Note #2: an exact title match with only 2,437 plays outranks a 68,821-play partial
match. That is the intended trade — exactness first, popularity as the tiebreaker.

**"drum and bass"** — four exact-title matches from Jamendo, then Audius. Audius
returned only 15 results here; Jamendo's 40 materially widened the pool.

**"deadmau5"** — all five from Audius, all genuinely by **deadmau5** (real artist
account: "Unlucky (Work in progress)", "Arcadia 2020", "Ban Hammer"). A real win.

---

## 4. Ranking rationale

**Exactness beats popularity.** Searching "Lofi" should give you the track called
"Lofi", not the most-played track that merely contains the word.

**Engagement as tiebreaker, not driver.** Among equally-relevant results, well-received
tracks win. Capped at 30 points so it can never outweigh an exact match (100).

**Percentile, not raw counts.** Prevents a provider dominating purely on scale.

**Bury the dead, but not the obscure.** The −30 penalty hits near-zero-engagement tracks
*unless* they match exactly, so searching an obscure artist by name still finds them.

### Measured effect (20 queries, 100 top-5 slots)

| Ordering | Exact/prefix matches in top 5 |
|---|---|
| Raw Audius API order | 42 / 100 (42%) |
| **Tempo ranking** | **99 / 100 (99%)** |

Audius's own ordering does not track engagement either — for "jazz" it returned a
7,541-play track first while a 63,691-play track sat further down.

**Provider fairness:** both providers appear in the top 5 on **13 of 20** queries.
Neither dominates.

---

## 5. Which searches still fail badly

**The catalog gap is real and ranking cannot close it.**

| Query | What you get | Verdict |
|---|---|---|
| **taylor swift** | "Taylor Swift" by *DJ Marco el Bulo*, "Taylor Swift Type Beat", "Taylor Swift – Opalite (Javier Tejeda remix)" | ❌ **Fails.** Not her. Tribute tracks, type beats, remixes by other uploaders. |
| **daft punk** | "Daft punk" by *ID*, "Daft Punk – One More Time (Sury Have Dubz)" | ❌ **Fails.** Bootlegs and edits, not Daft Punk. |
| **beethoven** | "Beethoven" by *Hypothalamus*, then genuine Marco Tezza sonata recordings | ⚠️ **Partial.** Public-domain works are well covered by performers. |
| **piano**, **techno** | Audius only (Jamendo empty on this run) | ⚠️ Thinner, still usable |
| **deadmau5** | Actual deadmau5 tracks | ✅ **Works** |

**The pattern:** any living, major-label artist fails. You get covers, remixes and
"type beats" that merely mention the name. Genre and mood searches (lofi, jazz,
synthwave, drum and bass, ambient, chill, study music) work well. Public-domain
classical works well. Electronic artists who publish on Audius themselves work.

**Do not expect Tempo to replace a mainstream catalog.** It is a genuinely good free
player for genre/mood listening and independent electronic music. That is the honest
ceiling of free, licensed, background-capable streaming without a subscription.

---

## 6. Does Jamendo materially improve the catalog?

**Yes — but unevenly. Worth keeping, not transformative.**

**Where it helps:**
- **Result volume:** typically 54–70 merged results vs ~28 from Audius alone — roughly
  **2.4× deeper**
- **Genuinely thin genres:** "drum and bass" had only 15 Audius results; Jamendo added 40
  and took all of the top 4 with exact matches
- **Acoustic/instrumental/production music:** dominates "acoustic guitar" (5/5)
- **Exact-title competition:** on "jazz", "lofi", "synthwave" and "reggae" it supplies
  exact matches Audius lacked

**Where it does not:**
- **Mainstream artists:** no better than Audius. "daft punk" and "taylor swift" still fail.
- **Reliability:** returned empty on 2 of 20 queries even with a retry
- **Catalog character:** heavily royalty-free/production music — competent but often
  generic ("Rock Music for Energetic Videos"). Audius has more personality.
- **Artist search:** Audius only; Jamendo artists are not surfaced

**Verdict:** keep it. It roughly doubles depth and rescues thin genres for the cost of
one free client ID. It does **not** move Tempo toward mainstream coverage.

---

## 7. Bugs found and fixed

Three real bugs, all found by testing rather than inspection:

1. **`crossOrigin = 'anonymous'` would have broken every Jamendo track.** Its CDN sends
   no CORS headers, so the browser would have refused the media. Removed.

2. **🔴 Jamendo tracks were silently converted to YouTube tracks on reload.**
   `normalizeState()` had a provider allow-list of `['audius','local','youtube']` —
   missing `jamendo`, so every Jamendo track was rewritten to `provider: 'youtube'` on
   the next page load and then tried to play through the YouTube iframe. `sanitizeImport`
   had the identical bug, silently dropping Jamendo tracks from backups.
   Both fixed, **plus self-healing**: the uid prefix (`jamendo:123`) is now authoritative
   and repairs rows already corrupted by the earlier build.

3. **Ranking artifacts were being persisted.** `_score` and `_dbg` were saved into
   `localStorage` and would have leaked into exported backups. Stripped in `addTrack()`.

---

## 8. Tests

**All green, 0 uncaught errors.**

| Suite | Result |
|---|---|
| Jamendo provider (search, stats, artwork, gating) | ✅ |
| Jamendo playback + on-demand stream resolution | ✅ |
| Stream URLs never persisted (both providers) | ✅ |
| Provider survives reload + self-heals corruption | ✅ |
| Merged search, score ordering, dedupe | ✅ |
| Favorites / queue / playlists across providers | ✅ |
| Auto-advance across providers (Audius → Jamendo) | ✅ |
| YouTube regression (foreground-only, engine paused) | ✅ |
| Export/import incl. Jamendo, no stream URLs leaked | ✅ |
| Search debug mode on/off | ✅ |
| 390px layout incl. tags and debug lines | ✅ |
| No client ID hardcoded anywhere in source | ✅ |

---

## 9. Files changed

| File | Change |
|---|---|
| `app.js` | Ranking engine; Jamendo provider with retry + on-demand stream resolution; merged multi-provider search with dedupe; debug mode; provider tags and play counts; Jamendo settings; `crossOrigin` fix; provider allow-list + self-heal fixes; `_score`/`_dbg` stripping |
| `styles.css` | Provider tags, debug lines, notes banner, settings input/steps (appended only) |
| `index.html`, `sw.js` | Version 0.5.5 |
| `CATALOG_REPORT.md` | **New** — this file |

UI was **not** redesigned, per your instruction. Still zero dependencies, no backend,
no accounts.

---

## 10. Not merged

Committed to `feature/audius-audio-engine` only. `main` remains V0.3.

Test locally: `START_TEMPO.bat` → `http://localhost:5173` → **More → Jamendo** to add
your client ID, then **Search**.

### Suggested next step

Given the catalog ceiling, the honest options are:

1. **Accept it** — Tempo is a strong free player for genre/mood and independent music
2. **Add your own files** — the Local provider already exists; making it persist via
   IndexedDB would let you carry your own library, which *is* your mainstream catalog
3. **Apple Music / Spotify SDKs** — real mainstream catalog, but requires a paid
   subscription, which you ruled out

Option 2 is probably the highest-value next move, and it needs no subscription.
