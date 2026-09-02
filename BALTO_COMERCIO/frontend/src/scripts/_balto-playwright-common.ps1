Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-BaltoTestBatches {
  return [ordered]@{
    'smoke' = @(
      'tests/00-preflight.spec.js',
      'tests/01-auth.spec.js',
      'tests/11-global-guards.spec.js',
      'tests/18-auth-actions.spec.js'
    )
    'navegacion' = @(
      'tests/23-internal-navigation-smoke.spec.js'
    )
    'auth' = @(
      'tests/00-preflight.spec.js',
      'tests/01-auth.spec.js',
      'tests/18-auth-actions.spec.js'
    )
    'movimientos' = @(
      'tests/04-purchases-credit-note.spec.js',
      'tests/05-sales-credit-note.spec.js',
      'tests/06-budgets.spec.js',
      'tests/07-other-movements.spec.js',
      'tests/13-movement-delete-reversal.spec.js',
      'tests/14-details-and-cancel.spec.js',
      'tests/15-cheques-lifecycle.spec.js',
      'tests/16-movement-details-integrity.spec.js'
    )
    'cuentas-corrientes' = @(
      'tests/08-current-accounts.spec.js',
      'tests/19-current-account-entities.spec.js'
    )
    'stock' = @(
      'tests/03-stock-crud.spec.js',
      'tests/20-stock-lifecycle.spec.js',
      'tests/22-stock-variants-lifecycle.spec.js'
    )
    'cheques' = @(
      'tests/09-cheques-smoke.spec.js',
      'tests/15-cheques-lifecycle.spec.js'
    )
    'configuracion' = @(
      'tests/21-configuration-actions.spec.js'
    )
    'documentos' = @(
      'tests/06-budgets.spec.js',
      'tests/12-documents-readonly.spec.js'
    )
    'lectura-interna' = @(
      'tests/23-internal-navigation-smoke.spec.js',
      'tests/09-cheques-smoke.spec.js',
      'tests/12-documents-readonly.spec.js'
    )
    'actuales-93' = @(
      'tests/00-preflight.spec.js',
      'tests/01-auth.spec.js',
      'tests/02-navigation-smoke.spec.js',
      'tests/03-stock-crud.spec.js',
      'tests/04-purchases-credit-note.spec.js',
      'tests/05-sales-credit-note.spec.js',
      'tests/06-budgets.spec.js',
      'tests/07-other-movements.spec.js',
      'tests/08-current-accounts.spec.js',
      'tests/09-cheques-smoke.spec.js',
      'tests/10-config-accounting.spec.js',
      'tests/11-global-guards.spec.js',
      'tests/12-documents-readonly.spec.js',
      'tests/13-movement-delete-reversal.spec.js',
      'tests/14-details-and-cancel.spec.js',
      'tests/15-cheques-lifecycle.spec.js',
      'tests/16-movement-details-integrity.spec.js',
      'tests/17-other-income-fiscal.spec.js'
    )
  }
}

function Get-UniqueOrderedItems([string[]]$Items) {
  $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
  $result = New-Object 'System.Collections.Generic.List[string]'
  foreach ($item in $Items) {
    if ($seen.Add($item)) { [void]$result.Add($item) }
  }
  return $result.ToArray()
}

function Get-BaltoInternalTests {
  $batches = Get-BaltoTestBatches
  $all = @()
  foreach ($name in @('smoke', 'navegacion', 'movimientos', 'cuentas-corrientes', 'stock', 'cheques', 'configuracion')) {
    $all += $batches[$name]
  }
  return Get-UniqueOrderedItems $all
}

function Invoke-BaltoPlaywright {
  param(
    [Parameter(Mandatory = $true)][string[]]$Files,
    [switch]$Visible,
    [switch]$Ui,
    [switch]$ListOnly,
    [int]$Workers = 1,
    [string]$Reporter = 'list'
  )

  if (-not (Test-Path '.\package.json')) {
    throw 'Ejecutá el script desde la raíz del frontend, donde está package.json.'
  }

  $env:PW_SKIP_TIENDA_NUBE = '1'
  Remove-Item Env:PW_ALLOW_ARCA -ErrorAction SilentlyContinue

  $args = @('playwright', 'test')
  $args += $Files
  $args += '--project=chromium'
  $args += "--workers=$Workers"
  $args += "--reporter=$Reporter"

  if ($Visible) { $args += '--headed' }
  if ($Ui) { $args += '--ui' }
  if ($ListOnly) { $args += '--list' }

  Write-Host ''
  Write-Host ('Ejecutando {0} archivo(s):' -f $Files.Count) -ForegroundColor Cyan
  $Files | ForEach-Object { Write-Host "  - $_" }
  Write-Host ''

  & npx @args
  if ($LASTEXITCODE -ne 0) {
    throw "Playwright terminó con código $LASTEXITCODE."
  }
}
