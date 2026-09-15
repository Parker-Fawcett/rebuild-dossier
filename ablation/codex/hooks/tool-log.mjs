#!/usr/bin/env node
// PreToolUse-equivalent hook for Codex CLI. Ports ../claude-code/hooks/tool-log.mjs
// (same spec/-lock + untested-contract detection logic, itself ported from
// src/spec/generateSettingsJson.ts's production hooks) onto Codex's own hook
// surface, which OpenAI's documentation describes as "modeled on Claude
// Code's" PreToolUse/PostToolUse — but that description comes from
// third-party web research done without a live, authenticated `codex` CLI
// in this environment, not from a captured real payload the way the
// Claude-Code version's assumptions were confirmed. Treat every field access
// below as UNCONFIRMED until a real dry run checks it — see ../README.md's
// confirmed-vs-assumed table.
//
// Because the real payload shape is unknown, this script does two things a
// confirmed-shape hook wouldn't need to: (1) logs the complete raw input
// verbatim, every single call, before attempting any field extraction, so a
// wrong assumption below doesn't lose the ground truth needed to fix it;
// (2) tries several plausible field paths defensively rather than committing
// to one guess.
//
// Blocking mechanism: exit code 2 + stderr message, matching Claude Code's
// convention and one of the two mechanisms third-party sources describe for
// Codex (the other being a JSON `permissionDecision: "deny"` response). Exit
// code 2 was picked because it requires no assumption about output framing
// (JSON vs plain text) — if a real dry run shows this does NOT block the
// tool call, that itself is the answer: switch to the JSON response shape,
// don't just retry the same mechanism.
import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';

// Includes \s (unlike the upstream production pattern in
// generateSettingsJson.ts, which never needed it because it only ever tests
// a parsed file_path) — CONFIRMED necessary on 2026-09-09: a raw shell
// command like `printf modified > spec/dummy.txt` has "spec" preceded by a
// space, not a path separator, and the space-less version silently failed
// to match it, exactly the false-negative HELD_OUT_PATH_PATTERN below
// already guards against for the same reason. Only ever applied to a parsed
// `filePath` (always inherently a write — see extractFilePath's apply_patch
// case below) — never to raw `command` text. See commandWritesTo below for
// why command text needs a different, narrower check.
const SPEC_PATH_PATTERN = /(^|[\s\\/])spec[\\/]/;

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// CONFIRMED necessary 2026-09-09, from a REAL trial, not a hypothetical: a
// real `web-rebuild` trial had a `gpt-5.6-terra` session blocked twice for
// running `find spec/contracts ... | cat ...` and `rg -n '' spec/contracts
// --glob '*.md'` — both pure READS of spec/contracts/*.md, which the
// kickoff prompt itself *requires* ("Read spec/contracts/*.md..."). The
// model wasn't attempting a rail violation; it hit a false positive from
// treating any raw-command mention of "spec/" (added to catch the
// Bash-redirect write bypass below) the same as an actual edit, then
// adapted its own shell phrasing twice (`rg -g '*.md'` with no path arg,
// then `cd spec && rg contracts`) until one didn't contain the literal
// substring — not rule-gaming, just normal retry-on-failure that happened
// to dodge an overly broad pattern. The original production pattern
// (generateSettingsJson.ts) never had this problem because its hook is
// matcher-scoped to `Edit|Write` only and never sees a Bash call at all;
// extending detection to raw command text (to catch a real write bypass
// Codex's general-purpose Bash tool allows, confirmed separately) broke
// that clean read/write separation. Fix: only treat command text as a
// spec/ touch when it matches a known WRITE-shaped construct targeting a
// spec/ path — not a bare substring match. `[^\n;&|]*?` bounds the match to
// roughly one shell statement, so an unrelated `rm` or `>` elsewhere in a
// `&&`/`;`/`|`-chained command doesn't spuriously connect to an unrelated
// `spec/` mention later in the same line.
//
// Known, deliberately undefended gaps (documented rather than silently
// assumed complete): `cp` into spec/ (ambiguous by argument position —
// `cp spec/x /tmp/y` reads, `cp /tmp/y spec/x` writes — not disambiguated
// here), a script interpreter writing a file internally (`python3 -c
// "open('spec/x','w')..."`), `dd of=spec/x`, `install`, `rsync`. Extend this
// list from real evidence if one of these is ever actually observed, the
// same discipline every other fix in this file follows.
function commandWritesTo(command, pathPatternSource) {
  const redirect = new RegExp(String.raw`(^|[\s;&|])>>?\s*['"]?[^\s'";&|]*?(?:${pathPatternSource})`);
  const tee = new RegExp(String.raw`\btee\b[^\n;&|]*?(?:${pathPatternSource})`);
  const sedInPlace = new RegExp(String.raw`\bsed\b[^\n;&|]*?(-i|--in-place)\b[^\n;&|]*?(?:${pathPatternSource})`);
  const rmMv = new RegExp(String.raw`\b(rm|mv)\b[^\n;&|]*?(?:${pathPatternSource})`);
  return redirect.test(command) || tee.test(command) || sedInPlace.test(command) || rmMv.test(command);
}

