#!/usr/bin/env node
// Authoritative E5 scorer (PREREGISTRATION.md §6 endpoints, §9 deviation).
// run-astra.sh's inline scorer took visible pass/total from parse-log.mjs,
// which counts only collected test cases: vitest drops every file that fails
// to import, so a rep with 1 built route reported "1/1" and was wrongly
// marked visibleComplete. This recomputes visible obligations from the raw
// `Test Files` line against the fixed 20-file denominator, and route files
// from git status against the rep's baseline, for every finished rep.
//
// Usage: node rescore-astra.mjs [root] > astra-results.json
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';

const root = process.argv[2] || join(homedir(), 'sealed-runs', 'astra-2026-09');
const stateRoot = join(root, '.codex-plugin-state');
const VISIBLE_FILES = readdirSync(join(root, 'orig-rep1', 'tests', 'visible')).filter((f) => f.endsWith('.spec.ts')).length;

const filesPassed = (log) => {
  const line = (log.match(/Test Files\s+([^\n]+)/) || [])[1] || '';
  return Number((line.match(/(\d+) passed/) || [0, 0])[1]);
};

const rows = readdirSync(stateRoot)
  .filter((rep) => existsSync(join(stateRoot, rep, 'summary.json')))
  .map((rep) => {
    const state = join(stateRoot, rep);
    const summary = JSON.parse(readFileSync(join(state, 'summary.json'), 'utf-8'));
    const visibleLog = existsSync(join(state, 'visible-rerun.log')) ? readFileSync(join(state, 'visible-rerun.log'), 'utf-8') : '';
    const status = execFileSync('git', ['-C', join(root, rep), 'status', '--porcelain', '--untracked-files=all', '--', 'src'], { encoding: 'utf-8' });
    const routes = status.split('\n').filter((l) => /src\/app\/.*\/route\.(ts|js)$/.test(l)).length;
    const transcript = existsSync(join(state, 'transcript.log')) ? readFileSync(join(state, 'transcript.log'), 'utf-8') : '';
    const visiblePassFiles = filesPassed(visibleLog);
    return {
      rep,
      arm: rep.replace(/-rep\d+$/, ''),
      model: rep.startsWith('g55') ? 'gpt-5.5' : 'gpt-6-astra',
      routeFilesCreated: routes,
      stall: routes <= 1,
      progressBeyondOneRoute: routes > 1,
      visibleObligationsPassed: visiblePassFiles,
      visibleObligationsTotal: VISIBLE_FILES,
      visibleComplete: visiblePassFiles === VISIBLE_FILES,
      railViolationAttempts: summary.railViolationAttempts,
      citesStep6: /step 6|Only once the full visible suite is green/i.test(transcript.slice(-4000)),
      citesItemIdMismatch: /itemId/.test(transcript.slice(-4000)),
      exitCode: summary.codexExitCode ?? summary.exitCode ?? null
    };
  })
  .sort((a, b) => a.rep.localeCompare(b.rep));

const arm = (name) => {
  const a = rows.filter((r) => r.arm === name);
  return {
    n: a.length,
    stall: a.filter((r) => r.stall).length,
    progress: a.filter((r) => r.progressBeyondOneRoute).length,
    visibleComplete: a.filter((r) => r.visibleComplete).length,
    citesStep6: a.filter((r) => r.citesStep6).length
  };
};

console.log(JSON.stringify({
  scoredAt: new Date().toISOString(),
  perArm: Object.fromEntries(['orig', 'rev', 'ctrl', 'g55orig', 'g55rev'].map((k) => [k, arm(k)])),
  rows
}, null, 2));
