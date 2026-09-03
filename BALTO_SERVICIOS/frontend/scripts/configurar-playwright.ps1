$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root ".env.playwright"

$api = Read-Host "Backend para testing [https://balto.3devsnet.com/api/routes]"
if ([string]::IsNullOrWhiteSpace($api)) { $api = "https://balto.3devsnet.com/api/routes" }

$user = Read-Host "Usuario [admin]"
if ([string]::IsNullOrWhiteSpace($user)) { $user = "admin" }

$passwordSecure = Read-Host "Contraseña" -AsSecureString
$passwordPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($passwordSecure)
try { $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPtr) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPtr) }

if ([string]::IsNullOrWhiteSpace($password)) { throw "La contraseña no puede quedar vacía." }

$content = @"
PW_BASE_URL=http://127.0.0.1:3000
PW_API_URL=$api
PW_USER=$user
PW_PASSWORD=$password
PW_ALLOW_MUTATIONS=1
PW_ALLOW_PRODUCTION=0
PW_SKIP_WEBSERVER=0
PW_START_COMMAND=npm start
PW_CLEANUP=0
PW_TIMEOUT_MS=90000
PW_EXPECT_TIMEOUT_MS=15000
PW_SLOW_MO_MS=0
PW_SKIP_TIENDA_NUBE=1
"@

Set-Content -Path $envFile -Value $content -Encoding UTF8
Write-Host "Configuración guardada en $envFile" -ForegroundColor Green
Write-Host "No subas ese archivo a Git." -ForegroundColor Yellow
