# Tempo -> GitHub Pages, one command.
#
#   Right-click this file > "Run with PowerShell"
#   ...or from a terminal in this folder:   .\DEPLOY.ps1
#
# It will log you into GitHub (browser window), create a repo, push, turn on
# GitHub Pages, wait for the site to go live, and print your public HTTPS URL.
# Safe to re-run: on later runs it just pushes updates.

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

$REPO = 'tempo'

function Say($msg, $color = 'White') { Write-Host $msg -ForegroundColor $color }

Say ""
Say "==================================================" Cyan
Say "  TEMPO - DEPLOY TO GITHUB PAGES" Cyan
Say "==================================================" Cyan
Say ""

# --- 0. gh present? ---------------------------------------------------------
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  Say "GitHub CLI (gh) is not installed." Red
  Say "Install it from https://cli.github.com then re-run this script." Yellow
  Read-Host "Press Enter to close"
  exit 1
}

# --- 1. Authenticate --------------------------------------------------------
gh auth status 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
  Say "[1/6] Signing in to GitHub..." Yellow
  Say "      A browser window will open. Approve the login, then come back here." Gray
  Say ""
  gh auth login --hostname github.com --git-protocol https --web
  if ($LASTEXITCODE -ne 0) { Say "Login failed or was cancelled." Red; Read-Host "Press Enter to close"; exit 1 }
} else {
  Say "[1/6] Already signed in to GitHub." Green
}

$USER = (gh api user --jq .login).Trim()
if (-not $USER) { Say "Could not read your GitHub username." Red; Read-Host "Press Enter to close"; exit 1 }
Say "      Signed in as: $USER" Green

# --- 2. Git identity --------------------------------------------------------
Say "[2/6] Checking git identity..." Yellow
if (-not (git config user.name))  { git config user.name  $USER }
if (-not (git config user.email)) { git config user.email "$USER@users.noreply.github.com" }

# --- 3. Commit anything outstanding ----------------------------------------
Say "[3/6] Committing any pending changes..." Yellow
git add -A
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
  git commit -q -m "Tempo deploy $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
  Say "      Committed." Green
} else {
  Say "      Nothing to commit." Gray
}

# --- 4. Create (or reuse) the repo and push --------------------------------
Say "[4/6] Publishing to GitHub..." Yellow
$repoExists = $false
gh repo view "$USER/$REPO" 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) { $repoExists = $true }

if ($repoExists) {
  Say "      Repo $USER/$REPO already exists - pushing updates." Gray
  $hasRemote = $false
  git remote get-url origin 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) { $hasRemote = $true }
  if (-not $hasRemote) { git remote add origin "https://github.com/$USER/$REPO.git" }
  git push -u origin main
  if ($LASTEXITCODE -ne 0) { Say "Push failed." Red; Read-Host "Press Enter to close"; exit 1 }
} else {
  # Public is required for GitHub Pages on a free account. Tempo contains no
  # secrets or API keys, so this is safe.
  gh repo create $REPO --public --source=. --remote=origin --push --description "Tempo - personal music player (PWA)"
  if ($LASTEXITCODE -ne 0) { Say "Repo creation failed." Red; Read-Host "Press Enter to close"; exit 1 }
  Say "      Created $USER/$REPO and pushed." Green
}

# --- 5. Turn on GitHub Pages -----------------------------------------------
Say "[5/6] Enabling GitHub Pages..." Yellow
gh api "repos/$USER/$REPO/pages" 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) {
  Say "      Pages already enabled." Gray
} else {
  gh api --method POST "repos/$USER/$REPO/pages" -f "source[branch]=main" -f "source[path]=/" 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Say "      Could not enable Pages automatically." Yellow
    Say "      Do it by hand: https://github.com/$USER/$REPO/settings/pages" Yellow
    Say "      Set Source = 'Deploy from a branch', Branch = main, Folder = / (root), Save." Yellow
  } else {
    Say "      Enabled." Green
  }
}

$URL = "https://$USER.github.io/$REPO/"

# --- 6. Wait for it to go live ---------------------------------------------
Say "[6/6] Waiting for the site to go live (first build takes ~1-2 min)..." Yellow
$live = $false
for ($i = 1; $i -le 40; $i++) {
  Start-Sleep -Seconds 15
  try {
    $r = Invoke-WebRequest -Uri $URL -UseBasicParsing -TimeoutSec 10
    if ($r.StatusCode -eq 200) { $live = $true; break }
  } catch { }
  Say "      still building... ($($i*15)s)" DarkGray
}

Say ""
Say "==================================================" Cyan
if ($live) {
  Say "  TEMPO IS LIVE" Green
  Say ""
  Say "  $URL" Green
  Say ""
  Say "  Open that on your iPhone. The laptop can be OFF." Gray
} else {
  Say "  PUSHED, BUT NOT SERVING YET" Yellow
  Say ""
  Say "  $URL" Yellow
  Say ""
  Say "  First builds can take a few minutes. Check status at:" Gray
  Say "  https://github.com/$USER/$REPO/actions" Gray
}
Say "==================================================" Cyan
Say ""

# Record the live URL for the docs.
$URL | Out-File -FilePath (Join-Path $PSScriptRoot 'LIVE_URL.txt') -Encoding utf8
Say "URL saved to LIVE_URL.txt" Gray
Say ""
Read-Host "Press Enter to close"
