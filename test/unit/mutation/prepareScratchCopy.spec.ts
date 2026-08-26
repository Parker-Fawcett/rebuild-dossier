import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareScratchCopy } from '../../../src/mutation/runMutationCheck.js';

describe('prepareScratchCopy', () => {
  it('excludes .next build output from the mutation-check scratch copy', () => {
    // The same gap as listSourceFiles.ts's IGNORED_DIRS (docs/v0-findings.md,
    // "ingest_repo scans build output as source") existed independently here:
    // a second, duplicate IGNORED_DIRS constant that also lacked .next, used
    // to filter what gets copied into the scratch dir before mutating it.
    const repoDir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-repro-'));
    let scratchDir: string | undefined;
    try {
      writeFileSync(join(repoDir, 'index.ts'), 'export {};');
      mkdirSync(join(repoDir, '.next', 'server'), { recursive: true });
      writeFileSync(join(repoDir, '.next', 'server', 'chunk.js'), '// webpack vendor bundle');

      scratchDir = prepareScratchCopy(repoDir);

      expect(existsSync(join(scratchDir, 'index.ts'))).toBe(true);
      expect(existsSync(join(scratchDir, '.next'))).toBe(false);
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
      if (scratchDir) rmSync(scratchDir, { recursive: true, force: true });
    }
  });
});
