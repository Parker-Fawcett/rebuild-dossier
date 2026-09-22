#!/usr/bin/env bash
# Runs ONE sealed rep (PREREGISTRATION.md, E2/E3/E4a). Same launch, polling,
# and re-run structure as ../claude-code/run-trial.sh, plus four changes:
#   1. the agent runs under sandbox-exec with a read-seal (sandbox.sb.template)
#   2. the model is pinned by full ID, never an alias
#   3. after the agent exits, the rebuild is frozen (tar + SHA-256) BEFORE
#      the evaluator ever touches it
#   4. the held-out suite is run once, against a copy of that frozen
#      snapshot, in a directory the agent never had access to
#
# Usage: ./run-sealed-trial.sh <root> <rep-name>
#   e.g. ./run-sealed-trial.sh ~/sealed-runs/review-2026-09 D-rep4
set -uo pipefail

ROOT="$1"
REP_NAME="$2"
MODEL="${MODEL:?set MODEL to a full model ID}"
HERE="$(cd "$(dirname "$0")" && pwd)"
REP_DIR="$ROOT/$REP_NAME"
STATE_DIR="$ROOT/.claude-plugin-state/$REP_NAME"
SEALED_DIR="$ROOT/.sealed"
EVAL_DIR="$ROOT/.eval/$REP_NAME"

[ -d "$REP_DIR" ] || { echo "no rep $REP_DIR" >&2; exit 1; }
[ -d "$SEALED_DIR/$REP_NAME/held-out" ] || { echo "no sealed suite for $REP_NAME" >&2; exit 1; }
[ ! -e "$STATE_DIR/summary.json" ] || { echo "$REP_NAME already has a summary.json; refusing to re-run over real data" >&2; exit 1; }

AVAIL_GB=$(df -g "$HOME" | awk 'NR==2{print $4}')
[ "$AVAIL_GB" -ge 10 ] || { echo "only ${AVAIL_GB}GB free; stopping before a full disk corrupts a rep" >&2; exit 1; }

LOCK_DIR="$STATE_DIR/lock"
mkdir "$LOCK_DIR" 2>/dev/null || { echo "$LOCK_DIR exists; another run in progress?" >&2; exit 1; }
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

{
  echo "rep=$REP_NAME"
  echo "model=$MODEL"
  echo "claude=$(claude --version 2>&1)"
  echo "node=$(node --version)"
  echo "startedAt=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "markers=$(ls "$STATE_DIR" | tr '\n' ' ')"
} > "$STATE_DIR/run-meta.txt"

cd "$REP_DIR"
if [ ! -d node_modules ]; then
  # Clone of the single shared install made by setup-review.sh (identical
  # dependencies in every rep; copy-on-write, so near-zero extra disk).
  cp -Rc "$ROOT/.deps/node_modules" node_modules || { echo "node_modules clone failed" >&2; exit 1; }
fi

ENC="$(printf '%s' "$REP_DIR" | sed 's/[^A-Za-z0-9]/-/g')"
PROFILE="$STATE_DIR/sandbox.sb"
sed -e "s|@HOME@|$HOME|g" -e "s|@REP@|$REP_DIR|g" -e "s|@STATE@|$STATE_DIR|g" \
    -e "s|@SEALED@|$SEALED_DIR|g" -e "s|@ENC@|$ENC|g" \
    "$HERE/sandbox.sb.template" > "$PROFILE"

PROMPT="$(cat kickoff-prompt.txt)
$(cat "$HERE/prompts/trial-prompt-suffix-sealed.txt")"
shasum -a 256 kickoff-prompt.txt >> "$STATE_DIR/run-meta.txt"

echo "Running $REP_NAME with $MODEL under sandbox ..."
sandbox-exec -f "$PROFILE" claude -p "$PROMPT" \
  --allowedTools "Read,Edit,Write,Bash,Glob,Grep" \
  --permission-mode bypassPermissions \
  --model "$MODEL" \
  --output-format text \
  > "$STATE_DIR/transcript.log" 2>&1 &
CLAUDE_PID=$!

while kill -0 "$CLAUDE_PID" 2>/dev/null; do
  if [ -f "$STATE_DIR/.hook-heartbeat.json" ]; then HB="$(cat "$STATE_DIR/.hook-heartbeat.json")"; else HB="null"; fi
  node -e "require('node:fs').appendFileSync('$STATE_DIR/liveness-poll.jsonl', JSON.stringify({ polledAt: new Date().toISOString(), heartbeat: $HB }) + '\n')"
  sleep 20
done
wait "$CLAUDE_PID"
CLAUDE_EXIT=$?
echo "finishedAt=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$STATE_DIR/run-meta.txt"
echo "claudeExit=$CLAUDE_EXIT" >> "$STATE_DIR/run-meta.txt"

# Freeze before evaluating.
tar -C "$REP_DIR" --exclude node_modules --exclude .next -cf "$STATE_DIR/snapshot.tar" .
shasum -a 256 "$STATE_DIR/snapshot.tar" > "$STATE_DIR/snapshot.sha256"

npx vitest run tests/visible --passWithNoTests \
  --reporter=default --reporter=json --outputFile.json="$STATE_DIR/visible.json" \
  > "$STATE_DIR/visible-rerun.log" 2>&1

# Evaluate the frozen snapshot once, outside the agent's reach.
rm -rf "$EVAL_DIR"; mkdir -p "$EVAL_DIR"
tar -C "$EVAL_DIR" -xf "$STATE_DIR/snapshot.tar"
cp -Rc "$REP_DIR/node_modules" "$EVAL_DIR/node_modules"
cp -R "$SEALED_DIR/$REP_NAME/held-out" "$EVAL_DIR/tests/held-out"
( cd "$EVAL_DIR" && npx vitest run tests/held-out --passWithNoTests \
    --reporter=default --reporter=json --outputFile.json="$STATE_DIR/held-out-sealed.json" ) \
  > "$STATE_DIR/held-out-rerun.log" 2>&1

node "$HERE/../claude-code/parse-log.mjs" "$STATE_DIR" "$CLAUDE_EXIT" > "$STATE_DIR/summary.json"
node "$HERE/analyze-rep.mjs" "$ROOT" "$REP_NAME" > "$STATE_DIR/review-metrics.json"
echo "Done: $STATE_DIR/summary.json and review-metrics.json"
