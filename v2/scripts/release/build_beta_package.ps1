param(
  [string]$Version = "0.5.0-beta",
  [string]$OutDir = "dist"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$ReleaseRoot = Join-Path $Root $OutDir
$WorkDir = Join-Path $ReleaseRoot "beta-$Version"
$ZipPath = Join-Path $ReleaseRoot "rpa-flow-v2-$Version.zip"

if (Test-Path $WorkDir) {
  Remove-Item -Recurse -Force $WorkDir
}
if (Test-Path $ZipPath) {
  Remove-Item -Force $ZipPath
}

New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null

Copy-Item -Recurse -Force (Join-Path $Root "apps") (Join-Path $WorkDir "apps")
Copy-Item -Recurse -Force (Join-Path $Root "services") (Join-Path $WorkDir "services")
Copy-Item -Recurse -Force (Join-Path $Root "packages") (Join-Path $WorkDir "packages")
Copy-Item -Recurse -Force (Join-Path $Root "docs") (Join-Path $WorkDir "docs")
Copy-Item -Recurse -Force (Join-Path $Root "scripts") (Join-Path $WorkDir "scripts")
Copy-Item -Force (Join-Path $Root "README.md") (Join-Path $WorkDir "README.md")
Copy-Item -Force (Join-Path $Root "package.json") (Join-Path $WorkDir "package.json")
Copy-Item -Force (Join-Path $Root "pnpm-workspace.yaml") (Join-Path $WorkDir "pnpm-workspace.yaml")
Copy-Item -Force (Join-Path $Root "pyproject.toml") (Join-Path $WorkDir "pyproject.toml")

$manifest = @{
  version = $Version
  buildTime = (Get-Date).ToString("s")
  note = "RPA Flow V2 Beta 打包产物"
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 (Join-Path $WorkDir "beta-manifest.json")

Compress-Archive -Path (Join-Path $WorkDir "*") -DestinationPath $ZipPath -CompressionLevel Optimal
Write-Host "Beta package ready: $ZipPath"
