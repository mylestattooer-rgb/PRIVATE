#!/bin/bash
# Double-click to rebuild the flash book and open it ready to print.
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "  Node isn't installed, and the book needs it to build."
  echo "  Get it from https://nodejs.org (the LTS button), then run this again."
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

echo
echo "  Opening the flash book. Click the black 'Print all designs' button at the top."
echo "  In the print dialog: choose your paper size and set Scale to 100%."
echo
open sheets.html
