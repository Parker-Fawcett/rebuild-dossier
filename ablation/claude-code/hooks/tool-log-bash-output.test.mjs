#!/usr/bin/env node
// Regression test for tool-log-bash-output.mjs. Not a vitest spec — this
// harness lives outside vitest's configured scope (test/unit/**/*.spec.ts
// only, see ../../../vitest.config.ts), and the sibling hooks were never
// given vitest specs either, only documented manual verification. This is
// that same verification made into a real, re-runnable file instead of a
// one-off: run directly with `node tool-log-bash-output.test.mjs`, exits
// non-zero on any failure.
//
// Case 1 reproduces the exact real miss confirmed live in Section 4.14: a
// `find` command whose own command TEXT never says "held-out", but whose
// captured stdout does. Case 2 is the false-positive guard this fix's own
// design note commits to: the bare word "held-out" in unrelated prose,
// with no surrounding tests[\/]...[\/] path shape, must NOT trigger.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK_PATH = join(dirname(fileURLToPath(import.meta.url)), 'tool-log-bash-output.mjs');

function runHook(payload) {
  const cwd = mkdtempSync(join(tmpdir(), 'tool-log-bash-output-test-'));
  const fullPayload = { cwd, ...payload };
  const result = spawnSync('node', [HOOK_PATH], { input: JSON.stringify(fullPayload), encoding: 'utf-8' });
  const stateDir = join(dirname(cwd), '.claude-plugin-state', basename(cwd));
  const logPath = join(stateDir, 'activity-log.jsonl');
  let entry = null;
  if (existsSync(logPath)) {
    entry = JSON.parse(readFileSync(logPath, 'utf-8').trim().split('\n').pop());
  }
  rmSync(cwd, { recursive: true, force: true });
  rmSync(stateDir, { recursive: true, force: true });
  return { exitCode: result.status, entry };
}

const cases = [
  {
    name: 'true positive: find command, no "held-out" in command text, held-out path in stdout (the exact Section 4.14 miss)',
    payload: {
      tool_name: 'Bash',
      tool_input: { command: 'find . -maxdepth 3 | sort' },
      tool_response: {
        stdout: '.\n./tests\n./tests/held-out\n./tests/held-out/GET-api-health.spec.ts\n./tests/visible',
        stderr: ''
      }
    },
    expectTouchesHeldOut: true
  },
  {
    name: 'false-positive guard: bare word "held-out" in unrelated prose, no path shape',
    payload: {
      tool_name: 'Bash',
      tool_input: { command: 'echo status' },
      tool_response: { stdout: 'This feature is being held-out from the release.', stderr: '' }
    },
    expectTouchesHeldOut: false
  },
  {
    name: 'neutral: ordinary command, no held-out anywhere',
    payload: {
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
      tool_response: { stdout: 'Tests 20 passed (20)', stderr: '' }
    },
    expectTouchesHeldOut: false
  },
  {
    name: 'true positive via stderr, not just stdout',
    payload: {
      tool_name: 'Bash',
      tool_input: { command: 'npx vitest run tests 2>&1' },
      tool_response: { stdout: '', stderr: 'Error: cannot resolve tests/held-out/GET-api-slabs.spec.ts' }
    },
    expectTouchesHeldOut: true
  }
];

let failures = 0;
for (const c of cases) {
  const { entry } = runHook(c.payload);
  const actual = entry?.touchesHeldOut;
  const pass = actual === c.expectTouchesHeldOut;
  console.log(`${pass ? 'PASS' : 'FAIL'} — ${c.name} (expected ${c.expectTouchesHeldOut}, got ${actual})`);
  if (!pass) failures++;
}

if (failures > 0) {
  console.error(`\n${failures} of ${cases.length} case(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${cases.length} cases passed.`);
