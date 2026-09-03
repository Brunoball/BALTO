$ErrorActionPreference = "Stop"

function ConvertFrom-SecureValue([Security.SecureString]$Value) {
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)

  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  }
  finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  }
}

function Configure-Profile(
  [string]$Profile,
  [string]$Label,
  [string]$AllowProduction
) {
  Write-Host ""
  Write-Host "Configurando $Label" -ForegroundColor Cyan

  $user = Read-Host "Usuario"
  $securePassword = Read-Host "Contrasena" -AsSecureString
  $password = ConvertFrom-SecureValue $securePassword
  $tenantId = Read-Host "ID del tenant de pruebas"
  $tenantName = Read-Host "Nombre exacto del tenant de pruebas"

  if (
    [string]::IsNullOrWhiteSpace($user) -or
    [string]::IsNullOrWhiteSpace($password) -or
    [string]::IsNullOrWhiteSpace($tenantId)
  ) {
    throw "Usuario, contrasena e ID de tenant son obligatorios para $Label."
  }

  $content = @(
    "PW_USER=$user"
    "PW_PASSWORD=$password"
    "PW_EXPECTED_TENANT_ID=$tenantId"
    "PW_EXPECTED_TENANT_NAME=$tenantName"
    "PW_ALLOW_PRODUCTION=$AllowProduction"
  ) -join [Environment]::NewLine

  Set-Content `
    -Path ".env.playwright.$Profile.local" `
    -Value $content `
    -Encoding UTF8
}

Configure-Profile "staging" "HOSTING DE PRUEBAS" "0"
Configure-Profile "production" "PRODUCCION / TENANT EXCLUSIVO DE TESTING" "1"

$gitignorePath = ".gitignore"

$requiredLines = @(
  ".env.playwright"
  ".env.playwright.*.local"
  "tests/.auth/"
  "test-results/"
  "playwright-report/"
)

$existing = if (Test-Path $gitignorePath) {
  Get-Content $gitignorePath
}
else {
  @()
}

$missing = $requiredLines | Where-Object {
  $existing -notcontains $_
}

if ($missing.Count -gt 0) {
  $value = [Environment]::NewLine +
    ($missing -join [Environment]::NewLine)

  Add-Content -Path $gitignorePath -Value $value
}

Write-Host ""
Write-Host "Cuentas guardadas localmente y protegidas por .gitignore." -ForegroundColor Green
Write-Host "Ahora cambia solamente PW_API_URL dentro de .env.playwright." -ForegroundColor Green
