param(
  [string]$TargetTriple = "x86_64-pc-windows-msvc",
  [string]$PythonVersion = "3.10",
  [string]$VenvDir = ".venv-sidecar",
  [string]$PythonExecutable = "",
  [switch]$SkipPlaywrightInstall,
  [switch]$SkipUv,
  [switch]$UseCurrentPythonEnv
)

$ErrorActionPreference = "Stop"

function Assert-LastExitCode {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Step
  )
  if ($LASTEXITCODE -ne 0) {
    throw "Step failed with exit code ${LASTEXITCODE}: $Step"
  }
}

function Ensure-PipAvailable {
  param(
    [Parameter(Mandatory = $true)]
    [string]$PythonPath,
    [Parameter(Mandatory = $true)]
    [string]$ContextLabel
  )

  & $PythonPath -m pip --version | Out-Null
  if ($LASTEXITCODE -eq 0) {
    return
  }

  Write-Warning "pip not available in $ContextLabel, attempting ensurepip bootstrap..."
  $attempts = 3
  for ($attempt = 1; $attempt -le $attempts; $attempt++) {
    & $PythonPath -m ensurepip --upgrade --default-pip
    if ($LASTEXITCODE -eq 0) {
      break
    }
    if ($attempt -lt $attempts) {
      Start-Sleep -Milliseconds (600 * $attempt)
    }
  }
  Assert-LastExitCode "$ContextLabel python -m ensurepip --upgrade --default-pip"

  & $PythonPath -m pip --version | Out-Null
  Assert-LastExitCode "$ContextLabel python -m pip --version"
}

$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$SidecarName = "rpa-api-sidecar"
$SidecarBinaryName = "${SidecarName}-${TargetTriple}"
$NativeHostName = "rpa-native-picker-host"
$NativeHostBinaryName = "${NativeHostName}-${TargetTriple}"
$OutBinDir = Join-Path $Root "apps\desktop\src-tauri\bin"
$BuildRoot = Join-Path $Root ".sidecar-build"
$PyInstallerWork = Join-Path $BuildRoot "work"
$PyInstallerDist = Join-Path $BuildRoot "dist"
$PlaywrightBrowsersDir = Join-Path $Root ".playwright-browsers"
$TempRoot = Join-Path $Root ".sidecar-temp"
$ApiSourcePath = Join-Path $Root "services\api"
$AgentSourcePath = Join-Path $Root "apps\agent"
$SidecarRuntimeDeps = @(
  "pyinstaller",
  "fastapi",
  "uvicorn",
  "pydantic",
  "cryptography",
  "apscheduler",
  "playwright"
)

New-Item -ItemType Directory -Force -Path $TempRoot | Out-Null
$env:TEMP = $TempRoot
$env:TMP = $TempRoot
$env:TMPDIR = $TempRoot
if ([string]::IsNullOrWhiteSpace($env:UV_CACHE_DIR)) {
  $env:UV_CACHE_DIR = Join-Path $Root ".uv-cache"
}

# 使用国内镜像源，解决直连 PyPI 的 SSL/网络问题
$PipMirrorUrl = "https://pypi.tuna.tsinghua.edu.cn/simple/"
$PipMirrorHost = "pypi.tuna.tsinghua.edu.cn"
if ([string]::IsNullOrWhiteSpace($env:UV_INDEX_URL)) {
  $env:UV_INDEX_URL = $PipMirrorUrl
  $env:UV_EXTRA_INDEX_URL = ""
}

Write-Host "==> Preparing Python sidecar build environment"
$uv = Get-Command uv -ErrorAction SilentlyContinue
$venvPath = Join-Path $Root $VenvDir
$venvPython = Join-Path $venvPath "Scripts\python.exe"
$usedUv = $false
$basePython = $null

if (-not [string]::IsNullOrWhiteSpace($PythonExecutable)) {
  $resolved = Resolve-Path $PythonExecutable -ErrorAction SilentlyContinue
  if ($resolved) {
    $basePython = [string]$resolved
  }
}
if (-not $basePython) {
  $activeVenv = $env:VIRTUAL_ENV
  if (-not [string]::IsNullOrWhiteSpace($activeVenv)) {
    $candidate = Join-Path $activeVenv "Scripts\python.exe"
    if (Test-Path $candidate) {
      $basePython = $candidate
    }
  }
}
if (-not $basePython) {
  $pythonCmd = Get-Command python -ErrorAction SilentlyContinue
  if ($pythonCmd) {
    $basePython = $pythonCmd.Source
  }
}

