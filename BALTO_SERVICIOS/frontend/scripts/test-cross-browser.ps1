$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)
npx playwright test --config=playwright.cross-browser.config.js
