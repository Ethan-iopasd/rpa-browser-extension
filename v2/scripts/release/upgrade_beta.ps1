param(
  [Parameter(Mandatory = $true)]
  [string]$PackagePath,
  [Parameter(Mandatory = $true)]
  [string]$TargetDir
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $PackagePath)) {
  throw "找不到安装包：$PackagePath"
}

if (-not (Test-Path $TargetDir)) {
  New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null
}

$BackupRoot = Join-Path $TargetDir "_backup"
$Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$BackupDir = Join-Path $BackupRoot $Timestamp
New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null

$important = @("services", "apps", "packages", "docs", "scripts", "README.md")
foreach ($item in $important) {
  $source = Join-Path $TargetDir $item
  if (Test-Path $source) {
    Copy-Item -Recurse -Force $source (Join-Path $BackupDir $item)
  }
}

$ExtractDir = Join-Path $TargetDir "_upgrade_tmp"
if (Test-Path $ExtractDir) {
  Remove-Item -Recurse -Force $ExtractDir
}
New-Item -ItemType Directory -Path $ExtractDir -Force | Out-Null
Expand-Archive -Path $PackagePath -DestinationPath $ExtractDir -Force

Get-ChildItem -Path $ExtractDir | ForEach-Object {
  Copy-Item -Recurse -Force $_.FullName $TargetDir
}

Remove-Item -Recurse -Force $ExtractDir
Write-Host "升级完成。备份目录：$BackupDir"
