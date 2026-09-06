#!/usr/bin/env bash
# Runs ONE rep of the Codex-specific ablation. Ports
# ../claude-code/run-trial.sh's structure (background launch, live heartbeat
# polling for the FULL run duration, independent post-trial test re-run) onto
# `codex exec`.
#
# Usage: ./run-trial.sh <path/to/rep-dir> <model>
#   e.g. ./run-trial.sh ".../ablation-codex-fixture-rebuild/with-rep1" terra
#
# No default model — pick it deliberately, same reasoning as both prior
# harnesses.
#
# --- Flags below are sourced from third-party web research, NOT confirmed
# against a real `codex` CLI in this environment (there isn't one here) ---
# see ../README.md's confirmed-vs-assumed table before trusting a real run:
#
#   --sandbox workspace-write   Codex's exec-mode default; auto-approves
#                                reads/writes/bash WITHIN the rep directory,
#                                no interactive prompt. Deliberately NOT
#                                using the deprecated --full-auto (removed
#                                as of v0.147.0 per public release notes) or
#                                --dangerously-bypass-approvals-and-sandbox
#                                (disables sandboxing entirely — more than
#                                this harness needs, since this project's
#                                own hook is the real safety backstop during
#                                a trial, same justification both prior
#                                harnesses give for their own auto-approve
#                                flags).
#   --ask-for-approval never     Drops the interactive approval prompt
#                                without touching sandbox scope.
#
# KNOWN REAL RISK, not hypothetical: public bug reports describe
# --full-auto combined with --sandbox workspace-write hanging indefinitely
# with orphaned child processes on some Codex versions. This script does
# NOT use --full-auto for exactly that reason, but since this has not been
# tested against Terra/Luna specifically, a hard wall-clock cap is enforced
# below (default 3 hours) that force-kills the process rather than trusting
# it to exit on its own — a safeguard neither prior harness needed, added
# here because of a documented issue, not paranoia.
set -uo pipefail

REP_DIR="$1"
MODEL="${2:?Usage: ./run-trial.sh <rep-dir> <model> -- no default, pick it deliberately (see header comment)}"
MAX_RUN_SECONDS="${MAX_RUN_SECONDS:-10800}" # 3 hours; override via env var if a trial legitimately needs longer
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REP_NAME="$(basename "$REP_DIR")"
ABLATION_ROOT="$(dirname "$REP_DIR")"
STATE_DIR="$ABLATION_ROOT/.codex-plugin-state/$REP_NAME"

if [ ! -d "$REP_DIR" ]; then
  echo "Error: $REP_DIR does not exist." >&2
  exit 1
fi

mkdir -p "$STATE_DIR"

LOCK_DIR="$STATE_DIR/lock"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "Error: $LOCK_DIR already exists — a run-trial.sh invocation is already in progress for this rep (or a previous one crashed/was killed without cleaning up). If you're certain nothing else is running, remove $LOCK_DIR by hand and retry." >&2
  exit 1
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

rm -f "$STATE_DIR/activity-log.jsonl" "$STATE_DIR/transcript.log" "$STATE_DIR/summary.json" \
      "$STATE_DIR/liveness-poll.jsonl" "$STATE_DIR/.hook-heartbeat.json" \
      "$STATE_DIR/visible-rerun.log" "$STATE_DIR/held-out-rerun.log"

cd "$REP_DIR"

if [ ! -d node_modules ]; then
  echo "Installing dependencies in $REP_DIR ..."
  npm install
fi

if [ ! -f "kickoff-prompt.txt" ]; then
  echo "Error: $REP_DIR/kickoff-prompt.txt not found — was this rep really produced by generate_spec?" >&2
  exit 1
fi

PROMPT="$(cat kickoff-prompt.txt)
$(cat "$SCRIPT_DIR/trial-prompt-suffix.txt")"

echo "Running trial in $REP_DIR with model $MODEL (max ${MAX_RUN_SECONDS}s) ..."
codex exec \
  --sandbox workspace-write \
  --ask-for-approval never \
  --model "$MODEL" \
  "$PROMPT" \
  > "$STATE_DIR/transcript.log" 2>&1 &
CODEX_PID=$!

echo "codex pid $CODEX_PID — polling heartbeat every 20s, hard cap ${MAX_RUN_SECONDS}s ..."
ELAPSED=0
POLL_INTERVAL=20
TIMED_OUT=0
while kill -0 "$CODEX_PID" 2>/dev/null; do
  if [ "$ELAPSED" -ge "$MAX_RUN_SECONDS" ]; then
    echo "Hit ${MAX_RUN_SECONDS}s wall-clock cap — killing pid $CODEX_PID (see header comment: known hang risk, not assumed safe)." >&2
    kill -9 "$CODEX_PID" 2>/dev/null || true
    TIMED_OUT=1
    break
  fi
  if [ -f "$STATE_DIR/.hook-heartbeat.json" ]; then
    HB="$(cat "$STATE_DIR/.hook-heartbeat.json")"
  else
    HB="null"
  fi
  node -e "
    const fs = require('node:fs');
    const line = JSON.stringify({ polledAt: new Date().toISOString(), elapsedSeconds: $ELAPSED, heartbeat: $HB }) + '\n';
    fs.appendFileSync('$STATE_DIR/liveness-poll.jsonl', line);
  "
  sleep "$POLL_INTERVAL"
  ELAPSED=$((ELAPSED + POLL_INTERVAL))
done

if [ "$TIMED_OUT" -eq 1 ]; then
  CODEX_EXIT=124 # conventional timeout exit code
else
  wait "$CODEX_PID"
  CODEX_EXIT=$?
fi
echo "codex exited with code $CODEX_EXIT (124 = this script's own timeout, not codex's)"

echo "Independently re-running tests/visible ..."
npx vitest run tests/visible --passWithNoTests > "$STATE_DIR/visible-rerun.log" 2>&1
echo "Independently re-running tests/held-out ..."
npx vitest run tests/held-out --passWithNoTests > "$STATE_DIR/held-out-rerun.log" 2>&1

node "$SCRIPT_DIR/parse-log.mjs" "$STATE_DIR" "$CODEX_EXIT" > "$STATE_DIR/summary.json"
echo "Done. Transcript: $STATE_DIR/transcript.log — mechanical metrics: $STATE_DIR/summary.json"
echo ""
echo "FIRST REAL RUN? Read $STATE_DIR/summary.json's sampleRawStdin/hookErrors"
echo "fields before trusting anything else in it — see ../README.md."
