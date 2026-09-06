#!/usr/bin/env bash
# Prepares dry-run rep directories for the Codex-specific version of the
# contract-locking ablation (../README.md, ../claude-code/README.md). ONE
# rep per condition by default — this is the dry-run scope, matching how
# both prior harnesses started (a single with/without pair against a
# minimal fixture) before committing to the full N=3-per-condition
# production harness. Pass a rep count explicitly once the dry run has
# actually confirmed hooks fire and block as expected.
#
# Usage: ./setup.sh <path/to/app-rebuild> [reps-per-condition]
#   e.g. ./setup.sh "/path/to/minimal-fixture-rebuild" 1
#
# Requires: <path/to/app-rebuild> must already exist — i.e. you've already
# run ingest_repo + generate_spec against the target app once, normally.
#
# Every rep (both conditions) gets the IDENTICAL hooks.json + hooks/
# scripts — the with/without difference lives ENTIRELY in a sibling
# .codex-plugin-state/<rep-name>/enforce marker file, never inside the rep
# itself. Confirm this with `diff -rq` between a with-rep and a without-rep
# after running this script — it should report zero difference, same
# invariant both prior harnesses enforce.

set -euo pipefail

SOURCE_REBUILD_DIR="$1"
REPS="${2:-1}"
OUT_ROOT="$(dirname "$SOURCE_REBUILD_DIR")/ablation-codex-$(basename "$SOURCE_REBUILD_DIR")"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ ! -d "$SOURCE_REBUILD_DIR" ]; then
  echo "Error: $SOURCE_REBUILD_DIR does not exist. Run generate_spec against the target app first." >&2
  exit 1
fi

rm -rf "$OUT_ROOT"
mkdir -p "$OUT_ROOT"

for condition in with without; do
  for i in $(seq 1 "$REPS"); do
    rep_name="${condition}-rep${i}"
    dest="$OUT_ROOT/$rep_name"
    plugin_state_dir="$OUT_ROOT/.codex-plugin-state/$rep_name"
    echo "Preparing $dest ..."
    cp -r "$SOURCE_REBUILD_DIR" "$dest"
    rm -rf "$dest/node_modules" "$dest/.next"

    mkdir -p "$dest/.codex/hooks"
    cp "$SCRIPT_DIR/hooks/tool-log.mjs" "$dest/.codex/hooks/tool-log.mjs"
    cp "$SCRIPT_DIR/hooks/tool-heartbeat.mjs" "$dest/.codex/hooks/tool-heartbeat.mjs"
    cp "$SCRIPT_DIR/hooks.json.template" "$dest/.codex/hooks.json"

    mkdir -p "$plugin_state_dir"
    if [ "$condition" = "with" ]; then
      touch "$plugin_state_dir/enforce"
    fi
  done
done

echo ""
echo "Prepared $((REPS * 2)) rep directories under: $OUT_ROOT"
echo ""
echo "Sanity check before trusting any of this — confirm reps are byte-identical"
echo "except for the external enforce marker:"
echo "  diff -rq \"$OUT_ROOT/with-rep1\" \"$OUT_ROOT/without-rep1\""
echo "(expect: no output at all)"
echo ""
echo "BEFORE running a real trial: read ../README.md's 'One-time manual setup'"
echo "section — Codex requires trusting the hook definitions once per machine,"
echo "and that step is NOT automated by this script (unconfirmed CLI syntax —"
echo "see the confirmed-vs-assumed table)."
echo ""
echo "Then run ./run-trial.sh \"$OUT_ROOT/with-rep1\" <model> for a single rep,"
echo "by hand, before trusting run-all.sh with anything."
