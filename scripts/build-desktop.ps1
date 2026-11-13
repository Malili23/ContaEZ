param([switch]$DebugBuild, [switch]$NoBundle)
$ErrorActionPreference = 'Stop'
$taskApp = Split-Path -Parent $PSScriptRoot
$taskWorkspace = Split-Path -Parent (Split-Path -Parent $taskApp)
$taskRust = Join-Path $taskWorkspace 'work\rust'
if (Test-Path -LiteralPath (Join-Path $taskRust 'cargo\bin\cargo.exe')) {
  $env:CARGO_HOME = Join-Path $taskRust 'cargo'
  $env:RUSTUP_HOME = Join-Path $taskRust 'rustup'
  $env:PATH = (Join-Path $env:CARGO_HOME 'bin') + ';' + $env:PATH
}
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) { throw 'Instala Rust estable y las herramientas C++ de Visual Studio, o utiliza el flujo de compilación de GitHub.' }
Push-Location $taskApp
try {
  if (-not (Test-Path -LiteralPath 'node_modules')) { npm ci; if ($LASTEXITCODE -ne 0) { throw 'No se pudieron instalar las dependencias.' } }
  if (-not (Test-Path -LiteralPath 'src-tauri\icons\icon.ico')) { npx tauri icon src-tauri/icons/icon.svg --output src-tauri/icons; if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear el icono de la app.' } }
  $taskArguments = @('tauri','build')
  if ($DebugBuild) { $taskArguments += '--debug' }
  if ($NoBundle) { $taskArguments += '--no-bundle' } else { $taskArguments += @('--bundles','nsis') }
  & npx @taskArguments
  if ($LASTEXITCODE -ne 0) { throw 'La compilación de escritorio no terminó correctamente.' }
} finally { Pop-Location }
