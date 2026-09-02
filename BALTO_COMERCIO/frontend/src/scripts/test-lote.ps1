param(
  [Parameter(Position = 0)]
  [string]$Lote = 'smoke',
  [switch]$Visible,
  [switch]$Ui,
  [switch]$ListOnly,
  [int]$Workers = 1,
  [string]$Reporter = 'list'
)

. "$PSScriptRoot\_balto-playwright-common.ps1"

$batches = Get-BaltoTestBatches
$normalized = $Lote.Trim().ToLowerInvariant()

if ($normalized -eq 'interno' -or $normalized -eq 'completo-interno') {
  $files = Get-BaltoInternalTests
} elseif ($normalized -eq 'todo') {
  $files = Get-UniqueOrderedItems (@($batches['actuales-93']) + @(Get-BaltoInternalTests))
} elseif ($batches.Contains($normalized)) {
  $files = $batches[$normalized]
} else {
  $valid = @($batches.Keys) + @('interno', 'completo-interno', 'todo')
  throw "Lote desconocido '$Lote'. Opciones: $($valid -join ', ')."
}

Invoke-BaltoPlaywright -Files $files -Visible:$Visible -Ui:$Ui -ListOnly:$ListOnly -Workers $Workers -Reporter $Reporter
