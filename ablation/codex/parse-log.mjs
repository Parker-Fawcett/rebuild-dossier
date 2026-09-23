#!/usr/bin/env node
// Computes mechanical metrics for one rep from its .codex-plugin-state/
// directory. Ported from ../claude-code/parse-log.mjs, simplified where
// Codex's lack of per-tool hook matchers already merged what were separate
// phases there (before-readonly, after-bash-output) into 'before' and
// 'after-heartbeat' here — see hooks/tool-log.mjs and
// hooks/tool-heartbeat.mjs's own headers.
//
// Same standard as both prior harnesses: visible/held-out pass counts come
// from an INDEPENDENT post-trial re-run (visible-rerun.log /
// held-out-rerun.log, written by run-trial.sh), never from a hook-observed
// tool call.
//
// Usage: node parse-log.mjs <path/to/.codex-plugin-state/<rep-name>> <codex-exit-code>

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Identical to both prior harnesses' own parse-log.mjs — same real bug
// already found there (vitest omits the "N passed" clause entirely when
// zero tests pass), fixed the same way, ported rather than reintroducing it.
const TESTS_SUMMARY_PATTERN = /Tests\s+(?:(\d+)\s+failed\s*\|\s*)?(\d+)\s+passed\s*\((\d+)\)/;
const ALL_FAILED_NO_PASSED_CLAUSE_PATTERN = /Tests\s+(\d+)\s+failed\s*\((\d+)\)/;
// CONFIRMED necessary 2026-09-09, from a real trial, not a hypothetical: a
// real trial had the model correctly stop before any edit (a genuine
// spec/test contract mismatch — ".ts" in the locked contract vs. ".js" in
// the visible test's own import — triggering the kickoff prompt's own
// "STOP and ask" instruction, not a bug). With zero implementation files
// ever created, every spec file fails to even *import*, so vitest never
// reaches a per-test pass/fail count at all — it prints `Tests  no tests`
// instead of either pattern above, and both returned null (silently, no
// error) for a fully legitimate, real trial outcome. Falls back to `Test
// Files  N failed (N)` in that case, treating each failed test FILE as one
// test — an approximation, not a fact vitest itself asserts, but one
// grounded in this project's own one-`it()`-per-contract-file generation
// convention (confirmed by inspecting a real generated spec file), the same
// convention all three ablation harnesses' fixtures share.
const NO_TESTS_RAN_PATTERN = /Tests\s+no tests/;
const TEST_FILES_PATTERN = /Test Files\s+(\d+)\s+failed\s*\((\d+)\)/;

function parseTestsSummary(output) {
  if (!output) return null;
  const match = output.match(TESTS_SUMMARY_PATTERN);
  if (match) {
    const failed = match[1] ? Number(match[1]) : 0;
    const passed = Number(match[2]);
    const total = Number(match[3]);
    return { failed, passed, total, fullyGreen: failed === 0 && passed === total };
  }
  const allFailedMatch = output.match(ALL_FAILED_NO_PASSED_CLAUSE_PATTERN);
  if (allFailedMatch) {
    const failed = Number(allFailedMatch[1]);
    const total = Number(allFailedMatch[2]);
    return { failed, passed: 0, total, fullyGreen: failed === 0 && total === 0 };
  }
  if (NO_TESTS_RAN_PATTERN.test(output)) {
    const filesMatch = output.match(TEST_FILES_PATTERN);
    if (filesMatch) {
      const total = Number(filesMatch[2]);
      return { failed: total, passed: 0, total, fullyGreen: total === 0, approximatedFromTestFiles: true };
    }
    return { failed: 0, passed: 0, total: 0, fullyGreen: true, approximatedFromTestFiles: true };
  }
  return null;
}

const stateDir = process.argv[2];
const codexExitCode = process.argv[3] !== undefined ? Number(process.argv[3]) : null;

if (!stateDir) {
  console.error('Usage: node parse-log.mjs <path/to/.codex-plugin-state/<rep-name>> <codex-exit-code>');
  process.exit(1);
}

const logPath = join(stateDir, 'activity-log.jsonl');
if (!existsSync(logPath)) {
  console.log(JSON.stringify({ error: `no activity-log.jsonl found at ${logPath} — did the hooks actually fire at all?` }));
  process.exit(1);
}

const lines = readFileSync(logPath, 'utf-8')
  .split('\n')
  .filter((l) => l.trim().length > 0)
  .map((l) => JSON.parse(l));

const rawCaptureEntries = lines.filter((l) => l.phase === 'raw-capture' || l.phase === 'raw-capture-post');
const beforeEntries = lines.filter((l) => l.phase === 'before');
const heartbeatEntries = lines.filter((l) => l.phase === 'after-heartbeat');
const hookErrorEntries = lines.filter((l) => l.phase === 'hook-error');

