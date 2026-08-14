#!/usr/bin/env bash
# Rebuilds the trading_school-standalone branch (repo root) from the current
# state of trading_school/ inside the parent XAUUSD monorepo, via
# `git subtree split`. Run this whenever you want to sync local work to the
# standalone repo that gets pushed elsewhere -- see PROJECT_STATE.md "Repo
# extraction" for why this exists instead of just `git remote add` on the
# monorepo directly (short version: the monorepo also holds Meridian-7's
# proprietary strategy research, which must never leave this machine).
#
# IMPORTANT: this script does NOT push anywhere. It rebuilds the local
# branch and reports what it found; a human (or an agent acting on the
# admin's explicit instruction) reviews the output and decides whether to
# push. Read DENYLIST below before trusting this blindly -- keyword matching
# catches known-bad terms, it cannot guarantee nothing sensitive slipped
# through in a form not on the list.
#
# Usage: run from the XAUUSD repo root.
#   trading_school/scripts/extract-standalone-repo.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

if [ -n "$(git status --short)" ]; then
  echo "Working tree is dirty -- git subtree split needs it clean (it uses the" >&2
  echo "working tree as scratch space). Commit or stash first, including untracked" >&2
  echo "files (git stash push -u), then re-run. This script will NOT stash for you" >&2
  echo "-- files that aren't yours to touch may be sitting uncommitted here." >&2
  exit 1
fi

echo "== Splitting trading_school/ into trading_school-standalone =="
# git subtree split has no force/overwrite flag for -b -- an existing branch
# of that name must be deleted first (confirmed the hard way 2026-08-14: -f
# is not a valid switch here, unlike most other git subcommands).
if git show-ref --verify --quiet refs/heads/trading_school-standalone; then
  git branch -D trading_school-standalone
fi
git subtree split --prefix=trading_school -b trading_school-standalone

# Commits that originated as monorepo-wide checkpoints (bundling trading_school
# changes with unrelated work in the same commit) can carry a message that
# mentions the other project even when the file diff itself is trading_school-only
# -- subtree split rewrites trees and parents, but never touches message text.
# Known example fixed 2026-08-14: two commits referenced Meridian-7 research
# parameters by name. This list is best-effort, not exhaustive -- always read
# the full log before pushing, don't rely on a clean grep alone.
DENYLIST='meridian|quant_platform|reducedRiskMult|inverse-FVG|XAGUSD|fortress layer'

echo ""
echo "== Scanning commit messages against the denylist =="
if git log trading_school-standalone --format='%H%n%B%n---' | grep -inE "$DENYLIST"; then
  echo ""
  echo "^^ FOUND POTENTIALLY SENSITIVE TEXT IN A COMMIT MESSAGE ABOVE." >&2
  echo "Do not push until this is fixed. Reword the offending commit(s) with" >&2
  echo "git filter-branch --msg-filter (see the 2026-08-14 fix in git history for a" >&2
  echo "worked example: search this branch's reflog / PROJECT_STATE.md 'Repo extraction')." >&2
  exit 1
else
  echo "No denylist matches. Still read the log yourself before pushing -- this is"
  echo "a keyword scan, not a guarantee."
fi

echo ""
echo "== trading_school-standalone is ready locally =="
echo "Nothing has been pushed. To publish: git push <remote-url> trading_school-standalone:main"
