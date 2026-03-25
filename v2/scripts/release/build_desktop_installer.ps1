param(
  [string]$Version = "",
  [string]$OutDir = "dist\desktop",
  [switch]$SkipChecks,
  [switch]$SkipBuild,
  [switch]$SkipSidecarBuild,
  [switch]$SkipPlaywrightInstall
)

$ErrorActionPreference = "Stop"

function Invoke-Step {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Command
  )
  Write-Host "==> $Command"
  Invoke-Expression $Command
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code ${LASTEXITCODE}: $Command"
  }
}

$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$DesktopPackageJson = Join-Path $Root "apps\desktop\package.json"
if (-not (Test-Path $DesktopPackageJson)) {
  throw "Desktop package.json not found: $DesktopPackageJson"
}

if ([string]::IsNullOrWhiteSpace($Version)) {
  $desktopPackage = Get-Content $DesktopPackageJson -Raw | ConvertFrom-Json
  $Version = [string]$desktopPackage.version
}

$ReleaseRoot = Join-Path $Root $OutDir
$VersionRoot = Join-Path $ReleaseRoot $Version
$BundleOutput = Join-Path $VersionRoot "bundle"
$ManifestPath = Join-Path $VersionRoot "desktop-release-manifest.json"

if (Test-Path $VersionRoot) {
  Remove-Item -Recurse -Force $VersionRoot
}
New-Item -ItemType Directory -Force -Path $BundleOutput | Out-Null

Push-Location $Root
try {
  if (-not $SkipBuild -and -not $SkipSidecarBuild) {
    $sidecarCommand = "powershell -ExecutionPolicy Bypass -File .\scripts\release\build_api_sidecar.ps1"
    if ($SkipPlaywrightInstall) {
      $sidecarCommand = "$sidecarCommand -SkipPlaywrightInstall"
    }
    Invoke-Step $sidecarCommand
  }

  if (-not $SkipChecks) {
    Invoke-Step "pnpm --filter @rpa/designer typecheck"
    Invoke-Step "pnpm --filter @rpa/desktop typecheck"
    Invoke-Step "powershell -ExecutionPolicy Bypass -File .\scripts\run_python310.ps1 scripts/python_syntax_check.py"
    Push-Location (Join-Path $Root "apps\desktop\src-tauri")
    try {
      Invoke-Step "cargo check"
    } finally {
      Pop-Location
    }
  }

  if (-not $SkipBuild) {
    Invoke-Step "pnpm --filter @rpa/desktop build:tauri"
  }
} finally {
  Pop-Location
}

$SourceBundleRoot = Join-Path $Root "apps\desktop\src-tauri\target\release\bundle"
if (-not (Test-Path $SourceBundleRoot)) {
  throw "Bundle output not found: $SourceBundleRoot"
}

Copy-Item -Recurse -Force (Join-Path $SourceBundleRoot "*") $BundleOutput

$NsisOutput = Join-Path $BundleOutput "nsis"
if (Test-Path $NsisOutput) {
  Get-ChildItem -Path $NsisOutput -File | Where-Object {
    $_.Name -like "RPA Flow Desktop_*_x64-setup.exe" -and $_.Name -notlike "RPA Flow Desktop_${Version}_x64-setup.exe"
  } | Remove-Item -Force
}

$artifacts = Get-ChildItem -Path $BundleOutput -Recurse -File | ForEach-Object {
  $relativePath = $_.FullName.Substring($BundleOutput.Length).TrimStart('\', '/').Replace('\', '/')
  [ordered]@{
    relativePath = $relativePath
    sizeBytes = [int64]$_.Length
    sha256 = (Get-FileHash -Algorithm SHA256 -Path $_.FullName).Hash
  }
}

$manifest = [ordered]@{
  version = $Version
  generatedAt = (Get-Date).ToString("s")
  platform = "windows"
  sourceBundleRoot = $SourceBundleRoot
  outputDir = $VersionRoot
  artifacts = @($artifacts)
}
$manifest | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 $ManifestPath

Write-Host ""
Write-Host "Desktop release package is ready."
Write-Host "Version: $Version"
Write-Host "Bundle:  $BundleOutput"
Write-Host "Manifest:$ManifestPath"
