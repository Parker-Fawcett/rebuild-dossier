#!/usr/bin/env bash
# Prepares the E5 wording reps (PREREGISTRATION.md §E5): 15 gpt-6-astra reps
# (original / revised / irrelevant-control wording, 5 each) and 6 gpt-5.5
# reps (original / revised, 3 each). Every rep is prepared exactly the way
# ../codex/setup.sh prepares one (same hooks, same git baseline, blocking
# enabled via the external marker, matching the original Astra grid's
# enforced cells); the ONLY in-rep difference between arms is
# kickoff-prompt.txt, copied from prompts/.
#
# Usage: ./setup-astra.sh [source-rebuild-dir] [out-root]
#   defaults: ~/ablation-runs/web-rebuild  ~/sealed-runs/astra-2026-09
set -euo pipefail

SRC="${1:-$HOME/ablation-runs/web-rebuild}"
ROOT="${2:-$HOME/sealed-runs/astra-2026-09}"
HERE="$(cd "$(dirname "$0")" && pwd)"
CODEX="$HERE/../codex"

[ -d "$SRC" ] || { echo "no source dir $SRC" >&2; exit 1; }
[ ! -e "$ROOT" ] || { echo "$ROOT already exists; refusing to overwrite real data" >&2; exit 1; }
mkdir -p "$ROOT/.codex-plugin-state"
DEPS="$HOME/sealed-runs/review-2026-09/.deps"
[ -d "$DEPS/node_modules" ] || { echo "run setup-review.sh first (it creates the shared $DEPS install)" >&2; exit 1; }
cmp -s "$DEPS/package-lock.json" "$SRC/package-lock.json" || { echo "shared install is from a different lockfile" >&2; exit 1; }

prepare() { # <rep-name> <prompt-file>
  local dest="$ROOT/$1" state="$ROOT/.codex-plugin-state/$1"
  cp -R "$SRC" "$dest"
  rm -rf "$dest/node_modules" "$dest/.next"
  mkdir -p "$dest/.codex/hooks"
  cp "$CODEX/hooks/tool-log.mjs" "$CODEX/hooks/tool-heartbeat.mjs" "$dest/.codex/hooks/"
  cp "$CODEX/hooks.json.template" "$dest/.codex/hooks.json"
  cp "$HERE/prompts/$2" "$dest/kickoff-prompt.txt"
  (cd "$dest" && git init -q && git add -A && git commit -q -m "rep baseline")
  mkdir -p "$state" && touch "$state/enforce"
  # Same lockfile install as the sealed batch, copy-on-write cloned after the
  # git baseline so it never enters the committed tree.
  cp -Rc "$DEPS/node_modules" "$dest/node_modules"
}

for i in 1 2 3 4 5; do
  prepare "orig-rep$i" kickoff-original.txt
  prepare "rev-rep$i" kickoff-astra-revised.txt
  prepare "ctrl-rep$i" kickoff-astra-irrelevant-control.txt
done
for i in 1 2 3; do
  prepare "g55orig-rep$i" kickoff-original.txt
  prepare "g55rev-rep$i" kickoff-astra-revised.txt
done

diff -rq -x .git "$ROOT/orig-rep1" "$ROOT/g55orig-rep1" >/dev/null || { echo "orig arms differ inside rep" >&2; exit 1; }
for a in rev ctrl; do
  d=$(diff -rq -x .git "$ROOT/orig-rep1" "$ROOT/$a-rep1" || true)
  [ "$d" = "Files $ROOT/orig-rep1/kickoff-prompt.txt and $ROOT/$a-rep1/kickoff-prompt.txt differ" ] \
    || { echo "arm $a differs from orig in more than kickoff-prompt.txt:"; echo "$d"; exit 1; } >&2
done
cp "$HERE/run-order-astra.txt" "$ROOT/run-order.txt"
echo "Prepared 21 Codex reps under $ROOT. Next: ./run-astra.sh"
