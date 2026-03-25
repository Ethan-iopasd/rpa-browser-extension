$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$Candidates = @(
  (Join-Path $Root ".venv310\Scripts\python.exe"),
  (Join-Path $Root ".venv\Scripts\python.exe")
)

foreach ($candidate in $Candidates) {
  if (Test-Path $candidate) {
    & $candidate @args
    exit $LASTEXITCODE
  }
}

$py = Get-Command py -ErrorAction SilentlyContinue
if ($py) {
  & py -3.10 @args
  exit $LASTEXITCODE
}

throw "Python 3.10 interpreter not found. Create .venv310/.venv or install Python 3.10 for the py launcher."
