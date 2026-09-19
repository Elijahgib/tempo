# Tempo -> GitHub Pages, one command.
#
#   Right-click this file > "Run with PowerShell"
#   ...or from a terminal in this folder:   .\DEPLOY.ps1
#
# Logs you into GitHub if needed, creates the repo if missing, pushes, turns on
# GitHub Pages if not configured, waits for the site, and prints your URL.
# Safe to re-run.
#
# NOTE on error handling: `gh` writes to stderr for ordinary "not found" cases
# (no repo yet, Pages not configured). Under $ErrorActionPreference='Stop' those
# stderr writes become TERMINATING errors and kill the script on a completely
# expected 404 — which is exactly how earlier versions crashed on first run.
# Every native call therefore goes through Invoke-Native, which isolates stderr
# and returns the exit code instead of throwing.

$ErrorActionPreference = 'Continue'
Set-Location -Path $PSScriptRoot

$REPO = 'tempo'

function Say($msg, $color = 'White') { Write-Host $msg -ForegroundColor $color }

function Invoke-Native {
  param([Parameter(Mandatory = $true)][scriptblock]$Block)
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $global:LASTEXITCODE = 0
  $text = ''
  try {
    $text = (& $Block 2>&1 | Out-String)
  } catch {
    $text = $_.Exception.Message
    if ($global:LASTEXITCODE -eq 0) { $global:LASTEXITCODE = 1 }
  } finally {
    $ErrorActionPreference = $prev
  }
  [pscustomobject]@{ Output = $text.Trim(); Code = $global:LASTEXITCODE }
}

Say ""
Say "==================================================" Cyan
Say "  TEMPO - DEPLOY TO GITHUB PAGES" Cyan
Say "==================================================" Cyan
Say ""

# --- 0. gh present? ---------------------------------------------------------
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  Say "GitHub CLI (gh) is not installed." Red
  Say "Install from https://cli.github.com then re-run." Yellow
  Read-Host "Press Enter to close"; exit 1
}

# --- 1. Authenticate --------------------------------------------------------
$auth = Invoke-Native { gh auth status }
if ($auth.Code -ne 0) {
  Say "[1/6] Signing in to GitHub..." Yellow
  Say "      A browser window will open. Approve, then come back here." Gray
  gh auth login --hostname github.com --git-protocol https --web
  if ($LASTEXITCODE -ne 0) { Say "Login failed or cancelled." Red; Read-Host "Press Enter to close"; exit 1 }
} else {
  Say "[1/6] Already signed in." Green
}

$who = Invoke-Native { gh api user --jq .login }
$USER = $who.Output.Trim()
if (-not $USER -or $who.Code -ne 0) { Say "Could not read your GitHub username." Red; Read-Host "Press Enter to close"; exit 1 }
Say "      Signed in as: $USER" Green

# --- 2. Git identity --------------------------------------------------------
Say "[2/6] Checking git identity..." Yellow
if (-not (Invoke-Native { git config user.name }).Output)  { Invoke-Native { git config user.name  $USER } | Out-Null }
if (-not (Invoke-Native { git config user.email }).Output) { Invoke-Native { git config user.email "$USER@users.noreply.github.com" } | Out-Null }

# --- 3. Commit anything outstanding ----------------------------------------
Say "[3/6] Committing pending changes..." Yellow
Invoke-Native { git add -A } | Out-Null
$staged = Invoke-Native { git diff --cached --quiet }
if ($staged.Code -ne 0) {
  Invoke-Native { git commit -q -m "Tempo deploy $(Get-Date -Format 'yyyy-MM-dd HH:mm')" } | Out-Null
  Say "      Committed." Green
} else {
  Say "      Nothing to commit." Gray
}

