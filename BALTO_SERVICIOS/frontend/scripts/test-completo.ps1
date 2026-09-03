$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)
npx playwright test --project=chromium