Push-Location $Root
try {
  if ($UseCurrentPythonEnv) {
    if (-not $basePython) {
      throw "UseCurrentPythonEnv requires a valid Python interpreter. Pass -PythonExecutable."
    }
    $venvPython = $basePython
    Write-Host "==> Using current Python environment: $venvPython"
    & $venvPython -m pip --version | Out-Null
    if ($LASTEXITCODE -eq 0) {
      & $venvPython -m pip install --upgrade pip --index-url $PipMirrorUrl --trusted-host $PipMirrorHost
      Assert-LastExitCode "pip upgrade (current env)"
      & $venvPython -m pip install $SidecarRuntimeDeps --index-url $PipMirrorUrl --trusted-host $PipMirrorHost
      Assert-LastExitCode "pip install dependencies (current env)"
    }
    elseif ($uv) {
      Write-Warning "pip unavailable in current env, using uv pip fallback."
      uv pip install --python $venvPython $SidecarRuntimeDeps --index-url $PipMirrorUrl
      Assert-LastExitCode "uv pip install dependencies (current env)"
    }
    else {
      Ensure-PipAvailable -PythonPath $venvPython -ContextLabel "current-env"
      & $venvPython -m pip install --upgrade pip --index-url $PipMirrorUrl --trusted-host $PipMirrorHost
      Assert-LastExitCode "pip upgrade (current env after ensurepip)"
      & $venvPython -m pip install $SidecarRuntimeDeps --index-url $PipMirrorUrl --trusted-host $PipMirrorHost
      Assert-LastExitCode "pip install dependencies (current env after ensurepip)"
    }
    $usedUv = $true
  }

  if ($uv -and -not $SkipUv -and -not $UseCurrentPythonEnv) {
    try {
      if (-not (Test-Path $venvPython)) {
        Write-Host "==> uv venv --python $PythonVersion $VenvDir"
        uv venv --python $PythonVersion $VenvDir
        Assert-LastExitCode "uv venv"
      }
      Write-Host "==> Installing API/Agent dependencies into sidecar venv via uv"
      uv pip install --python $venvPython ".\services\api" ".\apps\agent" pyinstaller --index-url $PipMirrorUrl
      Assert-LastExitCode "uv pip install"
      $usedUv = $true
    }
    catch {
      Write-Warning "uv-based environment setup failed, fallback to python -m venv / pip. Reason: $($_.Exception.Message)"
    }
  }

  if (-not $usedUv) {
    Write-Host "==> Using python -m venv / pip fallback"
    $venvHealthy = $false
    if (Test-Path $venvPython) {
      & $venvPython -m pip --version | Out-Null
      if ($LASTEXITCODE -eq 0) {
        $venvHealthy = $true
      }
      else {
        try {
          Remove-Item -Recurse -Force $venvPath
        }
        catch {
          Write-Warning "Failed to clean broken venv ($venvPath), trying to recreate over existing directory."
        }
      }
    }
    if (-not $venvHealthy) {
      if ($basePython) {
        & $basePython -m venv $venvPath
        Assert-LastExitCode "$basePython -m venv"
      }
      else {
        $pyLauncher = Get-Command py -ErrorAction SilentlyContinue
        if ($pyLauncher) {
          & py "-$PythonVersion" -m venv $venvPath
          Assert-LastExitCode "py -$PythonVersion -m venv"
        }
        else {
          python -m venv $venvPath
          Assert-LastExitCode "python -m venv"
        }
      }
      & $venvPython -m pip --version | Out-Null
      if ($LASTEXITCODE -ne 0 -and $uv) {
        Write-Warning "pip unavailable after venv bootstrap, using uv pip fallback."
        uv pip install --python $venvPython $SidecarRuntimeDeps --index-url $PipMirrorUrl
        Assert-LastExitCode "uv pip install dependencies (venv bootstrap)"
        $venvHealthy = $true
      }
      else {
        Ensure-PipAvailable -PythonPath $venvPython -ContextLabel "venv-bootstrap"
      }
    }
    & $venvPython -m pip --version | Out-Null
    if ($LASTEXITCODE -eq 0) {
      & $venvPython -m pip install --upgrade pip --index-url $PipMirrorUrl --trusted-host $PipMirrorHost
      Assert-LastExitCode "pip upgrade"
      & $venvPython -m pip install $SidecarRuntimeDeps --index-url $PipMirrorUrl --trusted-host $PipMirrorHost
      Assert-LastExitCode "pip install dependencies"
    }
    elseif ($uv) {
      Write-Warning "pip unavailable in sidecar venv, using uv pip fallback."
      uv pip install --python $venvPython $SidecarRuntimeDeps --index-url $PipMirrorUrl
      Assert-LastExitCode "uv pip install dependencies (venv ready)"
    }
    else {
      Ensure-PipAvailable -PythonPath $venvPython -ContextLabel "venv-ready"
      & $venvPython -m pip install --upgrade pip --index-url $PipMirrorUrl --trusted-host $PipMirrorHost
      Assert-LastExitCode "pip upgrade (after ensurepip)"
      & $venvPython -m pip install $SidecarRuntimeDeps --index-url $PipMirrorUrl --trusted-host $PipMirrorHost
      Assert-LastExitCode "pip install dependencies (after ensurepip)"
    }
  }

  if (-not (Test-Path $PlaywrightBrowsersDir)) {
    New-Item -ItemType Directory -Force -Path $PlaywrightBrowsersDir | Out-Null
  }

  if (-not $SkipPlaywrightInstall) {
    Write-Host "==> Installing Playwright Chromium to $PlaywrightBrowsersDir"
    $env:PLAYWRIGHT_BROWSERS_PATH = $PlaywrightBrowsersDir
    & $venvPython -m playwright install chromium
    Assert-LastExitCode "playwright install chromium"
  }

  if (Test-Path $BuildRoot) {
    Remove-Item -Recurse -Force $BuildRoot
  }
  New-Item -ItemType Directory -Force -Path $PyInstallerWork | Out-Null
  New-Item -ItemType Directory -Force -Path $PyInstallerDist | Out-Null

  Write-Host "==> Building sidecar binaries via PyInstaller"
  # Force PyInstaller analysis to resolve local source tree first, instead of stale site-packages wheels.
  $env:PYTHONPATH = "$AgentSourcePath;$ApiSourcePath"
  & $venvPython -m PyInstaller `
    --noconfirm `
    --clean `
    --onefile `
    --name $SidecarBinaryName `
    --distpath $PyInstallerDist `
    --workpath $PyInstallerWork `
    --specpath $BuildRoot `
    --paths $ApiSourcePath `
    --paths $AgentSourcePath `
    (Join-Path $ApiSourcePath "app_sidecar.py")
  Assert-LastExitCode "PyInstaller API sidecar build"

  & $venvPython -m PyInstaller `
    --noconfirm `
    --clean `
    --onefile `
    --name $NativeHostBinaryName `
    --distpath $PyInstallerDist `
    --workpath $PyInstallerWork `
    --specpath $BuildRoot `
    --paths $ApiSourcePath `
    --paths $AgentSourcePath `
    (Join-Path $ApiSourcePath "app_native_host.py")
  Assert-LastExitCode "PyInstaller native host build"
}
finally {
  Pop-Location
}