const SPEC_WRITE_TARGET_SOURCE = String.raw`spec[\\/]`;

function stateDirFor(cwd) {
  const dir = join(dirname(cwd), '.codex-plugin-state', basename(cwd));
  mkdirSync(dir, { recursive: true });
  return dir;
}

// CONFIRMED against a real, authenticated v0.153.4 `codex exec` on
// 2026-09-09: Codex's file-edit tool is `apply_patch`, not `Edit`/`Write`,
// and it carries NO `file_path`-shaped field at all — the target path only
// exists embedded inside `tool_input.command`, a unified-diff-style string
// with headers like `*** Add File: <path>` / `*** Update File: <path>` /
// `*** Delete File: <path>`. Every Claude-Code-shaped guess below returned
// null against a real payload; this was a real, confirmed bug — the spec/
// lock silently never fired (a deliberate live test edited spec/dummy.txt
// under `enforce` and it went through uncaught) until this patch-header
// parse was added.
const PATCH_HEADER_PATTERN = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/m;

function extractFilePath(input) {
  const patchMatch = typeof input?.tool_input?.command === 'string' && PATCH_HEADER_PATTERN.exec(input.tool_input.command);
  return (
    patchMatch?.[1] ??
    input?.tool_input?.file_path ?? // Claude-Code-shaped guess — kept as a fallback, unconfirmed for any real Codex tool
    input?.toolInput?.filePath ?? // camelCase guess
    input?.arguments?.file_path ??
    input?.input?.file_path ??
    input?.file_path ??
    null
  );
}

function extractToolName(input) {
  return input?.tool_name ?? input?.tool ?? input?.toolName ?? input?.name ?? null;
}

function extractCommand(input) {
  return input?.tool_input?.command ?? input?.toolInput?.command ?? input?.arguments?.command ?? input?.input?.command ?? null;
}

// Codex's documented hook config has no per-tool matcher the way Claude
// Code's settings.json does (see ../README.md) — this ONE PreToolUse hook
// fires for every tool call, not just Edit/Write. That's actually
// convenient here: it means held-out access via a Read/Bash/Glob/Grep call
// (which needed its own separate hook, tool-log-readonly.mjs, in the
// Claude-Code version) is already visible in this same script, from the
// same `command`/`filePath` fields, no second hook required.
const HELD_OUT_PATH_PATTERN = /(^|[\s\\/])tests[\\/]held-out[\\/]/;

