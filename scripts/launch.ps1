$ErrorActionPreference = 'Stop'
$taskApp = Split-Path -Parent $PSScriptRoot
$taskRelease = Join-Path $taskApp 'src-tauri\target\release\contaez.exe'
$taskDebug = Join-Path $taskApp 'src-tauri\target\debug\contaez.exe'
if (Test-Path -LiteralPath $taskRelease) { Start-Process -FilePath $taskRelease -WindowStyle Hidden; exit }
if (Test-Path -LiteralPath $taskDebug) { Start-Process -FilePath $taskDebug -WindowStyle Hidden; exit }
Push-Location $taskApp
try {
  if (-not (Test-Path -LiteralPath 'node_modules')) { npm ci; if ($LASTEXITCODE -ne 0) { throw 'No se pudieron instalar las dependencias.' } }
  Start-Process -FilePath 'http://127.0.0.1:1420'
  npm run dev
} finally { Pop-Location }
