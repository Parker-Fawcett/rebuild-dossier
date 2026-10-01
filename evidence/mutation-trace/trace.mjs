// Mutation trace for the three routes fixed in SELECTION.md.
// For each route: run its archived visible test against the unmutated original
// (baseline), then against every mutant today's engine applies to the original
// route file, recording vitest's own failure message for each. No agent runs.
//
//   ORIGINAL=<catchandtrade@54d7e65>/apps/web node evidence/mutation-trace/trace.mjs
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { prepareScratchCopy } from '../../dist/mutation/runMutationCheck.js';
import { tsMorphEngine } from '../../dist/mutation/tsMorphEngine.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const ORIGINAL = process.env.ORIGINAL;
const VITEST = join(repoRoot, 'node_modules', 'vitest', 'vitest.mjs');
const TESTS = process.env.VISIBLE_TESTS; // the sealed study's archived tests/visible
const ENV = { ...process.env, DATABASE_URL: 'postgresql://oracle:oracle@127.0.0.1:1/oracle?connect_timeout=1' };

const ROUTES = [
  { role: 'authentication', test: 'GET-api-pokedex.spec.ts', file: 'src/app/api/pokedex/route.ts' },
  { role: 'validation', test: 'POST-api-auth.spec.ts', file: 'src/app/api/auth/route.ts' },
  { role: 'static control', test: 'GET-api-wishlist.spec.ts', file: 'src/app/api/wishlist/route.ts' },
];

function runTest(scratch, testName, content) {
  const dir = join(scratch, 'tests', 'visible');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, testName), content);
  const out = join(scratch, 'trace-result.json');
  const r = spawnSync('node', [VITEST, 'run', `tests/visible/${testName}`, '--root', scratch,
    '--config', join(scratch, 'rebuild-dossier.vitest.config.mjs'), '--reporter=json', `--outputFile=${out}`, '--no-color'],
    { env: ENV, encoding: 'utf-8', timeout: 120000 });
  let passed = false, messages = [];
  try {
    const json = JSON.parse(readFileSync(out, 'utf-8'));
    passed = json.success === true && json.numFailedTests === 0 && json.numPassedTests > 0;
    for (const f of json.testResults ?? []) {
      if (f.message) messages.push(f.message.split('\n')[0]);
      for (const a of f.assertionResults ?? []) for (const m of a.failureMessages ?? []) messages.push(m.split('\n')[0]);
    }
  } catch {
    messages.push(`no reporter output (exit ${r.status}${r.error ? `, ${r.error.message}` : ''})`);
  }
  return { passed, messages };
}

function classify(messages) {
  const m = messages.join(' | ');
  if (/expected 5\d\d to be less than 500/.test(m)) return 'wrong status (5xx response)';
  if (/expected \d+ to be less than|expected \d+ to be \d+/.test(m)) return 'wrong status';
  if (/TypeError|ReferenceError|Cannot read prop|is not a function|undefined/.test(m)) return 'exception';
  if (/Failed to load|Cannot find module|Transform failed|SyntaxError/.test(m)) return 'import/transform error';
  if (/timed out|Timeout/i.test(m)) return 'timeout';
  return m ? 'other' : 'none';
}

const report = [];
for (const route of ROUTES) {
  const content = readFileSync(join(TESTS, route.test), 'utf-8');
  const baseScratch = prepareScratchCopy(ORIGINAL);
  const baseline = runTest(baseScratch, route.test, content);
  rmSync(baseScratch, { recursive: true, force: true });

  const sites = tsMorphEngine.enumerateSites(join(ORIGINAL, route.file), route.file);
  const mutants = [];
  for (const site of sites) {
    const scratch = prepareScratchCopy(ORIGINAL);
    try {
      const applied = tsMorphEngine.apply(join(scratch, route.file), site);
      if (!applied) { mutants.push({ site, applied: false }); continue; }
      const res = runTest(scratch, route.test, content);
      mutants.push({ site, applied: true, killed: !res.passed, cause: res.passed ? null : classify(res.messages), messages: res.messages.slice(0, 3) });
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
  report.push({ ...route, assertion: (content.match(/expect\([^;]*;/g) ?? []), baseline, mutants });
  console.log(`${route.role} ${route.file}: baseline ${baseline.passed ? 'PASS' : 'FAIL ' + baseline.messages[0]}; ${mutants.length} sites, killed ${mutants.filter((x) => x.killed).length}`);
  for (const x of mutants) console.log(`   ${x.site.mutatorName} @${x.site.locator?.startLine ?? '?'}: ${x.applied === false ? 'not applied' : x.killed ? `KILLED (${x.cause}) ${x.messages[0] ?? ''}` : 'survived'}`);
}
writeFileSync(join(here, 'trace-results.json'), JSON.stringify(report, null, 1));