# --- 4. Create (or reuse) the repo, then push ------------------------------
Say "[4/6] Publishing to GitHub..." Yellow
$repo = Invoke-Native { gh repo view "$USER/$REPO" }     # 404 here is normal
if ($repo.Code -eq 0) {
  Say "      Repo $USER/$REPO exists - pushing updates." Gray
  $remote = Invoke-Native { git remote get-url origin }   # error here is normal
  if ($remote.Code -ne 0) { Invoke-Native { git remote add origin "https://github.com/$USER/$REPO.git" } | Out-Null }
  $push = Invoke-Native { git push -u origin main }
  if ($push.Code -ne 0) { Say "Push failed:" Red; Say $push.Output Red; Read-Host "Press Enter to close"; exit 1 }
  Say "      Pushed." Green
} else {
  # Public is required for Pages on a free account. Tempo holds no secrets.
  Say "      Repo not found - creating it." Gray
  $create = Invoke-Native { gh repo create $REPO --public --source=. --remote=origin --push --description "Tempo - personal music player (PWA)" }
  if ($create.Code -ne 0) { Say "Repo creation failed:" Red; Say $create.Output Red; Read-Host "Press Enter to close"; exit 1 }
  Say "      Created $USER/$REPO and pushed." Green
}

# --- 5. Turn on GitHub Pages -----------------------------------------------
Say "[5/6] Configuring GitHub Pages..." Yellow
$pages = Invoke-Native { gh api "repos/$USER/$REPO/pages" }   # 404 here is normal
if ($pages.Code -eq 0) {
  Say "      Pages already enabled." Gray
} else {
  $enable = Invoke-Native { gh api --method POST "repos/$USER/$REPO/pages" -f "source[branch]=main" -f "source[path]=/" }
  if ($enable.Code -eq 0) {
    Say "      Enabled." Green
  } elseif ($enable.Output -match '409|already exists') {
    Say "      Pages already configured." Gray
  } else {
    Say "      Could not enable Pages automatically." Yellow
    Say "      Do it by hand: https://github.com/$USER/$REPO/settings/pages" Yellow
    Say "      Source = 'Deploy from a branch', Branch = main, Folder = / (root), Save." Yellow
    Say "      Detail: $($enable.Output)" DarkGray
  }
}

$URL = "https://$USER.github.io/$REPO/"

# --- 6. Wait for it to go live ---------------------------------------------
Say "[6/6] Waiting for the deploy to go live..." Yellow
$expected = ''
$idx = Join-Path $PSScriptRoot 'index.html'
if (Test-Path $idx) {
  $m = Select-String -Path $idx -Pattern 'v=(\d+\.\d+\.\d+)' | Select-Object -First 1
  if ($m) { $expected = $m.Matches[0].Groups[1].Value }
}
if ($expected) { Say "      Looking for version $expected" Gray }

$live = $false
for ($i = 1; $i -le 40; $i++) {
  Start-Sleep -Seconds 15
  try {
    $r = Invoke-WebRequest -Uri $URL -UseBasicParsing -TimeoutSec 10
    if ($r.StatusCode -eq 200) {
      if (-not $expected -or $r.Content -match [regex]::Escape("v=$expected")) { $live = $true; break }
      Say "      up, but still serving the old build... ($($i*15)s)" DarkGray
    }
  } catch { Say "      building... ($($i*15)s)" DarkGray }
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
  Say "  PUSHED, BUT NOT SERVING THE NEW BUILD YET" Yellow
  Say ""
  Say "  $URL" Yellow
  Say ""
  Say "  GitHub Pages can lag a few minutes. Check:" Gray
  Say "  https://github.com/$USER/$REPO/actions" Gray
}
Say "==================================================" Cyan
Say ""

$URL | Out-File -FilePath (Join-Path $PSScriptRoot 'LIVE_URL.txt') -Encoding utf8
Say "URL saved to LIVE_URL.txt" Gray
Say ""
if ($Host.Name -eq 'ConsoleHost' -and -not $env:TEMPO_NONINTERACTIVE) { Read-Host "Press Enter to close" }
