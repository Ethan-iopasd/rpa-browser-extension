param(
  [string]$SourceDir = "apps/recorder-extension",
  [string]$OutDir = "dist",
  [string]$NamePrefix = "recorder-extension"
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$sourcePath = Join-Path $repoRoot $SourceDir
$outPath = Join-Path $repoRoot $OutDir

if (!(Test-Path $sourcePath)) {
  throw "Source directory not found: $sourcePath"
}

$manifestPath = Join-Path $sourcePath "manifest.json"
if (!(Test-Path $manifestPath)) {
  throw "manifest.json not found in source directory: $sourcePath"
}

if (!(Test-Path $outPath)) {
  New-Item -ItemType Directory -Path $outPath -Force | Out-Null
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$zipName = "$NamePrefix-$timestamp.zip"
$zipPath = Join-Path $outPath $zipName

if (Test-Path $zipPath) {
  Remove-Item $zipPath -Force
}

# Important: zip extension files directly so manifest.json is at zip root.
Compress-Archive -Path (Join-Path $sourcePath "*") -DestinationPath $zipPath -CompressionLevel Optimal

Write-Host "[pack:recorder-extension] Done: $zipPath"
