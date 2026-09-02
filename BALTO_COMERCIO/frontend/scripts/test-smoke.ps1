$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)
npx playwright test --grep "@smoke" --project=chromium
