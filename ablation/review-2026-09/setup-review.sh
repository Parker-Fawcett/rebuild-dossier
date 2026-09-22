#!/usr/bin/env bash
# Prepares the 20 sealed Claude Code reps for E2/E3/E4a (PREREGISTRATION.md).
#
# Usage: ./setup-review.sh [source-rebuild-dir] [out-root]
#   defaults: ~/ablation-runs/web-rebuild  ~/sealed-runs/review-2026-09
#
# Arms (5 reps each):
#   A  blocking enabled (spec lock + untested-contract block), discipline prompt
#   B  log-only, discipline prompt
#   C  log-only, batch-allowed prompt + matching CLAUDE.md/rules edits
#   D  untested-contract block only (spec/ writable), discipline prompt
#
# Every arm: held-out suite moved to <out-root>/.sealed/<rep>/ before the
# agent ever sees the rep, identical hooks + settings, arm-specific markers in
# the sibling .claude-plugin-state/<rep>/ dir, never inside the rep.
set -euo pipefail

SRC="${1:-$HOME/ablation-runs/web-rebuild}"
ROOT="${2:-$HOME/sealed-runs/review-2026-09}"
HERE="$(cd "$(dirname "$0")" && pwd)"
REPS=5

[ -d "$SRC" ] || { echo "no source dir $SRC" >&2; exit 1; }
[ ! -e "$SRC/node_modules" ] && [ ! -e "$SRC/.next" ] && [ ! -e "$SRC/src" ] \
  || { echo "$SRC is not pristine (node_modules/.next/src present)" >&2; exit 1; }
[ ! -e "$ROOT" ] || { echo "$ROOT already exists; refusing to overwrite real data" >&2; exit 1; }

AVAIL_GB=$(df -g "$HOME" | awk 'NR==2{print $4}')
[ "$AVAIL_GB" -ge 10 ] || { echo "only ${AVAIL_GB}GB free; need >=10GB (playbook step 0)" >&2; exit 1; }

mkdir -p "$ROOT/.sealed" "$ROOT/.claude-plugin-state" "$ROOT/.eval" "$ROOT/.deps"

# One dependency install for all 20 reps, from the pinned lockfile; each rep
# later gets an APFS copy-on-write clone (cp -c), so every rep runs against
# byte-identical node_modules at near-zero disk cost.
cp "$SRC/package.json" "$SRC/package-lock.json" "$ROOT/.deps/"
( cd "$ROOT/.deps" && npm ci > npm-ci.log 2>&1 ) || { echo "npm ci failed; see $ROOT/.deps/npm-ci.log" >&2; exit 1; }

for arm in A B C D; do
  for i in $(seq 1 "$REPS"); do
    rep="$arm-rep$i"
    dest="$ROOT/$rep"
    state="$ROOT/.claude-plugin-state/$rep"
    cp -R "$SRC" "$dest"
    mkdir -p "$ROOT/.sealed/$rep"
    mv "$dest/tests/held-out" "$ROOT/.sealed/$rep/held-out"

    mkdir -p "$dest/.claude/hooks"
    cp "$HERE"/hooks/*.mjs "$dest/.claude/hooks/"
    cp "$HERE/settings-template.json" "$dest/.claude/settings.json"
    python3 "$HERE/apply-variant.py" "$dest" "$arm" >/dev/null

    mkdir -p "$state"
    case "$arm" in
      A) touch "$state/enforce" ;;
      D) touch "$state/enforce-untested" ;;
    esac
  done
done

# Contamination invariants: reps within an arm are byte-identical; A/B/D
# differ only by their external markers; C differs only in the three files
# apply-variant.py rewrites.
for arm in A B C D; do
  diff -rq "$ROOT/$arm-rep1" "$ROOT/$arm-rep5" >/dev/null || { echo "arm $arm reps differ" >&2; exit 1; }
done
diff -rq "$ROOT/A-rep1" "$ROOT/B-rep1" >/dev/null || { echo "A vs B differ inside rep" >&2; exit 1; }
diff -rq "$ROOT/A-rep1" "$ROOT/D-rep1" >/dev/null || { echo "A vs D differ inside rep" >&2; exit 1; }
CDIFF=$(diff -rq "$ROOT/B-rep1" "$ROOT/C-rep1" | sort || true)
echo "B vs C differences (expected: CLAUDE.md, kickoff-prompt.txt, .claude/rules/testing.md):"
echo "$CDIFF"

( cd "$ROOT" && shasum -a 256 A-rep1/kickoff-prompt.txt C-rep1/kickoff-prompt.txt \
    A-rep1/CLAUDE.md C-rep1/CLAUDE.md A-rep1/.claude/rules/testing.md C-rep1/.claude/rules/testing.md \
    A-rep1/.claude/settings.json A-rep1/.claude/hooks/*.mjs ) > "$ROOT/MANIFEST.sha256"
cp "$HERE/run-order.txt" "$ROOT/run-order.txt"
echo "Prepared 20 reps under $ROOT. Next: ./smoke-test.sh, then ./run-review.sh"
