// Scores S. N. Ahmed's independent checks with the rule fixed in PROTOCOL.md.
//   node evidence/independent-oracle/score.mjs
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const checks = new Map(JSON.parse(readFileSync(join(here, 'checks-ahmed.json'), 'utf-8')).checks.map((c) => [c.id, c]));
const ARRAY_BODY = new Set(['R25-a', 'R32-a']);
const category = (c) => ({ 401: 'auth', 400: 'validation', 200: 'other' })[c.expect_status];

function judge(r) {
  const c = checks.get(r.id);
  if (r.outcome !== 'responded') return { status: false, full: false, outcome: r.outcome };
  const status = r.status === c.expect_status;
  const shape = ARRAY_BODY.has(r.id)
    ? r.keys === 'array'
    : Array.isArray(r.keys) && JSON.stringify(r.keys) === JSON.stringify([...c.expect_keys].sort());
  return { status, full: status && shape, outcome: 'responded' };
}

const load = (f) => JSON.parse(readFileSync(join(here, 'results', f), 'utf-8'));
const original = load('original-54d7e65.json');
const originalOk = new Set(original.filter((r) => judge(r).full).map((r) => r.id));

function tally(results) {
  const t = {};
  for (const r of results) {
    const j = judge(r);
    for (const key of ['all', `suite:${r.suite}`, `cat:${category(checks.get(r.id))}`, `${r.suite}:${category(checks.get(r.id))}`]) {
      t[key] ??= { n: 0, built: 0, status: 0, full: 0, missing: 0, other: 0 };
      const s = t[key];
      s.n++;
      if (j.outcome === 'responded') s.built++;
      else if (['not-built', 'method-missing'].includes(j.outcome)) s.missing++;
      else s.other++;
      s.status += j.status;
      s.full += j.full;
    }
  }
  return t;
}

const out = [];
const log = (s) => out.push(s);
log(`original @54d7e65: ${originalOk.size}/${checks.size} checks satisfied (full match)`);
const disagreements = original.filter((r) => !originalOk.has(r.id)).map((r) => r.id);
log(`checks the original does not satisfy: ${disagreements.length ? disagreements.join(', ') : 'none'}`);

const runs = readdirSync(join(here, 'results')).filter((f) => f.startsWith('sealed-')).sort();
const rows = runs.map((f) => {
  const [study, rep] = f.replace(/\.json$/, '').split('--');
  return { study, rep, arm: rep.split('-')[0], t: tally(load(f)) };
});
const stub = tally(load('stub-constant-200.json'));

const fmt = (s) => (s ? `${s.full}/${s.built} full (status ${s.status}/${s.built}; not built ${s.missing}${s.other ? `; other ${s.other}` : ''})` : 'n/a');
const sumT = (xs, key) => xs.reduce((a, r) => {
  const s = r.t[key];
  if (!s) return a;
  a ??= {};
  for (const k of Object.keys(s)) a[k] = (a[k] ?? 0) + s[k];
  return a;
}, null);

log('');
log(`stub (constant 200): ${fmt(stub.all)}`);
for (const k of ['cat:auth', 'cat:validation', 'cat:other']) log(`  ${k}: ${fmt(stub[k])}`);

for (const [label, sel] of [
  ['Haiku, all 20', (r) => r.study === 'sealed-haiku'],
  ['Haiku, A+B', (r) => r.study === 'sealed-haiku' && 'AB'.includes(r.arm)],
  ['Haiku, discipline arms A,B,D', (r) => r.study === 'sealed-haiku' && r.arm !== 'C'],
  ['Haiku, arm C', (r) => r.study === 'sealed-haiku' && r.arm === 'C'],
  ['Sonnet, A+B (all 10)', (r) => r.study === 'sealed-sonnet'],
]) {
  const xs = rows.filter(sel);
  log('');
  log(`${label} (${xs.length} runs): ${fmt(sumT(xs, 'all'))}`);
  for (const k of ['visible:auth', 'visible:validation', 'visible:other', 'held-out:auth', 'held-out:validation', 'held-out:other']) {
    const s = sumT(xs, k);
    if (s) log(`  ${k}: ${fmt(s)}`);
  }
}

log('');
log('per run: full matches on visible-route checks / built; held-out-route checks full / built');
for (const r of rows) {
  const v = r.t['suite:visible'];
  const h = r.t['suite:held-out'];
  log(`${r.study}/${r.rep}  visible ${v.full}/${v.built}  held-out ${h.full}/${h.built} (not built ${h.missing})`);
}

const header = 'study,rep,arm,vis_n,vis_built,vis_status,vis_full,ho_n,ho_built,ho_status,ho_full,ho_missing';
const csv = rows.map((r) => {
  const v = r.t['suite:visible'], h = r.t['suite:held-out'];
  return [r.study, r.rep, r.arm, v.n, v.built, v.status, v.full, h.n, h.built, h.status, h.full, h.missing].join(',');
});
writeFileSync(join(here, 'scores.csv'), [header, ...csv].join('\n') + '\n');
writeFileSync(join(here, 'score-output.txt'), out.join('\n') + '\n');
console.log(out.join('\n'));
