#!/bin/bash
set -euo pipefail

task_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$task_root"
if [[ "$(uname -s)" != Darwin || "$(uname -m)" != arm64 ]]; then
  echo 'Compila esta edición en un Mac M1 o posterior, desde Terminal sin Rosetta.' >&2
  exit 1
fi
if (( $(sw_vers -productVersion | cut -d. -f1) < 14 )); then
  echo 'Esta edición requiere macOS 14 o posterior.' >&2
  exit 1
fi
if ! xcode-select -p >/dev/null 2>&1; then
  echo 'Instala las herramientas de Apple con: xcode-select --install' >&2
  exit 1
fi
for task_command in node npm rustup cargo; do
  if ! command -v "$task_command" >/dev/null 2>&1; then
    echo "Falta $task_command. Consulta docs/MAC.md para instalar Node 24 y Rust." >&2
    exit 1
  fi
done
node -e 'if(Number(process.versions.node.split(".")[0])!==24){console.error("Usa Node.js 24 LTS para esta compilación.");process.exit(1)}'

# Locked dependencies and the same compiler in CI and local builds.
export RUSTUP_TOOLCHAIN="${CONTAEZ_RUST_VERSION:-1.100.0}"
export CARGO_TARGET_DIR="$task_root/src-tauri/target"
export MACOSX_DEPLOYMENT_TARGET=14.0
export APPLE_SIGNING_IDENTITY="${APPLE_SIGNING_IDENTITY:--}"
rustup toolchain install "$RUSTUP_TOOLCHAIN" --profile minimal
rustup target add --toolchain "$RUSTUP_TOOLCHAIN" aarch64-apple-darwin
npm ci
npx tauri icon src-tauri/icons/icon.svg --output src-tauri/icons
npm test
npm run build
task_test_args=(test --locked --manifest-path src-tauri/Cargo.toml --target aarch64-apple-darwin --lib)
if [[ "${CONTAEZ_TEST_KEYCHAIN:-0}" != 1 ]]; then
  task_test_args+=(-- --skip system_key_store_can_protect_and_remove_a_temporary_secret)
  echo 'Prueba interactiva del Llavero omitida; usa CONTAEZ_TEST_KEYCHAIN=1 para ejecutarla.'
fi
cargo "${task_test_args[@]}"
npx tauri build --ci --target aarch64-apple-darwin --bundles app,dmg -- --locked

task_bundle="$task_root/src-tauri/target/aarch64-apple-darwin/release/bundle"
task_app="$task_bundle/macos/ContaEZ.app"
task_executable="$task_app/Contents/MacOS/contaez"
test -f "$task_executable"
lipo "$task_executable" -verify_arch arm64
plutil -lint "$task_app/Contents/Info.plist"
task_minimum=$(/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' "$task_app/Contents/Info.plist")
[[ "$task_minimum" == 14.0 ]] || { echo "Mínimo macOS inesperado: $task_minimum" >&2; exit 1; }
codesign --verify --deep --strict --verbose=2 "$task_app"

# The CI runner has an unlocked disposable keychain and a GUI session. This
# catches immediate startup failures without waiting for interactive dialogs.
if [[ -n "${CONTAEZ_CI_KEYCHAIN:-}" ]]; then
  task_startup_log="$task_bundle/STARTUP-TEST.txt"
  "$task_executable" > "$task_startup_log" 2>&1 &
  task_startup_pid=$!
  sleep 5
  if ! kill -0 "$task_startup_pid" 2>/dev/null; then
    cat "$task_startup_log"
    echo 'ContaEZ terminó durante la prueba mínima de arranque.' >&2
    exit 1
  fi
  kill -TERM "$task_startup_pid"
  # Bound shutdown time as well; no other process on the runner is affected.
  for task_attempt in 1 2 3 4 5; do
    if ! kill -0 "$task_startup_pid" 2>/dev/null; then break; fi
    sleep 1
  done
  if kill -0 "$task_startup_pid" 2>/dev/null; then kill -KILL "$task_startup_pid"; fi
  wait "$task_startup_pid" 2>/dev/null || true
  echo 'El proceso nativo permaneció activo cinco segundos; no certifica interacción visual.' | tee -a "$task_startup_log"
fi
task_zip="$task_bundle/ContaEZ-macos-arm64.app.zip"
ditto -c -k --keepParent "$task_app" "$task_zip"
task_dmgs=("$task_bundle"/dmg/*.dmg)
[[ -f "${task_dmgs[0]}" ]] || { echo 'No se generó el instalador DMG.' >&2; exit 1; }
for task_dmg in "${task_dmgs[@]}"; do hdiutil verify "$task_dmg"; done
(
  cd "$task_bundle"
  shasum -a 256 ContaEZ-macos-arm64.app.zip dmg/*.dmg > SHA256SUMS.txt
  {
    printf 'ContaEZ macOS ARM64\nSistema de compilación: '
    sw_vers -productVersion
    printf 'Arquitectura: '; uname -m
    printf 'Mínimo macOS: %s\n' "$task_minimum"
    rustc --version
    node --version
    printf 'Identidad configurada: %s\n' "$APPLE_SIGNING_IDENTITY"
    printf 'La firma ad-hoc (-) no es Developer ID ni notarización de Apple.\n'
    printf 'Pruebas de Rust/TypeScript y validación de paquete ejecutadas en este Mac.\n'
    if [[ -n "${CONTAEZ_CI_KEYCHAIN:-}" ]]; then printf 'Arranque nativo mínimo: proceso activo cinco segundos, cierre limitado al PID de prueba.\n'; fi
    printf 'No certifica interacción visual, OCR ni autorización real de proveedores.\n'
  } > BUILD-INFO.txt
)
echo "Paquetes y sumas SHA-256 disponibles en: $task_bundle"
