// Scores a battery result against the golden master under the rule in
// PROTOCOL.md (committed before the rebuild was run).
//   node evidence/second-app-audit/score.mjs <results.json>
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const golden = Object.fromEntries(JSON.parse(readFileSync(join(here, 'golden-original-857d02f.json'), 'utf-8')).map((g) => [g.id.slice(0, 3), g]));
const target = JSON.parse(readFileSync(process.argv[2], 'utf-8'));
const FLAGGED = { R11: { status: 401 }, R16: { status: 200, needsData: true }, R17: { status: 204 } };
const GROUP = { R04: 'auth', R05: 'auth', R06: 'auth', R07: 'auth', R11: 'flagged', R16: 'flagged', R17: 'flagged',
  R09: 'errors', R12: 'errors', R14: 'errors', R18: 'errors' };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const rows = [];
for (const t of target) {
  const id = t.id.slice(0, 3);
  const g = golden[id];
  if (id === 'R19') { rows.push({ id: t.id, group: 'unscored', note: `original: ${g.outcome}; rebuild: ${t.outcome} ${t.status ?? ''}` }); continue; }
  let statusOk, full;
  if (FLAGGED[id]) {
    statusOk = t.status === FLAGGED[id].status;
    full = statusOk && (!FLAGGED[id].needsData || (Array.isArray(t.keys) && t.keys.includes('data')));
  } else {
    statusOk = t.status === g.status;
    full = statusOk && eq(t.keys, g.keys)
      && (id !== 'R01' || t.location === g.location)
      && (!['R03', 'R13', 'R15'].includes(id) || eq(t.dataKeys, g.dataKeys));
  }
  rows.push({ id: t.id, group: GROUP[id] ?? 'data/shape', expected: FLAGGED[id] ? `flagged intent ${FLAGGED[id].status}` : `${g.status} ${JSON.stringify(g.keys)}`, got: `${t.status} ${JSON.stringify(t.keys)}`, statusOk, full });
}
const seed = target.find((t) => t.id.startsWith('R02'));
const scored = rows.filter((r) => r.group !== 'unscored');
console.log(`scored checks: ${scored.length}; full match ${scored.filter((r) => r.full).length}; status match ${scored.filter((r) => r.statusOk).length}`);
for (const grp of ['auth', 'data/shape', 'errors', 'flagged']) {
  const xs = scored.filter((r) => r.group === grp);
  console.log(`  ${grp}: full ${xs.filter((r) => r.full).length}/${xs.length}, status ${xs.filter((r) => r.statusOk).length}/${xs.length}`);
}
console.log(`seed data (R02 list length): original ${golden.R02.dataLength}, rebuild ${seed?.dataLength}`);
for (const r of rows) console.log(`${r.full ? 'MATCH ' : r.group === 'unscored' ? 'n/a   ' : r.statusOk ? 'status' : 'DIFF  '} ${r.id}${r.expected ? `  expected ${r.expected}  got ${r.got}` : `  ${r.note}`}`);
