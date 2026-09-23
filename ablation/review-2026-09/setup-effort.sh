#!/usr/bin/env bash
# Prepares the §11 conditional follow-up reps (PREREGISTRATION.md §11) in the
# E5 root, exactly as setup-astra.sh prepares every E5 rep (same hooks, git
# baseline, enforce marker, shared node_modules clone). Only the kickoff
# prompt and, at run time, the reasoning effort differ.
set -euo pipefail
SRC="${1:-$HOME/ablation-runs/web-rebuild}"
ROOT="${2:-$HOME/sealed-runs/astra-2026-09}"
HERE="$(cd "$(dirname "$0")" && pwd)"
CODEX="$HERE/../codex"
DEPS="$HOME/sealed-runs/review-2026-09/.deps"
[ -d "$ROOT" ] || { echo "run setup-astra.sh first" >&2; exit 1; }
prepare() { # <rep-name> <prompt-file>
  local dest="$ROOT/$1" state="$ROOT/.codex-plugin-state/$1"
  [ ! -e "$dest" ] || { echo "$dest exists; refusing to overwrite" >&2; exit 1; }
  cp -R "$SRC" "$dest"; rm -rf "$dest/node_modules" "$dest/.next"
  mkdir -p "$dest/.codex/hooks"
  cp "$CODEX/hooks/tool-log.mjs" "$CODEX/hooks/tool-heartbeat.mjs" "$dest/.codex/hooks/"
  cp "$CODEX/hooks.json.template" "$dest/.codex/hooks.json"
  cp "$HERE/prompts/$2" "$dest/kickoff-prompt.txt"
  (cd "$dest" && git init -q && git add -A && git commit -q -m "rep baseline")
  mkdir -p "$state" && touch "$state/enforce"
  cp -Rc "$DEPS/node_modules" "$dest/node_modules"
}
for i in 1 2; do
  prepare "rev-xhigh-rep$i" kickoff-astra-revised.txt
  prepare "rev-ultra-rep$i" kickoff-astra-revised.txt
  prepare "orig-ultra-rep$i" kickoff-original.txt
done
# Invariants among the unrun reps only (earlier E5 reps contain built files):
# same-arm reps identical; rev vs orig differ only in kickoff-prompt.txt.
for a in rev-xhigh rev-ultra orig-ultra; do
  diff -rq -x .git -x node_modules "$ROOT/$a-rep1" "$ROOT/$a-rep2" >/dev/null || { echo "$a reps differ" >&2; exit 1; }
done
diff -rq -x .git -x node_modules "$ROOT/rev-xhigh-rep1" "$ROOT/rev-ultra-rep1" >/dev/null || { echo "rev-xhigh vs rev-ultra differ" >&2; exit 1; }
d=$(diff -rq -x .git -x node_modules "$ROOT/rev-ultra-rep1" "$ROOT/orig-ultra-rep1" || true)
[ "$d" = "Files $ROOT/rev-ultra-rep1/kickoff-prompt.txt and $ROOT/orig-ultra-rep1/kickoff-prompt.txt differ" ] || { echo "rev vs orig differ beyond the prompt: $d" >&2; exit 1; }
cmp -s "$ROOT/orig-ultra-rep1/kickoff-prompt.txt" "$HERE/prompts/kickoff-original.txt" || { echo "orig-ultra prompt mismatch" >&2; exit 1; }
cmp -s "$ROOT/rev-ultra-rep1/kickoff-prompt.txt" "$HERE/prompts/kickoff-astra-revised.txt" || { echo "rev-ultra prompt mismatch" >&2; exit 1; }
echo "Prepared 6 effort follow-up reps under $ROOT"