$builtExe = Join-Path $PyInstallerDist "${SidecarBinaryName}.exe"
if (-not (Test-Path $builtExe)) {
  throw "Sidecar executable not found: $builtExe"
}
$builtNativeHostExe = Join-Path $PyInstallerDist "${NativeHostBinaryName}.exe"
if (-not (Test-Path $builtNativeHostExe)) {
  throw "Native host executable not found: $builtNativeHostExe"
}

New-Item -ItemType Directory -Force -Path $OutBinDir | Out-Null
$targetExe = Join-Path $OutBinDir "${SidecarBinaryName}.exe"
$targetNativeHostExe = Join-Path $OutBinDir "${NativeHostBinaryName}.exe"
try {
  Copy-Item -Force $builtExe $targetExe -ErrorAction Stop
  Copy-Item -Force $builtNativeHostExe $targetNativeHostExe -ErrorAction Stop
}
catch {
  $message = $_.Exception.Message
  if ($message -like "*being used by another process*") {
    throw "Failed to replace sidecar binary because target is locked: $targetExe or $targetNativeHostExe`nClose RPA Flow Desktop (and any running sidecar process), then retry."
  }
  throw
}

Write-Host ""
Write-Host "Python API sidecar build complete."
Write-Host "Target triple: $TargetTriple"
Write-Host "Sidecar exe:   $targetExe"
Write-Host "Native host:   $targetNativeHostExe"
Write-Host "Browsers dir:  $PlaywrightBrowsersDir"
