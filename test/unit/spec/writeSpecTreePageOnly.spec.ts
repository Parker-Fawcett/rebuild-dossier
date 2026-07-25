import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EvidenceBundle } from '../../../src/ingest/evidenceSchema.js';

// This file exists specifically to prove that PAGE tests alone (with no gate
// test involved at all) are enough to trip the sequential-file-execution gate
// (vitest.config.ts's fileParallelism: false) and the playwright devDependency
// addition in writeSpecTree.ts. Doing that with a REAL page capture would
// require a genuinely running `next dev` + Chromium instance inside a unit
// test — exactly what the other writeSpecTree.spec.ts fixtures deliberately
// avoid (see e.g. its "generates a Next.js API route test" comment). So this
// file mocks generatePageTests.ts's capture phase to return a fixed,
// already-captured result, isolating the assertion to writeSpecTree.ts's own
// wiring rather than re-testing Playwright/next-dev behavior covered
// elsewhere (generatePageTests.spec.ts, and the real-target manual smoke
// test). The mock is scoped to this file only — writeSpecTree.spec.ts's own
// fixtures are unaffected and continue exercising the real (early-exit)
// generatePageTests path.
vi.mock('../../../src/spec/generatePageTests.js', () => ({
  generatePageTests: vi.fn().mockResolvedValue({
    visible: [
      {
        filename: 'PAGE-root.page.spec.ts',
        content: "import { describe, it, expect } from 'vitest';\ndescribe('page test', () => { it('placeholder', () => { expect(true).toBe(true); }); });\n",
        sourceFile: 'page.tsx',
        coveredRouteFiles: ['page.tsx'],
        maxMutationSites: 3
      }
    ],
    heldOut: [],
    assetManifest: [],
    screenshots: [],
    capturedPages: ['page.tsx'],
    skippedPages: []
  })
}));

const { writeSpecTree } = await import('../../../src/spec/writeSpecTree.js');

const now = new Date(0).toISOString();

describe('writeSpecTree — page tests alone drive the sequential-execution gate', () => {
  it('writes vitest.config.ts with fileParallelism: false and adds playwright, from page tests alone (no gate test involved)', async () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-writetree-pageonly-repo-'));
    const outputDir = join(tmpdir(), `rebuild-dossier-writetree-pageonly-out-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    try {
      writeFileSync(join(repoDir, 'page.tsx'), 'export default function Home() { return null; }');

      const evidence: EvidenceBundle = {
        repoPath: repoDir,
        generatedAt: now,
        packageJson: { name: 'app', scripts: {}, dependencies: { next: '^16.0.0' }, devDependencies: {} },
        buildConfig: [],
        routes: [{ path: '/', file: 'page.tsx', kind: 'page', startLine: 1 }],
        existingTests: [],
        signals: []
      };

      const result = await writeSpecTree({ repoPath: repoDir, outputDir, evidence, cases: [] });

      expect(existsSync(join(outputDir, 'vitest.config.ts'))).toBe(true);
      expect(readFileSync(join(outputDir, 'vitest.config.ts'), 'utf-8')).toContain('fileParallelism: false');

      const pkg = JSON.parse(readFileSync(join(outputDir, 'package.json'), 'utf-8'));
      expect(pkg.devDependencies.playwright).toBeDefined();

      // The mocked capture succeeded for page.tsx, so it must not be blocked.
      expect(JSON.parse(readFileSync(join(outputDir, 'spec', 'untested-contracts.json'), 'utf-8'))).toEqual([]);

      expect(result.capturedPages).toEqual(['page.tsx']);
      expect(result.skippedPages).toEqual([]);
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(outputDir, { recursive: true, force: true });
    }
  }, 60000);
});
