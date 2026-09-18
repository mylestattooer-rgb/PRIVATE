#!/bin/bash
# Double-click this file to rebuild the catalogue and open it.
# macOS may ask once: right-click -> Open -> Open.
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "  Node isn't installed, and the catalogue needs it to build."
  echo "  Install it from https://nodejs.org (the LTS button), then"
  echo "  double-click this file again."
  echo
  echo "  Press any key to close."
  read -r -n 1
  exit 1
fi

node build.mjs || {
  echo
  echo "  The build stopped on an error — the message above says why."
  echo "  Press any key to close."
  read -r -n 1
  exit 1
}

open index.html
