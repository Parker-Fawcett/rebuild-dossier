#!/usr/bin/env bash
# Runs ONE ablation rep: installs deps if needed, invokes OpenCode headlessly
# with trial-prompt.txt, captures the full transcript, then computes the
# mechanical metrics from that rep's own activity-log.jsonl (written by
# activity-log.ts — see that file and parse-log.mjs for why this is
# mechanical, not the agent's own self-report).
#
# Usage: ./run-trial.sh <path/to/rep-dir> [model]
#   e.g. ./run-trial.sh ".../ablation-web-rebuild/with-rep1" opencode/deepseek-v4-flash-free
#
# The model used for a real trial should NOT default to the free smoke-test
# tier without a deliberate choice — deepseek-v4-flash-free was validated
# here only for single-tool-call plugin behavior, not for a sustained,
# many-turn red-green-refactor rebuild. Pass the model you actually intend to
# ablate.
#
# Every file THIS script or activity-log.ts creates (lock, activity log,
# transcript, summary) lives in a sibling .plugin-state/<rep-name>/ directory,
# never inside the rep itself — see setup.sh's own header for why that
# boundary matters and was confirmed live, not assumed.

set -euo pipefail

REP_DIR="$1"
MODEL="${2:?Usage: ./run-trial.sh <rep-dir> <model> -- no default; pick the model deliberately, see the header comment above}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REP_NAME="$(basename "$REP_DIR")"
PLUGIN_STATE_DIR="$(dirname "$REP_DIR")/.plugin-state/$REP_NAME"

if [ ! -d "$REP_DIR" ]; then
  echo "Error: $REP_DIR does not exist." >&2
  exit 1
fi

mkdir -p "$PLUGIN_STATE_DIR"

# mkdir is atomic on any POSIX filesystem — a second concurrent invocation's
# mkdir fails outright rather than racing a check-then-write lock file. Guards
# against this same rep being double-run (two terminals, a re-triggered
# script, whatever the cause) mid-trial, which would otherwise interleave two
# opencode sessions' edits and corrupt activity-log.jsonl's chronological
# ordering that parse-log.mjs depends on.
LOCK_DIR="$PLUGIN_STATE_DIR/lock"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "Error: $LOCK_DIR already exists — a run-trial.sh invocation is already in progress for this rep (or a previous one crashed without cleaning up). If you're certain nothing else is running against $REP_DIR, remove $LOCK_DIR by hand and retry." >&2
  exit 1
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

cd "$REP_DIR"

if [ ! -d node_modules ]; then
  echo "Installing dependencies in $REP_DIR ..."
  npm install
fi

rm -f "$PLUGIN_STATE_DIR/activity-log.jsonl" "$PLUGIN_STATE_DIR/transcript.log" "$PLUGIN_STATE_DIR/summary.json"

echo "Running trial in $REP_DIR with model $MODEL ..."
PROMPT="$(cat "$SCRIPT_DIR/trial-prompt.txt")"
# --auto: unattended, required for a headless multi-rep run — every edit/
# write/bash permission is auto-approved. This is what makes activity-log.ts
# (not a human) the actual safety backstop during a real trial.
npx --yes opencode-ai run "$PROMPT" --model "$MODEL" --auto > "$PLUGIN_STATE_DIR/transcript.log" 2>&1 || true

node "$SCRIPT_DIR/parse-log.mjs" "$PLUGIN_STATE_DIR/activity-log.jsonl" > "$PLUGIN_STATE_DIR/summary.json"
echo "Done. Transcript: $PLUGIN_STATE_DIR/transcript.log — mechanical metrics: $PLUGIN_STATE_DIR/summary.json"
