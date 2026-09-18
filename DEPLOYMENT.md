# Tempo — Deployment

## Production URL

**Not live yet — one command away.** See [Going live](#going-live-one-command) below.

Once deployed it will be:

```
https://<your-github-username>.github.io/tempo/
```

The exact URL is printed by the deploy script and saved to `LIVE_URL.txt`.

## Hosting provider

**GitHub Pages.**

Chosen because it was the only provider in your preference order that could work without
installing anything: `gh` (GitHub CLI 2.98.0) is already on this machine, and Cloudflare
Pages / Netlify / Vercel all need their CLIs, which need npm — and **Node.js is not
installed here**.

| | |
|---|---|
| Cost | **Free**, permanently. No credit card, no trial, no subscription. |
| HTTPS | Automatic, on `*.github.io`. Certificate is managed for you. |
| Laptop must stay on? | **No.** Files are served by GitHub's CDN. |
| Works on cellular? | Yes — it's the public internet, not your LAN. |
| Service workers / PWA | Fully supported (HTTPS is a secure context). |
| Backend | None needed. Tempo is fully static. |
| Bandwidth limit | 100 GB/month soft limit. You will not come close. |

### One thing to know: the repo will be **public**

GitHub Pages on a free account only serves from public repositories. Tempo has no API
keys, no secrets, and no personal data in the source — your library lives only in your
browser's `localStorage`, never in the repo — so this is safe. Making it private would
require GitHub Pro (paid), which you asked to avoid.

## Going live (one command)

Double-click **`DEPLOY.bat`**, or run:

```powershell
.\DEPLOY.ps1
```

It does all of this, in order:

1. Signs you into GitHub (opens a browser once — the only interactive step)
2. Sets your git identity if it isn't set
3. Commits anything outstanding
4. Creates the `tempo` repo and pushes
5. Turns on GitHub Pages (branch `main`, folder `/`)
6. Polls until the site actually returns HTTP 200, then prints the URL

It is **safe to re-run** — on later runs it skips login and repo creation and just
pushes updates.

If Pages can't be enabled automatically, the script tells you exactly where to click:
`https://github.com/<you>/tempo/settings/pages` → Source = *Deploy from a branch*,
Branch = `main`, Folder = `/ (root)` → Save.

## Deploying updates

```powershell
git add -A
git commit -m "what changed"
git push
```

Or just re-run `.\DEPLOY.ps1`, which does the same thing.

**Deployments are automatic.** Pushing to `main` triggers a GitHub Pages rebuild with no
further action. It typically goes live in **30–90 seconds** (the very first build can
take a couple of minutes).

Watch a build at `https://github.com/<you>/tempo/actions`.

### ⚠️ Always bump the version when you change `app.js` or `styles.css`

Two places, and they **must match**:

| File | What to change |
|---|---|
| `sw.js` | `const VERSION = '0.3.1';` |
| `index.html` | `styles.css?v=0.3.1` **and** `app.js?v=0.3.1` |

Current version: **0.3.1**

Bumping is what forces phones off old cached JavaScript. Skip it and your iPhone may
keep running the previous build. This is not theoretical — it happened during
development, which is why the versioning exists. The mechanism is tested: bump →
new service worker installs → `skipWaiting()` activates it → old caches are deleted →
open pages reload themselves once onto the new code.

## Rolling back

Find the commit you want:

```powershell
git log --oneline
```

Then either revert (keeps history — preferred):

```powershell
git revert <bad-commit-sha>
git push
```

…or hard-reset to a known-good commit:

```powershell
git reset --hard <good-commit-sha>
git push --force
```

Pages redeploys automatically either way. `f32c063` is the pre-cloud checkpoint if you
ever need to get back to the known-good V0.1/V0.2 state.

You can also roll back from the web UI: repo → **Actions** → pick a previous successful
"pages build and deployment" run → **Re-run all jobs**.

## Local development (unchanged)

```powershell
.\START_TEMPO.bat
```

Serves at `http://localhost:5173`. The LAN URL it prints still works for same-Wi-Fi
testing. Local dev is unaffected by deployment — the service worker registers on
`https:` **or** `localhost`, so both environments behave the same.

## What is NOT deployed

No backend, no database, no accounts, no analytics, no cloud sync. Your library is
`localStorage` in whichever browser you're using.

**Consequence:** the public HTTPS site is a *new browser origin*, so it starts with an
empty library — your `192.168.1.181:5173` library will not appear there. That's
expected. Use **Library → Export library** on the old origin and **Import backup** on
the new one to carry it across.
