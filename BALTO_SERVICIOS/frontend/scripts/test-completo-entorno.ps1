param(
  [switch]$Headed
)

$ErrorActionPreference = "Stop"

if (!(Test-Path ".env.playwright")) {
  throw "Falta .env.playwright. Copiá .env.playwright.example como .env.playwright."
}

# Elimina valores viejos dejados en esta terminal para que manden los archivos locales.
@(
  "PW_API_URL", "PW_BASE_URL", "PW_USER", "PW_PASSWORD",
  "PW_ALLOW_MUTATIONS", "PW_ALLOW_PRODUCTION",
  "PW_EXPECTED_TENANT_ID", "PW_EXPECTED_TENANT_NAME",
  "PW_SKIP_WEBSERVER", "PW_SKIP_TIENDA_NUBE", "PW_CLEANUP",
  "PW_TIMEOUT_MS", "PW_EXPECT_TIMEOUT_MS", "PW_SLOW_MO_MS", "PW_RUN_LABEL"
) | ForEach-Object {
  Remove-Item "Env:$_" -ErrorAction SilentlyContinue
}

$argsList = @(
  "playwright", "test",
  "--project=chromium",
  "--workers=1",
  "--reporter=list"
)

if ($Headed) { $argsList += "--headed" }

Write-Host "Ejecutando la suite COMPLETA. La cuenta se selecciona automáticamente según PW_API_URL." -ForegroundColor Cyan
& npx @argsList
exit $LASTEXITCODE