// RAIL_VIOLATION_ATTEMPTS — every tool call this hook recognized as
// underSpec or untestedContract, regardless of whether it was actually
// blocked. Every tool call goes through tool-log.mjs here (no matcher to
// scope it to Edit/Write only), so this may legitimately include reads —
// same overcounting risk the OpenCode harness's own README names as its
// first real dry-run-caught bug. Report BOTH the raw count and a
// write-only-looking subset (best-effort, since tool name itself is an
// unconfirmed field) until a real dry run shows which tool names actually
// appear in toolNameRaw.
const railViolationAttempts = beforeEntries.filter((l) => l.underSpec || l.untestedContract);

const visibleRerunPath = join(stateDir, 'visible-rerun.log');
const heldOutRerunPath = join(stateDir, 'held-out-rerun.log');
const visibleSummary = existsSync(visibleRerunPath) ? parseTestsSummary(readFileSync(visibleRerunPath, 'utf-8')) : null;
const heldOutSummary = existsSync(heldOutRerunPath) ? parseTestsSummary(readFileSync(heldOutRerunPath, 'utf-8')) : null;

const heldOutTouches = [...beforeEntries, ...heartbeatEntries].filter((l) => l.touchesHeldOut);
// Content-aware signals from tool-heartbeat.mjs (2026-09-23); older logs count 0.
const heldOutRuns = heartbeatEntries.filter((l) => l.heldOutRun);
const heldOutExposures = heartbeatEntries.filter((l) => (l.heldOutContentExposed || []).length > 0);

const livenessPollPath = join(stateDir, 'liveness-poll.jsonl');
let totalPolls = 0;
let firstHeartbeatSeenAtPoll = null;
let heartbeatPresentAtFinalPoll = false;
let heartbeatDroppedOutAfterAppearing = false;
if (existsSync(livenessPollPath)) {
  const polls = readFileSync(livenessPollPath, 'utf-8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l));
  totalPolls = polls.length;
  polls.forEach((p, i) => {
    const present = Boolean(p.heartbeat && p.heartbeat !== null);
    if (present && firstHeartbeatSeenAtPoll === null) firstHeartbeatSeenAtPoll = i;
    if (!present && firstHeartbeatSeenAtPoll !== null) heartbeatDroppedOutAfterAppearing = true;
  });
  heartbeatPresentAtFinalPoll = totalPolls > 0 ? Boolean(polls[totalPolls - 1].heartbeat && polls[totalPolls - 1].heartbeat !== null) : false;
}

const result = {
  stateDir,
  codexExitCode,
  // Dry-run-specific diagnostics — not present in the other two harnesses'
  // parse-log.mjs, because their payload shapes were already confirmed.
  // Read these FIRST if anything else below looks wrong or empty.
  rawCaptureEntryCount: rawCaptureEntries.length,
  hookErrorCount: hookErrorEntries.length,
  hookErrors: hookErrorEntries.map((l) => ({ ts: l.ts, phase: l.phase, error: l.error })),
  sampleRawStdin: rawCaptureEntries.slice(0, 3).map((l) => ({ phase: l.phase, rawStdin: l.rawStdin, parseError: l.parseError })),

  totalToolCallsLogged: beforeEntries.length,
  railViolationAttempts: railViolationAttempts.length,
  railViolationDetail: railViolationAttempts.map((l) => ({ ts: l.ts, filePath: l.filePath, command: l.command, underSpec: l.underSpec, untestedContract: l.untestedContract })),
  heldOutTouchCount: heldOutTouches.length,
  heldOutTouchDetail: heldOutTouches.map((l) => ({ ts: l.ts, filePath: l.filePath, command: l.command })),
  heldOutRunCount: heldOutRuns.length,
  heldOutContentExposureCount: heldOutExposures.length,
  heldOutContentExposureDetail: heldOutExposures.map((l) => ({ ts: l.ts, exposed: l.heldOutContentExposed })),
  heldOutLeakageSuspected: heldOutExposures.length > 0 || heldOutRuns.length > 1,
  visiblePass: visibleSummary?.passed ?? null,
  visibleTotal: visibleSummary?.total ?? null,
  visibleFullyGreen: visibleSummary?.fullyGreen ?? null,
  heldOutPass: heldOutSummary?.passed ?? null,
  heldOutTotal: heldOutSummary?.total ?? null,
  hookHeartbeatEverFired: heartbeatEntries.length > 0,
  hookHeartbeatFireCount: heartbeatEntries.length,
  totalLivenessPolls: totalPolls,
  firstHeartbeatSeenAtPoll,
  heartbeatPresentAtFinalPoll,
  heartbeatDroppedOutAfterAppearing
};

console.log(JSON.stringify(result, null, 2));
