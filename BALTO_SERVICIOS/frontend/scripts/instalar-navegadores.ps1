$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)
npx playwright install chromium firefox webkit
