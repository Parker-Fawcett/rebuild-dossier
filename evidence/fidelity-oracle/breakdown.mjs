// Breaks the frozen oracle's archived results down so that no single
// percentage can be read as overall correctness. Uses only archived files;
// the scoring rule is unchanged (PROTOCOL.md).
//   node evidence/fidelity-oracle/breakdown.mjs > evidence/fidelity-oracle/breakdown.txt
//
// Category = what the original returned on a scorable check:
//   auth = 401, validation = 400, static = 200.
// Route-level: a (run, route, category) cell counts as faithful only if every
// scorable check in it fully matches, so one missing guard counts once per
// route, not once per request variant.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(readFileSync(join(here, 'golden-original-54d7e65.json'), 'utf-8'));
const key = (r) => `${r.route}|${r.variant}`;
const CAT = { 401: 'auth', 400: 'validation', 200: 'static' };
const scorable = new Map(golden.filter((g) => g.outcome === 'responded' && g.status < 500).map((g) => [key(g), g]));

const runs = readdirSync(join(here, 'results')).filter((f) => f.endsWith('.json')).sort().map((f) => {
  const [study, rep] = f.replace('.json', '').split('--');
  return { study, rep, arm: rep.split('-')[0], res: JSON.parse(readFileSync(join(here, 'results', f), 'utf-8')) };
});

function tally(sel, suite) {
  const t = {};
  const routeCells = {};
  for (const run of runs.filter(sel)) {
    for (const r of run.res) {
      const g = scorable.get(key(r));
      if (!g || g.suite !== suite) continue;
      const cat = CAT[g.status];
      t[cat] ??= { checks: 0, built: 0, status: 0, full: 0 };
      t[cat].checks++;
      const cellKey = `${run.study}/${run.rep}|${r.route}|${cat}`;
      routeCells[cellKey] ??= { cat, built: true, allFull: true };
      if (r.outcome !== 'responded') { routeCells[cellKey].built = false; routeCells[cellKey].allFull = false; continue; }
      t[cat].built++;
      const statusOk = r.status === g.status;
      const fullOk = statusOk && JSON.stringify(r.keys) === JSON.stringify(g.keys);
      if (statusOk) t[cat].status++;
      if (fullOk) t[cat].full++; else routeCells[cellKey].allFull = false;
    }
  }
  const routes = {};
  for (const c of Object.values(routeCells)) {
    if (!c.built) continue;
    routes[c.cat] ??= { routeCells: 0, faithful: 0 };
    routes[c.cat].routeCells++;
    if (c.allFull) routes[c.cat].faithful++;
  }
  return { t, routes };
}

const groups = [
  ['Haiku A+B (10 runs)', (r) => r.study === 'sealed-haiku' && ['A', 'B'].includes(r.arm)],
  ['Sonnet A+B (10 runs)', (r) => r.study === 'sealed-sonnet'],
  ['Haiku C (5)', (r) => r.study === 'sealed-haiku' && r.arm === 'C'],
  ['Haiku D (5)', (r) => r.study === 'sealed-haiku' && r.arm === 'D'],
];

for (const suite of ['visible', 'held-out']) {
  console.log(`\n=== ${suite}-route checks (built only) ===`);
  for (const [label, sel] of groups) {
    const { t, routes } = tally(sel, suite);
    const parts = Object.entries(t).map(([cat, v]) =>
      `${cat}: status ${v.status}/${v.built}, full ${v.full}/${v.built}; route-cells faithful ${routes[cat]?.faithful ?? 0}/${routes[cat]?.routeCells ?? 0}`);
    console.log(`${label}\n  ${parts.join('\n  ') || 'none built'}`);
  }
}

console.log('\n=== per run, visible-route full matches by category (auth/validation/static) ===');
for (const run of runs) {
  const { t } = tally((r) => r === run, 'visible');
  const f = (c) => `${t[c]?.full ?? 0}/${t[c]?.built ?? 0}`;
  console.log(`${run.study}/${run.rep}: auth ${f('auth')}  validation ${f('validation')}  static ${f('static')}`);
}
