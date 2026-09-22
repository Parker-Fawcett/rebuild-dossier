#!/usr/bin/env bash
# Prepares the pre-registered strong-tier extension (PREREGISTRATION.md §10):
# arms A (blocking enabled) and B (log-only), 5 reps each, identical to the
# Haiku batch's A/B in every byte inside the rep; only the model differs.
#
# Usage: ./setup-strong.sh [source] [out-root]
#   defaults: ~/ablation-runs/web-rebuild  ~/sealed-runs/review-2026-09-strong
set -euo pipefail
SRC="${1:-$HOME/ablation-runs/web-rebuild}"
ROOT="${2:-$HOME/sealed-runs/review-2026-09-strong}"
HERE="$(cd "$(dirname "$0")" && pwd)"
DEPS="$HOME/sealed-runs/review-2026-09/.deps"

[ -d "$DEPS/node_modules" ] || { echo "run setup-review.sh first" >&2; exit 1; }
cmp -s "$DEPS/package-lock.json" "$SRC/package-lock.json" || { echo "shared install is from a different lockfile" >&2; exit 1; }
[ ! -e "$ROOT" ] || { echo "$ROOT exists; refusing to overwrite" >&2; exit 1; }
mkdir -p "$ROOT/.sealed" "$ROOT/.claude-plugin-state" "$ROOT/.eval" "$ROOT/.deps"
cp "$DEPS/package.json" "$DEPS/package-lock.json" "$ROOT/.deps/"
cp -Rc "$DEPS/node_modules" "$ROOT/.deps/node_modules"

for arm in A B; do
  for i in 1 2 3 4 5; do
    rep="$arm-rep$i"; dest="$ROOT/$rep"; state="$ROOT/.claude-plugin-state/$rep"
    cp -R "$SRC" "$dest"
    mkdir -p "$ROOT/.sealed/$rep"
    mv "$dest/tests/held-out" "$ROOT/.sealed/$rep/held-out"
    mkdir -p "$dest/.claude/hooks"
    cp "$HERE"/hooks/*.mjs "$dest/.claude/hooks/"
    cp "$HERE/settings-template.json" "$dest/.claude/settings.json"
    python3 "$HERE/apply-variant.py" "$dest" "$arm" >/dev/null
    mkdir -p "$state"
    [ "$arm" = A ] && touch "$state/enforce"
  done
done

diff -rq "$ROOT/A-rep1" "$ROOT/B-rep5" >/dev/null || { echo "A vs B differ inside rep" >&2; exit 1; }
# Same treatment bytes as the Haiku batch: check against its setup manifest
# (the Haiku reps themselves may be mid-run, so never diff against them).
( cd "$ROOT" && grep -E '  (A-rep1/|\.deps/)' "$HERE/MANIFEST-setup.sha256" | shasum -a 256 -c --quiet ) \
  || { echo "strong reps differ from the Haiku batch's recorded treatment" >&2; exit 1; }
cp "$HERE/run-order-strong.txt" "$ROOT/run-order.txt"
echo "Prepared 10 strong-tier reps under $ROOT"
