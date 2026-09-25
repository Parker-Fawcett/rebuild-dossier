import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { mkdtempSync, cpSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { generateTests } from '../../../src/spec/generateTests.js';
import { runMutationCheck, prepareScratchCopy } from '../../../src/mutation/runMutationCheck.js';
import type { EvidenceBundle } from '../../../src/ingest/evidenceSchema.js';

const here = dirname(fileURLToPath(import.meta.url));
const aliasedRepoPath = join(here, '../../fixtures/aliased-repo');
const now = new Date(0).toISOString();

// Found live on a real Express app: it shipped its own vitest.config.js whose
// `test.include` covered only its own hand-written suite. The scratch copy
// carried that config along, vitest auto-discovered it ahead of ours, and
// every generated test reported "No test files found" — all 35 of the app's
// generated API tests came back unrunnable with a bare "vitest exited with
// code 1". The mutation check now always writes its own config and passes it
// with --config, so a target's config can no longer hide generated tests.
describe('runMutationCheck against a repo that ships its own narrowing vitest config', () => {
  it('still runs and mutation-checks the generated tests', () => {
    const repoCopy = mkdtempSync(join(tmpdir(), 'rebuild-dossier-own-config-'));
    try {
      cpSync(aliasedRepoPath, repoCopy, { recursive: true });
      writeFileSync(
        join(repoCopy, 'vitest.config.js'),
        "export default { test: { include: ['server/__tests__/**/*.test.js'] } };\n"
      );

      const evidence: EvidenceBundle = {
        repoPath: repoCopy,
        generatedAt: now,
        packageJson: { scripts: {}, dependencies: { express: '^4.19.0' }, devDependencies: {} },
        buildConfig: [],
        routes: [{ path: '/api/users/:id', method: 'GET', file: 'src/server.ts', kind: 'api', startLine: 6 }],
        existingTests: [],
        signals: []
      };

      const { visible, heldOut } = generateTests(repoCopy, evidence, []);
      const target = [...visible, ...heldOut][0]!;
      const report = runMutationCheck(repoCopy, [{ ...target, sourceFile: 'src/lib/users.ts' }]);

      expect(report.unrunnableTestFiles).toEqual([]);
      expect(report.results.length).toBeGreaterThan(0);
      expect(report.results.every((r) => r.killed)).toBe(true);
      expect(report.weakTestFiles).toEqual([]);
    } finally {
      rmSync(repoCopy, { recursive: true, force: true });
    }
  }, 60000);

  it('writes its own config under a name that never collides with the target\'s', () => {
    const repoCopy = mkdtempSync(join(tmpdir(), 'rebuild-dossier-own-config-name-'));
    let scratchDir: string | undefined;
    try {
      cpSync(aliasedRepoPath, repoCopy, { recursive: true });
      writeFileSync(join(repoCopy, 'vitest.config.js'), "export default { test: { include: ['x/**'] } };\n");
      scratchDir = prepareScratchCopy(repoCopy);
      expect(existsSync(join(scratchDir, 'rebuild-dossier.vitest.config.mjs'))).toBe(true);
      // The target's own file is carried over untouched; ours sits beside it.
      expect(existsSync(join(scratchDir, 'vitest.config.js'))).toBe(true);
    } finally {
      if (scratchDir) rmSync(scratchDir, { recursive: true, force: true });
      rmSync(repoCopy, { recursive: true, force: true });
    }
  });
});
