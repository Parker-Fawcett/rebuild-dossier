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

const SPEC_PATH_PATTERN = /(^|[\\/])spec[\\/]/;

function stateDirFor(cwd) {
  const dir = join(dirname(cwd), '.codex-plugin-state', basename(cwd));
  mkdirSync(dir, { recursive: true });
  return dir;
}

// Best-effort extraction across every shape this script has a reason to
// consider plausible. Update this list, don't just add a new script, once a
// real dry run reveals the actual shape — keeping one place that knows
// "what we've tried" makes the eventual fix a one-line change.
function extractFilePath(input) {
  return (
    input?.tool_input?.file_path ?? // Claude-Code-shaped guess
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

    const underSpec = Boolean(filePath && SPEC_PATH_PATTERN.test(filePath));
    const touchesHeldOut = Boolean(
      (filePath && HELD_OUT_PATH_PATTERN.test(filePath)) || (command && HELD_OUT_PATH_PATTERN.test(command))
    );

    let untestedContract = false;
    if (filePath) {
      const listPath = join(cwd, 'spec', 'untested-contracts.json');
      if (existsSync(listPath)) {
        try {
          const untested = JSON.parse(readFileSync(listPath, 'utf-8'));
          const norm = filePath.replace(/\\/g, '/');
          untestedContract = untested.some((u) => norm.endsWith(String(u).replace(/\\/g, '/')));
        } catch {
          // malformed untested-contracts.json — treat as no list, same as production
        }
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
