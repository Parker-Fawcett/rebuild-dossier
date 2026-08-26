#!/usr/bin/env node
// PostToolUse hook, matcher "Edit|Write". Writes a heartbeat to the same
// state directory tool-log.mjs uses, on every real edit — proof, checkable
// from the filesystem rather than trusted from self-report, that this
// project's own settings.json (both PreToolUse rails included, since they
// are sibling keys in the same file, loaded together) was actually
// consulted for this session. Ported from this project's own production
// WRITE_HOOK_HEARTBEAT_COMMAND (src/spec/generateSettingsJson.ts), adapted
// only to write into a directory next to this project rather than inside
// it — see the top-level design notes for why nothing this script creates
// lives inside this project's own directory.
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';

let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(raw);
    const cwd = input.cwd || process.cwd();

    const stateDir = join(dirname(cwd), '.claude-plugin-state', basename(cwd));
    mkdirSync(stateDir, { recursive: true });

    const hbPath = join(stateDir, '.hook-heartbeat.json');
    let count = 0;
    try {
      count = JSON.parse(readFileSync(hbPath, 'utf-8')).count || 0;
    } catch {
      // no prior heartbeat — first fire
    }
    writeFileSync(hbPath, JSON.stringify({ lastFiredAt: new Date().toISOString(), cwd, count: count + 1 }, null, 2));

    appendFileSync(
      join(stateDir, 'activity-log.jsonl'),
      JSON.stringify({ ts: new Date().toISOString(), phase: 'after-heartbeat', toolNameRaw: input.tool_name ?? input.tool ?? null }) + '\n'
    );
  } catch {
    // best-effort only — a thrown error here must never block or fail a real session
  }
  process.exit(0);
});
