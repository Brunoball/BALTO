Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-UniqueOrderedItems([string[]]$Items) {
  $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
  $result = New-Object 'System.Collections.Generic.List[string]'
  foreach ($item in $Items) {
    if ($item -and $seen.Add($item)) { [void]$result.Add($item) }
  }
  return $result.ToArray()
}

function Get-BaltoAllCurrentTests {
  if (-not (Test-Path '.\tests')) {
    throw 'No existe .\tests. Ejecutá el script desde la raíz del frontend.'
  }

  return @(
    Get-ChildItem -Path '.\tests' -Filter '*.spec.js' -File |
      Where-Object { $_.Name -ne 'example.spec.js' } |
      Sort-Object Name |
      ForEach-Object { "tests/$($_.Name)" }
  )
}

function Get-BaltoTestBatches {
  $all = Get-BaltoAllCurrentTests

  return [ordered]@{
    'smoke' = @(
      'tests/00-preflight.spec.js',
      'tests/01-auth.spec.js',
      'tests/11-global-guards.spec.js',
      'tests/18-auth-actions.spec.js'
    )
    'auth' = @(
      'tests/00-preflight.spec.js',
      'tests/01-auth.spec.js',
      'tests/18-auth-actions.spec.js'
    )
    'navegacion' = @(
      'tests/02-navigation-smoke.spec.js',
      'tests/23-internal-navigation-smoke.spec.js',
      'tests/27-movement-search-health.spec.js'
    )
    'servicios' = @(
      'tests/03-services-catalog-crud.spec.js',
      'tests/20-services-inventory-lifecycle.spec.js',
      'tests/25-services-movements-integration.spec.js',
      'tests/26-services-action-surface.spec.js',
      'tests/29-final-services-hardening.spec.js',
      'tests/31-services-pricing-selection-delete-guards.spec.js',
      'tests/32-services-movement-latest-regression.spec.js'
    )
    'stock' = @(
      'tests/03-services-catalog-crud.spec.js',
      'tests/20-services-inventory-lifecycle.spec.js',
      'tests/25-services-movements-integration.spec.js',
      'tests/28-purchase-ui-health.spec.js',
      'tests/29-final-services-hardening.spec.js',
      'tests/31-services-pricing-selection-delete-guards.spec.js',
      'tests/32-services-movement-latest-regression.spec.js'
    )
    'movimientos' = @(
      'tests/04-purchases-credit-note.spec.js',
      'tests/05-sales-credit-note.spec.js',
      'tests/06-budgets.spec.js',
      'tests/07-other-movements.spec.js',
      'tests/13-movement-delete-reversal.spec.js',
      'tests/14-details-and-cancel.spec.js',
      'tests/15-cheques-lifecycle.spec.js',
      'tests/16-movement-details-integrity.spec.js',
      'tests/17-other-income-fiscal.spec.js',
      'tests/25-services-movements-integration.spec.js',
      'tests/27-movement-search-health.spec.js',
      'tests/28-purchase-ui-health.spec.js',
      'tests/29-final-services-hardening.spec.js',
      'tests/31-services-pricing-selection-delete-guards.spec.js',
      'tests/32-services-movement-latest-regression.spec.js'
    )
    'cuentas-corrientes' = @(
      'tests/08-current-accounts.spec.js',
      'tests/19-current-account-entities.spec.js'
    )
    'cheques' = @(
      'tests/09-cheques-smoke.spec.js',
      'tests/15-cheques-lifecycle.spec.js'
    )
    'configuracion' = @(
      'tests/10-config-accounting.spec.js',
      'tests/21-configuration-actions.spec.js',
      'tests/22-configuration-lists-categories.spec.js',
      'tests/24-initial-balances.spec.js'
    )
    'documentos' = @(
      'tests/06-budgets.spec.js',
      'tests/12-documents-readonly.spec.js',
      'tests/17-other-income-fiscal.spec.js',
      'tests/30-export-scope-detail.spec.js',
      'tests/33-latest-document-network-regression.spec.js'
    )
    'exportaciones' = @(
      'tests/30-export-scope-detail.spec.js'
    )
    'lectura-interna' = @(
      'tests/23-internal-navigation-smoke.spec.js',
      'tests/09-cheques-smoke.spec.js',
      'tests/12-documents-readonly.spec.js',
      'tests/27-movement-search-health.spec.js'
    )
    # Alias mantenidos para no romper comandos/scripts viejos. Ya no quedan
    # congelados en “93 tests”: siempre apuntan a todos los *.spec.js actuales.
    'actuales' = $all
    'actuales-93' = $all
  }
}

function Get-BaltoInternalTests {
  # Cambios transversales (routes, auth común, listas globales, helpers compartidos)
  # pueden afectar cualquier módulo. Ejecutar TODO es más seguro y, al descubrir
  # los specs dinámicamente, esta lista no vuelve a quedar desactualizada.
  return Get-BaltoAllCurrentTests
}

function Assert-BaltoTestFilesExist([string[]]$Files) {
  $missing = @($Files | Where-Object { -not (Test-Path $_) })
  if ($missing.Count -gt 0) {
    throw "El lote referencia tests inexistentes:`n  - $($missing -join "`n  - ")"
  }
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

  $Files = Get-UniqueOrderedItems $Files
  if ($Files.Count -eq 0) { throw 'No hay archivos de testing para ejecutar.' }
  Assert-BaltoTestFilesExist $Files
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
