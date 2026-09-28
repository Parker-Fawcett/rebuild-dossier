// Scores each rebuild's battery results against the golden master, using the
// rule fixed in PROTOCOL.md (committed before any snapshot was run).
//   node evidence/fidelity-oracle/score.mjs
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(readFileSync(join(here, 'golden-original-54d7e65.json'), 'utf-8'));
const key = (r) => `${r.route}|${r.variant}`;
const scorable = new Map(golden.filter((g) => g.outcome === 'responded' && g.status < 500).map((g) => [key(g), g]));

const resultsDir = join(here, 'results');
const handlerTable = new Map(
  readFileSync(join(here, '..', 'handler-table.csv'), 'utf-8').trim().split('\n').slice(1)
    .map((l) => l.split(',')).map(([rep, , handlers, heldOut]) => [`sealed-haiku--${rep}`, { handlers: +handlers, heldOutFiles: +heldOut }])
);

const rows = [];
for (const f of readdirSync(resultsDir).filter((n) => n.endsWith('.json')).sort()) {
  const run = f.replace(/\.json$/, '');
  const [study, rep] = run.split('--');
  const res = JSON.parse(readFileSync(join(resultsDir, f), 'utf-8'));
  const t = { visible: { built: 0, status: 0, full: 0, missing: 0 }, 'held-out': { built: 0, status: 0, full: 0, missing: 0 } };
  const other = {};
  for (const r of res) {
    const g = scorable.get(key(r));
    if (!g) continue;
    const s = t[g.suite];
    if (r.outcome !== 'responded') {
      if (['not-built', 'method-missing'].includes(r.outcome)) s.missing++;
      else other[r.outcome] = (other[r.outcome] ?? 0) + 1;
      continue;
    }
    s.built++;
    if (r.status === g.status) {
      s.status++;
      if (JSON.stringify(r.keys) === JSON.stringify(g.keys)) s.full++;
    }
  }
  const arm = rep.split('-')[0];
  rows.push({ study, rep, arm, ...(handlerTable.get(run) ?? {}), visible: t.visible, heldOut: t['held-out'], other });
}

const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : 'n/a');
const header = 'study,rep,arm,exported_handlers,heldout_files_passed,vis_built,vis_status_match,vis_full_match,vis_missing,ho_built,ho_status_match,ho_full_match,ho_missing,other';
const lines = rows.map((r) => [r.study, r.rep, r.arm, r.handlers ?? '', r.heldOutFiles ?? '',
  r.visible.built, r.visible.status, r.visible.full, r.visible.missing,
  r.heldOut.built, r.heldOut.status, r.heldOut.full, r.heldOut.missing,
  JSON.stringify(r.other).replace(/,/g, ';')].join(','));
writeFileSync(join(here, 'fidelity-scores.csv'), [header, ...lines].join('\n') + '\n');

const sum = (xs, f) => xs.reduce((a, r) => a + f(r), 0);
console.log(`scorable checks: ${scorable.size} (visible ${[...scorable.values()].filter((g) => g.suite === 'visible').length}, held-out ${[...scorable.values()].filter((g) => g.suite === 'held-out').length})`);
for (const [label, sel] of [
  ['Haiku, all 20', (r) => r.study === 'sealed-haiku'],
  ['Haiku, discipline arms (A,B,D)', (r) => r.study === 'sealed-haiku' && r.arm !== 'C'],
  ['Haiku, batch-permitted (C)', (r) => r.study === 'sealed-haiku' && r.arm === 'C'],
  ['Sonnet, all 10', (r) => r.study === 'sealed-sonnet'],
]) {
  const xs = rows.filter(sel);
  const vb = sum(xs, (r) => r.visible.built), vf = sum(xs, (r) => r.visible.full), vs = sum(xs, (r) => r.visible.status);
  const hb = sum(xs, (r) => r.heldOut.built), hf = sum(xs, (r) => r.heldOut.full), hs = sum(xs, (r) => r.heldOut.status);
  console.log(`${label}: visible-route checks ${vf}/${vb} full (${pct(vf, vb)}), status ${pct(vs, vb)} | held-out-route checks built ${hb}, full ${hf}/${hb} (${pct(hf, hb)}), status ${pct(hs, hb)}`);
}
for (const r of rows) console.log(`${r.study}/${r.rep} h=${r.handlers ?? '-'} hoFiles=${r.heldOutFiles ?? '-'}  vis ${r.visible.full}/${r.visible.built}  ho ${r.heldOut.full}/${r.heldOut.built} (missing ${r.heldOut.missing}) ${Object.keys(r.other).length ? JSON.stringify(r.other) : ''}`);
