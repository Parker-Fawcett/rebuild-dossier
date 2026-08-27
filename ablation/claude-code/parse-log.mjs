#!/usr/bin/env node
// Computes mechanical metrics for one rep from its .claude-plugin-state/
// directory — never from the agent's own self-report. Ported from the
// OpenCode ablation's ../parse-log.mjs; the two differences are structural,
// not stylistic:
//
// 1. Visible/held-out pass counts come from an INDEPENDENT post-trial
//    re-run (visible-rerun.log / held-out-rerun.log, written by
//    run-trial.sh), not scraped from a bash tool call's own logged output —
//    this project's PostToolUse tool_response schema is not independently
//    confirmed here (see README), so this sidesteps needing it for the
//    single most important number this harness produces.
// 2. "Hook confirmed live" is checked against liveness-poll.jsonl — polled
//    every 20s for the FULL run duration by run-trial.sh — not just
//    reconstructed from whether the heartbeat file exists after the fact.
//    Matches Section 4.9's own standard ("polled at 20-second intervals for
//    the full duration ... not reconstructed afterward"), stronger than the
//    OpenCode ablation's own after-the-fact heartbeat check.
//
// Usage: node parse-log.mjs <path/to/.claude-plugin-state/<rep-name>> <claude-exit-code>
// Prints one JSON object to stdout.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const HELD_OUT_PATH_PATTERN = /(^|[\s\\/])tests[\\/]held-out[\\/]/;

// Vitest's own summary line — same base pattern as the OpenCode ablation's
// parse-log.mjs (identical bug confirmed still present there, unfixed as of
// this writing), matches this project's REBUILD_TEST_SCRIPT output shape
// (src/spec/writeSpecTree.ts), not a guessed format.
//
// Real bug found running this harness for real, not by inspection: vitest
// OMITS the "N passed" clause entirely when zero tests pass, printing just
// "Tests  7 failed (7)" instead of "Tests  7 failed | 0 passed (7)" — the
// original pattern above required "passed" to always appear, so it silently
// returned null (not 0) for a legitimate, real all-failing run. Confirmed
// directly: two real reps (with-rep2, without-rep3 of the catchandtrade
// weak-tier pair) hit exactly this vitest output shape.
const TESTS_SUMMARY_PATTERN = /Tests\s+(?:(\d+)\s+failed\s*\|\s*)?(\d+)\s+passed\s*\((\d+)\)/;
const ALL_FAILED_NO_PASSED_CLAUSE_PATTERN = /Tests\s+(\d+)\s+failed\s*\((\d+)\)/;

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
  return null;
}

const stateDir = process.argv[2];
const claudeExitCode = process.argv[3] !== undefined ? Number(process.argv[3]) : null;

if (!stateDir) {
  console.error('Usage: node parse-log.mjs <path/to/.claude-plugin-state/<rep-name>> <claude-exit-code>');
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

const beforeEntries = lines.filter((l) => l.phase === 'before');
const readonlyEntries = lines.filter((l) => l.phase === 'before-readonly');
const heartbeatEntries = lines.filter((l) => l.phase === 'after-heartbeat');

// RAIL_VIOLATION_ATTEMPTS — every Edit/Write attempt this hook recognized as
// underSpec or untestedContract, regardless of whether it was actually
// blocked (that's the point: this count means the same thing in both
// conditions). Only tool-log.mjs's `before` entries are Edit/Write in the
// first place (tool-log-readonly.mjs's matcher never includes them), so no
// separate tool-name filter is needed the way the OpenCode version required.
const railViolationAttempts = beforeEntries.filter((l) => l.underSpec || l.untestedContract);

// Independent re-run results — the authoritative pass counts, not scraped
// from any hook-observed tool output.
const visibleRerunPath = join(stateDir, 'visible-rerun.log');
const heldOutRerunPath = join(stateDir, 'held-out-rerun.log');
const visibleSummary = existsSync(visibleRerunPath) ? parseTestsSummary(readFileSync(visibleRerunPath, 'utf-8')) : null;
const heldOutSummary = existsSync(heldOutRerunPath) ? parseTestsSummary(readFileSync(heldOutRerunPath, 'utf-8')) : null;

// HELD_OUT_ACCESSED_BEFORE_GREEN — any touch across BOTH hooks (Edit/Write
// attempts that happened to target tests/held-out/, which tool-log.mjs would
// already be blocking as underSpec-adjacent contract logic doesn't cover, so
// realistically this comes from tool-log-readonly.mjs's Read/Bash/Glob/Grep
// entries). This harness cannot compute a "before/after the FIRST visible
// green" timestamp the way the OpenCode version does, because it does not
// scrape bash output for a live-updating visible-suite result — it only has
// ONE authoritative visible result, from the single independent re-run after
// the trial ends. So this metric answers a narrower, still real question:
// was tests/held-out/ ever touched at all during the run. Cross-check this
// against the trial's own self-reported HELD_OUT_ACCESSED_BEFORE_GREEN
// timestamp (trial-prompt-suffix.txt field 7) rather than treating this as
// a full replacement for it — a real, named gap, not silently routed around.
const heldOutTouches = readonlyEntries.filter((l) => l.touchesHeldOut);

// Hook liveness, checked across the WHOLE run's poll history, not just
// reconstructed from the heartbeat file after the fact. A poll before the
// agent's first edit legitimately shows no heartbeat yet — that alone isn't
// a failure — so "confirmed live" means: the heartbeat appeared at some
// point, and once it appeared, it never disappeared again on a later poll
// (a gap after appearing would mean something broke mid-run, worth flagging
// on its own rather than averaging away).
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
  claudeExitCode,
  totalToolCallsLogged: beforeEntries.length + readonlyEntries.length,
  railViolationAttempts: railViolationAttempts.length,
  railViolationDetail: railViolationAttempts.map((l) => ({ ts: l.ts, filePath: l.filePath, underSpec: l.underSpec, untestedContract: l.untestedContract })),
  heldOutTouchCount: heldOutTouches.length,
  heldOutTouchDetail: heldOutTouches.map((l) => ({ ts: l.ts, filePath: l.filePath, command: l.command })),
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
