#!/usr/bin/env node
// PreToolUse hook, matcher "Edit|Write". Logs first, then decides whether to
// block, in one script rather than two separate hook registrations — a
// platform used elsewhere for this same measurement found by direct test
// that when two hooks are both registered for the same tool call, one
// throwing can stop the other from running at all for that call. Whether
// this platform has the identical behavior is untested here (see the
// top-level design notes, "What's confirmed vs. assumed") — merging into
// one script sidesteps needing to know either way.
//
// Detection logic (spec/ lock, untested-contracts.json lookup) is the exact
// logic src/spec/generateSettingsJson.ts already ships in production
// (BLOCK_SPEC_EDITS_COMMAND / BLOCK_UNTESTED_CONTRACT_WRITES_COMMAND) — not
// reimplemented from scratch. What this script adds: unconditional logging
// before the decision, and gating the decision on an external marker file
// instead of always enforcing, so the identical byte-for-byte script can
// run in more than one configuration.
//
// Every artifact this script writes lives in a directory next to this
// project's own directory, never inside it — a prior version of this
// measurement approach found, by direct test, that a project's own
// directory listing surfaces anything written inside it, and a live session
// then reads it directly.
//
// Confirmed by this project's own tests (test/unit/spec/generateSettingsJson.spec.ts):
// PreToolUse hook JSON on stdin has `cwd` and `tool_input.file_path`.
// NOT independently confirmed here: the exact key naming which tool fired
// (assumed `tool_name`, logged defensively either way). This hook does not
// depend on that field to function (the matcher binding in settings.json
// already scopes it to Edit/Write), only to make the log easier to read.
import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';

const SPEC_PATH_PATTERN = /(^|[\\/])spec[\\/]/;

let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(raw);
    const cwd = input.cwd || process.cwd();
    const filePath = input.tool_input?.file_path;

    const stateDir = join(dirname(cwd), '.claude-plugin-state', basename(cwd));
    mkdirSync(stateDir, { recursive: true });
    const logPath = join(stateDir, 'activity-log.jsonl');
    const enforce = existsSync(join(stateDir, 'enforce'));

    const underSpec = Boolean(filePath && SPEC_PATH_PATTERN.test(filePath));

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

    // Log the attempt before deciding whether to block it, not after — and
    // log the raw tool_name field defensively (whatever it turns out to be
    // named) rather than assume, so a wrong assumption about its key doesn't
    // lose data.
    appendFileSync(
      logPath,
      JSON.stringify({
        ts: new Date().toISOString(),
        phase: 'before',
        toolNameRaw: input.tool_name ?? input.tool ?? null,
        filePath,
        underSpec,
        untestedContract,
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
  } catch {
    process.exit(0); // never let a bug in this script block or crash a real session
  }
});
