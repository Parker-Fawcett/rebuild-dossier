#!/usr/bin/env node
// Aggregates every rep's review-metrics.json into the pre-registered
// per-arm table and the pre-declared comparisons (PREREGISTRATION.md §5).
// Reports every rep, including degenerate and excluded ones; exclusions are
// listed, never silently dropped.
//
// Usage: node aggregate-review.mjs <root>
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2];
const stateRoot = join(root, '.claude-plugin-state');
const reps = readdirSync(stateRoot).filter((r) => /^[A-D]-rep\d$/.test(r)).sort();
const rows = reps.map((r) => {
  const p = join(stateRoot, r, 'review-metrics.json');
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : { rep: r, arm: r[0], missing: true };
});

// §3.4 exclusions: degenerate (zero logged tool calls) or launch failure.
const excluded = rows.filter((r) => r.missing || r.degenerate);
const valid = rows.filter((r) => !r.missing && !r.degenerate);

const logFact = (n) => { let s = 0; for (let i = 2; i <= n; i++) s += Math.log(i); return s; };
// Two-sided Fisher exact test on a 2x2 table [[a,b],[c,d]].
const fisher = (a, b, c, d) => {
  const n = a + b + c + d, r1 = a + b, c1 = a + c;
  const p = (x) => Math.exp(logFact(r1) + logFact(n - r1) + logFact(c1) + logFact(n - c1)
    - logFact(n) - logFact(x) - logFact(r1 - x) - logFact(c1 - x) - logFact(n - r1 - c1 + x));
  const obs = p(a);
  let tot = 0;
  for (let x = Math.max(0, r1 + c1 - n); x <= Math.min(r1, c1); x++) { const px = p(x); if (px <= obs * (1 + 1e-9)) tot += px; }
  return Math.min(1, tot);
};

const arm = (k) => valid.filter((r) => r.arm === k);
const summarize = (k) => {
  const a = arm(k);
  return {
    arm: k, valid: a.length,
    fullCompletion: a.filter((r) => r.heldOutFullCompletion).length,
    heldOutObligations: a.map((r) => `${r.heldOutObligationsPassed}/${r.heldOutObligationsTotal}`),
    visible: a.map((r) => `${r.visiblePass}/${r.visibleTotal}`),
    repsWithBatchInterval: a.filter((r) => r.batchIntervalCount > 0).length,
    maxNewFilesInOneInterval: a.map((r) => r.maxNewFilesInOneInterval),
    specEditAttempts: a.map((r) => r.specEditAttempts),
    specFilesChangedAtEnd: a.map((r) => r.specFilesChangedAtEnd.length),
    untestedContractAttempts: a.map((r) => r.untestedContractAttempts),
    outOfTreeAccessAttempts: a.map((r) => r.outOfTreeAccessAttempts)
  };
};

const cmp = (x, y, key) => {
  const X = arm(x), Y = arm(y);
  const a = X.filter(key).length, c = Y.filter(key).length;
  return { [`${x}`]: `${a}/${X.length}`, [`${y}`]: `${c}/${Y.length}`, fisherTwoSidedP: Number(fisher(a, X.length - a, c, Y.length - c).toFixed(3)) };
};

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  excluded: excluded.map((r) => ({ rep: r.rep, reason: r.missing ? 'no metrics (launch failure)' : 'degenerate: zero logged tool calls' })),
  perArm: ['A', 'B', 'C', 'D'].map(summarize),
  E2_blocking_vs_logonly_fullCompletion: cmp('A', 'B', (r) => r.heldOutFullCompletion),
  E3_batchAllowed_vs_discipline_fullCompletion: cmp('C', 'B', (r) => r.heldOutFullCompletion),
  E3_visibleGreen: cmp('C', 'B', (r) => r.visiblePass === r.visibleTotal && r.visibleTotal > 0),
  E4a_specLocked_vs_writable_specChanged: cmp('A', 'D', (r) => r.specFilesChangedAtEnd.length > 0),
  anyOutOfTreeAccess: valid.filter((r) => r.outOfTreeAccessAttempts > 0).map((r) => r.rep)
}, null, 2));
