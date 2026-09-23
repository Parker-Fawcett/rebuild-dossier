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
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
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

const HELD_OUT_COMMAND_PATTERN = /(^|[\s\\/])tests[\\/]held-out([\\/]|\s|$)/;
// Content-aware held-out detection (added 2026-09-23 after the review of the
// SEIP draft). The path check above only fires when output happens to print
// `tests/held-out/`. The duskframe leak went through a failing held-out
// assertion's diff, which prints the expected string verbatim ("expected '…'
// to contain '<answer>'") and often no path at all: under a name filter
// (`vitest run PAGE-root`) or a bare `vitest run`, which runs held-out too.
// So this reads the held-out specs' own expected literals at hook time and
// flags (a) any command that executes held-out tests, however invoked, and
// (b) any output that reveals one of those literals from a test-failure or
// held-out context. A legitimate read of a contract that documents the same
// text (e.g. `cat spec/contracts/PAGE-root.md`) is not flagged.
const SPEC_FILE = /\.(?:spec|test)\.[cm]?[jt]sx?$/;
const ASSERTION_LITERAL = /\.(?:toContain|toBe|toEqual|toStrictEqual|toMatch|toHaveText|toContainText|toHaveProperty)\(\s*(['"`])((?:\\.|(?!\1).)*?)\1/g;
const MIN_LITERAL_LENGTH = 8;
const TEST_RUNNER = /\b(vitest|jest|playwright)\b/;
const FAILURE_CONTEXT = /AssertionError|expected [\s\S]{0,400}? to (?:contain|be|equal|match|have)/;

function heldOutExpectations(cwd) {
  const dir = join(cwd, 'tests', 'held-out');
  if (!existsSync(dir)) return { files: [], stems: [], literals: [] };
  const files = readdirSync(dir).filter((f) => SPEC_FILE.test(f));
  const literals = [];
  for (const f of files) {
    const src = readFileSync(join(dir, f), 'utf-8');
    for (const m of src.matchAll(ASSERTION_LITERAL)) {
      if (m[2].length >= MIN_LITERAL_LENGTH) literals.push({ file: f, literal: m[2] });
    }
  }
  return { files, stems: files.map((f) => f.replace(SPEC_FILE, '')), literals };
}

// Does this command execute held-out tests? True when it names the held-out
// path or a held-out spec's stem as a filter, or runs vitest/jest with no
// positional filter at all (which collects every test, held-out included).
// `npm test` alone stays false: the generated package.json scopes it to
// tests/visible.
function runsHeldOut(command, stems) {
  if (!command) return false;
  for (const stmt of command.split(/&&|\|\||;|\||\n/)) {
    if (!TEST_RUNNER.test(stmt)) continue;
    if (HELD_OUT_COMMAND_PATTERN.test(stmt)) return true;
    const words = stmt.trim().split(/\s+/);
    // vitest/jest treat a positional as a substring filter on the file path, so
    // a filter selects held-out tests when any held-out filename contains it.
    const filters = words.map((w) => w.replace(/['"]/g, '')).filter((w) => w.length >= 4 && !w.startsWith('-') && !TEST_RUNNER.test(w));
    if (filters.some((f) => stems.some((s) => s.includes(f) || f.includes(s)))) return true;
    const at = words.findIndex((w) => /(^|\/)(vitest|jest)$/.test(w));
    if (at >= 0) {
      const positional = words.slice(at + 1).filter((w) => !w.startsWith('-') && w !== 'run' && !/^\d?>/.test(w) && !['2>&1', '|'].includes(w));
      if (positional.length === 0) return true;
    }
  }
  return false;
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
    const pathInOutput = Boolean(
      (stdout && HELD_OUT_PATH_PATTERN.test(stdout)) || (stderr && HELD_OUT_PATH_PATTERN.test(stderr))
    );
    const command = typeof input?.tool_input?.command === 'string' ? input.tool_input.command : null;
    const expectations = heldOutExpectations(cwd);
    const output = `${stdout || ''}\n${stderr || ''}`;
    const heldOutRun = toolNameRaw === 'Bash' && runsHeldOut(command, expectations.stems);
    const heldOutFileInOutput = expectations.files.some((f) => output.includes(f));
    const revealing = heldOutRun || heldOutFileInOutput || pathInOutput || FAILURE_CONTEXT.test(output);
    const heldOutContentExposed = revealing
      ? expectations.literals.filter((l) => output.includes(l.literal)).map((l) => ({ file: l.file, literal: l.literal.slice(0, 80) }))
      : [];
    const touchesHeldOut = pathInOutput || heldOutRun || heldOutFileInOutput || heldOutContentExposed.length > 0;
    appendFileSync(
      logPath,
      JSON.stringify({ ts: new Date().toISOString(), phase: 'after-heartbeat', toolNameRaw, touchesHeldOut, heldOutRun, heldOutContentExposed }) + '\n'
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
