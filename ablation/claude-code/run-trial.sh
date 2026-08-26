#!/usr/bin/env bash
# Runs ONE rep of the Claude-Code-specific ablation: launches a real,
# top-level `claude -p` subprocess (NOT the Agent tool — confirmed in
# docs/v0-findings.md to consult this directory's own .claude/settings.json
# independently), polls the hook heartbeat every 20s for the FULL duration
# of the run (not reconstructed afterward — matching Section 4.9's own
# rigor standard), then independently re-runs both test suites itself rather
# than trusting the agent's own bash output for pass counts.
#
# Usage: ./run-trial.sh <path/to/rep-dir> <model>
#   e.g. ./run-trial.sh ".../ablation-cc-web-rebuild/with-rep1" haiku
#
# No default model — pick it deliberately, same reasoning as the OpenCode
# harness's run-trial.sh: don't let a real trial silently run against
# whatever the CLI's own default happens to be.
#
# claude runs with --permission-mode bypassPermissions: every edit/write/
# bash call is auto-approved, unattended. This project's own merged hook
# (hooks/tool-log.mjs) is the real safety backstop during a trial, not a
# human approving each call — the identical justification the OpenCode
# harness gives for its own --auto flag.
#
# Every file this script or the hooks create lives in the sibling
# .claude-plugin-state/<rep-name>/ directory, never inside the rep — see
# setup.sh's own header.

set -uo pipefail

REP_DIR="$1"
MODEL="${2:?Usage: ./run-trial.sh <rep-dir> <model> -- no default, pick it deliberately (see header comment)}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REP_NAME="$(basename "$REP_DIR")"
ABLATION_ROOT="$(dirname "$REP_DIR")"
STATE_DIR="$ABLATION_ROOT/.claude-plugin-state/$REP_NAME"

if [ ! -d "$REP_DIR" ]; then
  echo "Error: $REP_DIR does not exist." >&2
  exit 1
fi

mkdir -p "$STATE_DIR"

# Atomic lock — same reasoning as the OpenCode harness's run-trial.sh: guard
# against this same rep being double-run, which would interleave two
# sessions' edits and corrupt activity-log.jsonl's chronological ordering.
LOCK_DIR="$STATE_DIR/lock"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "Error: $LOCK_DIR already exists — a run-trial.sh invocation is already in progress for this rep (or a previous one crashed without cleaning up). If you're certain nothing else is running, remove $LOCK_DIR by hand and retry." >&2
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

# Concatenate the rep's OWN kickoff-prompt.txt (generated fresh by
# generate_spec, never hand-copied here) with the shared structured
# self-report suffix — avoids the OpenCode harness's own trial-prompt.txt
# hardcoding a second copy of the kickoff prompt that could silently drift
# from what generate_spec actually produces.
PROMPT="$(cat kickoff-prompt.txt)
$(cat "$SCRIPT_DIR/trial-prompt-suffix.txt")"

echo "Running trial in $REP_DIR with model $MODEL ..."
claude -p "$PROMPT" \
  --allowedTools "Read,Edit,Write,Bash,Glob,Grep" \
  --permission-mode bypassPermissions \
  --model "$MODEL" \
  --output-format text \
  > "$STATE_DIR/transcript.log" 2>&1 &
CLAUDE_PID=$!

echo "claude pid $CLAUDE_PID — polling heartbeat every 20s for the full run duration ..."
while kill -0 "$CLAUDE_PID" 2>/dev/null; do
  if [ -f "$STATE_DIR/.hook-heartbeat.json" ]; then
    HB="$(cat "$STATE_DIR/.hook-heartbeat.json")"
  else
    HB="null"
  fi
  node -e "
    const fs = require('node:fs');
    const line = JSON.stringify({ polledAt: new Date().toISOString(), heartbeat: $HB }) + '\n';
    fs.appendFileSync('$STATE_DIR/liveness-poll.jsonl', line);
  "
  sleep 20
done

wait "$CLAUDE_PID"
CLAUDE_EXIT=$?
echo "claude exited with code $CLAUDE_EXIT"

# Independent re-run, not trusted from the agent's own bash calls — the same
# standard this paper's main narrative (not the OpenCode ablation's own
# mechanical parser) uses everywhere: "independently verified by re-running
# both suites and reading actual error output."
echo "Independently re-running tests/visible ..."
npx vitest run tests/visible --passWithNoTests > "$STATE_DIR/visible-rerun.log" 2>&1
echo "Independently re-running tests/held-out ..."
npx vitest run tests/held-out --passWithNoTests > "$STATE_DIR/held-out-rerun.log" 2>&1

node "$SCRIPT_DIR/parse-log.mjs" "$STATE_DIR" "$CLAUDE_EXIT" > "$STATE_DIR/summary.json"
echo "Done. Transcript: $STATE_DIR/transcript.log — mechanical metrics: $STATE_DIR/summary.json"
