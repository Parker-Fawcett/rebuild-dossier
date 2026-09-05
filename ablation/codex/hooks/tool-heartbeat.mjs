#!/usr/bin/env node
// PostToolUse-equivalent hook for Codex CLI. Ports
// ../claude-code/hooks/tool-heartbeat.mjs — writes a heartbeat to the
// sibling state directory on every real edit, so run-trial.sh's live
// polling has real filesystem evidence the hook actually fired during the
// run, not just a self-report. Same raw-capture-first discipline as
// tool-log.mjs, for the same reason: the real Codex PostToolUse payload
// shape is unconfirmed here (see ../README.md's confirmed-vs-assumed
// table), and this is the file a real dry run should inspect first if the
// heartbeat never appears.
//
// Also absorbs ../claude-code/hooks/tool-log-bash-output.mjs's job (scanning
// a completed Bash call's actual output for an incidental held-out
// reference its command text alone would miss) — Codex's documented hook
// config has no per-tool matcher, so there is only ever ONE PostToolUse
// hook here regardless of tool type, unlike Claude Code where that was a
// second, Bash-scoped registration. Merged into one script deliberately,
// not split into two, for the same reason ../README.md (and the OpenCode
// ablation before it) gives: two hooks for the same event, if one throws,
// may silently stop the other from running — untested here either way, so
// this sidesteps needing to know.
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';

const HELD_OUT_PATH_PATTERN = /(^|[\s\\/])tests[\\/]held-out[\\/]/;

function extractOutput(input) {
  const stdout = input?.tool_response?.stdout ?? input?.toolResponse?.stdout ?? input?.output?.stdout ?? input?.result?.stdout ?? null;
  const stderr = input?.tool_response?.stderr ?? input?.toolResponse?.stderr ?? input?.output?.stderr ?? input?.result?.stderr ?? null;
  return { stdout, stderr };
}

let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  let input = {};
  let parseError = null;
  try {
    input = raw.trim().length > 0 ? JSON.parse(raw) : {};
  } catch (err) {
    parseError = String(err);
  }

  const cwd = input.cwd || process.cwd();
  const stateDir = join(dirname(cwd), '.codex-plugin-state', basename(cwd));
  mkdirSync(stateDir, { recursive: true });
  const logPath = join(stateDir, 'activity-log.jsonl');

  appendFileSync(
    logPath,
    JSON.stringify({
      ts: new Date().toISOString(),
      phase: 'raw-capture-post',
      rawStdin: raw,
      parseError,
      argv: process.argv.slice(2)
    }) + '\n'
  );

  try {
    const hbPath = join(stateDir, '.hook-heartbeat.json');
    let count = 0;
    try {
      count = JSON.parse(readFileSync(hbPath, 'utf-8')).count || 0;
    } catch {
      // no prior heartbeat — first fire
    }
    writeFileSync(hbPath, JSON.stringify({ lastFiredAt: new Date().toISOString(), cwd, count: count + 1 }, null, 2));

    const toolNameRaw = input?.tool_name ?? input?.tool ?? input?.toolName ?? input?.name ?? null;
    const { stdout, stderr } = extractOutput(input);
    const touchesHeldOut = Boolean(
      (stdout && HELD_OUT_PATH_PATTERN.test(stdout)) || (stderr && HELD_OUT_PATH_PATTERN.test(stderr))
    );
    appendFileSync(
      logPath,
      JSON.stringify({ ts: new Date().toISOString(), phase: 'after-heartbeat', toolNameRaw, touchesHeldOut }) + '\n'
    );
  } catch (err) {
    appendFileSync(
      logPath,
      JSON.stringify({ ts: new Date().toISOString(), phase: 'hook-error', error: String(err) }) + '\n'
    );
    // best-effort only — a thrown error here must never block or fail a real session
  }
  process.exit(0);
});
