#!/bin/bash
set -euo pipefail

TARGET=$(rustc -vV | grep host | cut -d' ' -f2)
BINARY="src-tauri/binaries/maude-server"

if [ -f "$BINARY" ]; then
  mv "$BINARY" "${BINARY}-${TARGET}"
  echo "Renamed binary to maude-server-${TARGET}"
elif [ -f "${BINARY}.exe" ]; then
  mv "${BINARY}.exe" "${BINARY}-${TARGET}.exe"
  echo "Renamed binary to maude-server-${TARGET}.exe"
else
  echo "Error: No binary found at ${BINARY}" >&2
  exit 1
fi
