$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$gitignore = Join-Path $root ".gitignore"
$entries = @(
  ".env.playwright",
  "tests/.auth/",
  "test-results/",
  "playwright-report/",
  "playwright-report-cross-browser/"
)

if (-not (Test-Path $gitignore)) {
  New-Item -ItemType File -Path $gitignore | Out-Null
}

$current = Get-Content $gitignore -ErrorAction SilentlyContinue
foreach ($entry in $entries) {
  if ($current -notcontains $entry) {
    Add-Content -Path $gitignore -Value $entry
  }
}

Write-Host "Gitignore preparado." -ForegroundColor Green
npx playwright --version
npx playwright test --list --project=chromium
