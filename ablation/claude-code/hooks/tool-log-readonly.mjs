#!/usr/bin/env node
// PreToolUse hook, broader matcher (Read|Bash|Glob|Grep) — log only, never
// blocks anything. Exists solely to catch a held-out access that an
// Edit|Write-scoped hook structurally cannot see: reading, listing, or
// grepping tests/held-out/ without editing it is still the exact thing the
// kickoff prompt asks not to do before the visible suite is green.
//
// Confirmed directly (a real PostToolUse payload for a Bash call was
// captured and inspected): a Bash tool call exposes its command string as
// `tool_input.command`, identical in shape at PreToolUse. Previously the
// largest unverified assumption behind this script; no longer.
//
// Boundary pattern includes whitespace, not just start-of-string/path-sep —
// ported from a prior fix to this same measurement approach, found there by
// a real bug: a bash command listing several space-separated paths (e.g.
// "ls -la spec/ tests/held-out/") has "tests/held-out/" preceded by a space,
// which a path-separator-only boundary never matches.
import { existsSync, appendFileSync, mkdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';

const HELD_OUT_PATH_PATTERN = /(^|[\s\\/])tests[\\/]held-out[\\/]/;

let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(raw);
    const cwd = input.cwd || process.cwd();
    const filePath = input.tool_input?.file_path;
    const command = input.tool_input?.command;

    const stateDir = join(dirname(cwd), '.claude-plugin-state', basename(cwd));
    mkdirSync(stateDir, { recursive: true });
    const logPath = join(stateDir, 'activity-log.jsonl');

    const touchesHeldOut = Boolean(
      (filePath && HELD_OUT_PATH_PATTERN.test(filePath)) || (command && HELD_OUT_PATH_PATTERN.test(command))
    );

    appendFileSync(
      logPath,
      JSON.stringify({
        ts: new Date().toISOString(),
        phase: 'before-readonly',
        toolNameRaw: input.tool_name ?? input.tool ?? null,
        filePath,
        command,
        touchesHeldOut
      }) + '\n'
    );
    process.exit(0); // this hook never blocks anything — logging only
  } catch {
    process.exit(0);
  }
});