let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  // cwd is itself unconfirmed to arrive on stdin at all — process.cwd() is
  // the only guaranteed-real fallback, matching how this same uncertainty
  // was handled in the Claude-Code version before ITS assumptions were
  // confirmed.
  let input = {};
  let parseError = null;
  try {
    input = raw.trim().length > 0 ? JSON.parse(raw) : {};
  } catch (err) {
    parseError = String(err);
  }

  const cwd = input.cwd || process.cwd();
  const stateDir = stateDirFor(cwd);
  const logPath = join(stateDir, 'activity-log.jsonl');

  // Unconditional raw capture, BEFORE any interpretation — the single most
  // important line in this file for the first real dry run. If every
  // field-extraction guess below turns out wrong, this line is what lets a
  // human fix them from real evidence instead of guessing again.
  appendFileSync(
    logPath,
    JSON.stringify({
      ts: new Date().toISOString(),
      phase: 'raw-capture',
      rawStdin: raw,
      parseError,
      argv: process.argv.slice(2),
      relevantEnvKeys: Object.keys(process.env).filter((k) => k.startsWith('CODEX_'))
    }) + '\n'
  );

  try {
    const filePath = extractFilePath(input);
    const command = extractCommand(input);
    const toolNameRaw = extractToolName(input);
    const enforce = existsSync(join(stateDir, 'enforce'));

    // CONFIRMED against a real, authenticated v0.153.4 `codex exec` on
    // 2026-09-09: a real trial edited spec/dummy.txt via a plain Bash
    // redirect (`printf '...' > spec/dummy.txt`), not `apply_patch` — Codex
    // gives the model a general-purpose Bash tool with no obligation to use
    // the structured edit tool at all. That write went through completely
    // unblocked on the first version of this check, which only tested the
    // parsed `filePath` (null for a Bash call). `commandWritesTo` closes it
    // WITHOUT the false-positive a bare substring match had (see its own
    // comment above) — command text is checked for a write-shaped construct
    // targeting spec/, not merely a mention of "spec/".
    const underSpec = Boolean(
      (filePath && SPEC_PATH_PATTERN.test(filePath)) || (command && commandWritesTo(command, SPEC_WRITE_TARGET_SOURCE))
    );
    const touchesHeldOut = Boolean(
      (filePath && HELD_OUT_PATH_PATTERN.test(filePath)) || (command && HELD_OUT_PATH_PATTERN.test(command))
    );

    let untestedContract = false;
    const listPath = join(cwd, 'spec', 'untested-contracts.json');
    if ((filePath || command) && existsSync(listPath)) {
      try {
        const untested = JSON.parse(readFileSync(listPath, 'utf-8'));
        const normFilePath = filePath ? filePath.replace(/\\/g, '/') : null;
        const normCommand = command ? command.replace(/\\/g, '/') : null;
        // Same read/write fix as underSpec above, for the same reason: a
        // Bash command merely *mentioning* an untested contract's path
        // (e.g. reading a sibling file that references it) isn't building
        // it. Only a write-shaped construct targeting that exact path
        // counts.
        untestedContract = untested.some((u) => {
          const needle = String(u).replace(/\\/g, '/');
          return (
            (normFilePath && normFilePath.endsWith(needle)) ||
            (normCommand && commandWritesTo(normCommand, escapeRegExp(needle)))
          );
        });
      } catch {
        // malformed untested-contracts.json — treat as no list, same as production
      }
    }

    appendFileSync(
      logPath,
      JSON.stringify({
        ts: new Date().toISOString(),
        phase: 'before',
        toolNameRaw,
        filePath,
        command,
        underSpec,
        untestedContract,
        touchesHeldOut,
        enforced: enforce
      }) + '\n'
    );

    if (!enforce) process.exit(0); // marker absent: log only, never block.

    if (underSpec) {
      console.error('Blocked: spec/ is locked — do not edit files under spec/.');
      process.exit(2);
    }
    if (untestedContract) {
      console.error(
        'Blocked: this file corresponds to a locked contract with no associated test in ' +
          'tests/visible/ yet. Building it now is batch regeneration, which this workspace ' +
          'disallows -- work test-by-test. If this file genuinely must be built ahead of a ' +
          'failing test, stop and ask first.'
      );
      process.exit(2);
    }
    process.exit(0);
  } catch (err) {
    appendFileSync(
      logPath,
      JSON.stringify({ ts: new Date().toISOString(), phase: 'hook-error', error: String(err) }) + '\n'
    );
    process.exit(0); // never let a bug in this script block or crash a real session
  }
});
