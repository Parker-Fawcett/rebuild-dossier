import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { generateTests } from '../../../src/spec/generateTests.js';
import { runMutationCheck } from '../../../src/mutation/runMutationCheck.js';
import type { EvidenceBundle } from '../../../src/ingest/evidenceSchema.js';

const here = dirname(fileURLToPath(import.meta.url));
const now = new Date(0).toISOString();

// Caught by actually running this against the aliased-repo fixture before the
// alias-resolution fix existed: a test that NEVER passes (for any reason —
// broken import, missing env, whatever) was being scored as "killed: true"
// for every mutation site, since runVitestOnce just returns false on ANY
// failure and killed = !succeeded. That's a false "100% kill rate" for a
// test providing zero real signal — worse than a weak test, because a weak
// test at least gets flagged and moved to tests/weak/. A test must first be
// confirmed to pass against the ORIGINAL, unmutated code before any mutant
// run is meaningful at all.
describe('runMutationCheck baseline-pass check', () => {
  it('marks a test that never passes (even unmutated) as unrunnable, not as having killed every mutant', () => {
    const aliasedRepoPath = join(here, '../../fixtures/aliased-repo');
    const evidence: EvidenceBundle = {
      repoPath: aliasedRepoPath,
      generatedAt: now,
      packageJson: { scripts: {}, dependencies: { express: '^4.19.0' }, devDependencies: {} },
      buildConfig: [],
      routes: [{ path: '/api/users/:id', method: 'GET', file: 'src/server.ts', kind: 'api', startLine: 6 }],
      existingTests: [],
      signals: []
    };
    const { visible, heldOut } = generateTests(aliasedRepoPath, evidence, []);
    const target = [...visible, ...heldOut][0]!;

    // Deliberately break the import so this target can never pass, regardless
    // of alias support — isolates the baseline-check fix from the alias fix.
    const brokenTarget = { ...target, sourceFile: 'src/lib/users.ts', content: target.content.replace("'../../src/server.js'", "'../../src/does-not-exist.js'") };

    const report = runMutationCheck(aliasedRepoPath, [brokenTarget]);

    expect(report.unrunnableTestFiles).toEqual([brokenTarget.filename]);
    expect(report.weakTestFiles).toEqual([]); // must not be conflated with a weak-but-runnable test
    expect(report.results.filter((r) => r.testFile === brokenTarget.filename)).toEqual([]); // no fake "killed" results
  }, 60000);
});

// End-to-end evidence for the per-run cap (see runWithWatchdog.ts): a target
// whose test hangs forever in beforeAll must not stall the mutation check.
// Before the watchdog, the cap was execFileSync's own timeout, observed not to
// fire at all; this run would have waited for the hang to end on its own.
describe('runMutationCheck per-run cap', () => {
  it('stops a hung test run at the cap and scores it unrunnable instead of waiting it out', () => {
    const aliasedRepoPath = join(here, '../../fixtures/aliased-repo');
    const evidence: EvidenceBundle = {
      repoPath: aliasedRepoPath,
      generatedAt: now,
      packageJson: { scripts: {}, dependencies: { express: '^4.19.0' }, devDependencies: {} },
      buildConfig: [],
      routes: [{ path: '/api/users/:id', method: 'GET', file: 'src/server.ts', kind: 'api', startLine: 6 }],
      existingTests: [],
      signals: []
    };
    const { visible, heldOut } = generateTests(aliasedRepoPath, evidence, []);
    const target = [...visible, ...heldOut][0]!;
    const hungTarget = {
      ...target,
      content: "import { beforeAll, it } from 'vitest';\nbeforeAll(() => new Promise(() => {}), 10_000_000);\nit('never gets here', () => {});\n"
    };
    const previous = process.env.REBUILD_DOSSIER_MUTATION_TIMEOUT_MS;
    process.env.REBUILD_DOSSIER_MUTATION_TIMEOUT_MS = '4000';
    const started = Date.now();
    try {
      const report = runMutationCheck(aliasedRepoPath, [hungTarget]);
      expect(report.unrunnableTestFiles).toEqual([hungTarget.filename]);
    } finally {
      if (previous === undefined) delete process.env.REBUILD_DOSSIER_MUTATION_TIMEOUT_MS;
      else process.env.REBUILD_DOSSIER_MUTATION_TIMEOUT_MS = previous;
    }
    // One capped baseline run (4s) plus scratch-copy setup; nowhere near the hang.
    expect(Date.now() - started).toBeLessThan(45_000);
  }, 90_000);
});
