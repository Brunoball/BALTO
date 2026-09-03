$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)
$env:PW_SLOW_MO_MS = "80"
npx playwright test --project=chromium --headed
