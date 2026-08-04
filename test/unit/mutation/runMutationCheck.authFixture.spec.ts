import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { runMutationCheck } from '../../../src/mutation/runMutationCheck.js';
import type { MutationTarget } from '../../../src/mutation/runMutationCheck.js';

const here = dirname(fileURLToPath(import.meta.url));
const sampleRepoPath = join(here, '../../fixtures/sample-repo');

// A generated page test loads its auth storageState fixture via a path
// relative to its own import.meta.url — see AUTH_STORAGE_STATE_FIXTURE_RELATIVE_PATH's
// doc comment in generatePageTests.ts. This exercises the real mechanism
// end-to-end: the test content below asserts the fixture actually exists at
// that relative path inside whatever scratch dir it's run in, so a
// regression here (the fixture missing from the scratch copy) surfaces as a
// real, non-vacuous test failure — not just an inspected internal.
const FIXTURE_PRESENCE_TEST_CONTENT = `import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
describe('fixture presence', () => {
  it('has the auth storageState fixture copied alongside', () => {
    expect(existsSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'auth-storage-state.json'))).toBe(true);
  });
});
`;

function fixturePresenceTarget(): MutationTarget {
  return {
    filename: 'fixture-presence.spec.ts',
    content: FIXTURE_PRESENCE_TEST_CONTENT,
    sourceFile: 'src/server.ts',
    maxMutationSites: 0 // baseline pass is the whole point of this test — no mutation sites needed
  };
}

describe('runMutationCheck — auth storageState fixture threading', () => {
  it('copies the caller-supplied storageState into every scratch dir so a generated page test referencing it does not misreport as unrunnable', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-mutation-authfixture-'));
    const authStorageStatePath = join(dir, 'state.json');
    try {
      writeFileSync(authStorageStatePath, JSON.stringify({ cookies: [], origins: [] }));

      const report = runMutationCheck(sampleRepoPath, [fixturePresenceTarget()], authStorageStatePath);

      expect(report.unrunnableTestFiles).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);

  it('leaves the fixture absent (and the test correctly unrunnable) when authStorageStatePath is not supplied — proves the assertion above is real, not vacuous', () => {
    const report = runMutationCheck(sampleRepoPath, [fixturePresenceTarget()]);

    expect(report.unrunnableTestFiles).toEqual(['fixture-presence.spec.ts']);
  }, 60000);
});
