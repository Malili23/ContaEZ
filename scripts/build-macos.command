#!/bin/bash
# If an archive lost the executable bit, run: bash scripts/build-macos.command
task_directory="$(cd "$(dirname "$0")" && pwd)"
task_status=0
if /bin/bash "$task_directory/build-macos.sh"; then
  open "$task_directory/../src-tauri/target/aarch64-apple-darwin/release/bundle"
else
  task_status=$?
  echo 'La compilación no terminó. Revisa el mensaje anterior y docs/MAC.md.'
fi
read -r -p 'Pulsa Intro para cerrar esta ventana.' _task_answer || true
exit "$task_status"
