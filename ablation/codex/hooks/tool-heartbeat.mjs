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

// Requires a non-whitespace character immediately after the trailing slash
// (`(?=\S)`), UNLIKE tool-log.mjs's own copy of this same-looking pattern —
// deliberately different, not copy-paste drift. CONFIRMED necessary
// 2026-09-09, from a real trial, not a hypothetical: a real `web-rebuild`
// trial flagged `heldOutTouchCount: 2` when only one real touch (the single
// permitted final `npx vitest run tests/held-out` run) occurred. The other
// "touch" was the OUTPUT of `cat CLAUDE.md` — required reading, step 1 of
// the kickoff prompt — whose own rules text literally contains the sentence
// "tests/held-out/ exist specifically to catch this...". A bare substring
// scan of PostToolUse *output* can't tell that apart from a real directory
// listing revealing an actual held-out filename (e.g.
// `tests/held-out/GET-foo.spec.ts`, the original confirmed real catch this
// pattern exists for) — prose always has a space or sentence-punctuation
// right after the trailing slash; a real path continues directly into a
// filename. This lookahead is deliberately NOT applied to tool-log.mjs's
// PreToolUse *command*-text check: a command genuinely targeting held-out
// (e.g. `ls tests/held-out/`) can legitimately END right at that trailing
// slash with nothing after it, and requiring a following character there
// would turn a real, intended catch into a false NEGATIVE instead — a worse
// failure mode than the false positive being fixed here. No false positive
// was observed on the command-text side; this fix only touches the one
// place a false positive was actually confirmed.
const HELD_OUT_PATH_PATTERN = /(^|[\s\\/])tests[\\/]held-out[\\/](?=\S)/;

// CONFIRMED against a real, authenticated v0.153.4 `codex exec` on
// 2026-09-09: `tool_response` is a plain string (e.g. for Bash, the raw
// combined output text; for apply_patch, a summary like "Exit code: 0 ...
// Success. Updated the following files: ..."), never an object with
// `.stdout`/`.stderr` — every Claude-Code-shaped guess below returned
// undefined against a real payload. The plain-string case is checked first.
function extractOutput(input) {
  if (typeof input?.tool_response === 'string') {
    return { stdout: input.tool_response, stderr: null };
  }
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
