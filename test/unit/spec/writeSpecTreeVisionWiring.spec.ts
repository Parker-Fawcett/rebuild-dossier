import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EvidenceBundle } from '../../../src/ingest/evidenceSchema.js';

// Proves that writeSpecTree.ts correctly threads generatePageTests.ts's
// visionClassificationEnabled/pageVisionFallbacks fields through to its own
// result, without needing a real browser, a real next dev boot, or a real
// Groq API key — the actual vision-classification logic (request building,
// response parsing, retry/fallback behavior) is covered directly in
// visionClassifier.spec.ts, and applyVisionClassification's merge logic is
// covered directly in generatePageTests.spec.ts. This file is only about the
// wiring between them, same precedent as writeSpecTreePageOnly.spec.ts.
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
    skippedPages: [],
    visionClassificationEnabled: true,
    pageVisionFallbacks: [{ routeFile: 'other-page.tsx', reason: 'vision classification unavailable or returned an invalid response; used the regex classifier for this page' }]
  })
}));

const { writeSpecTree } = await import('../../../src/spec/writeSpecTree.js');

const now = new Date(0).toISOString();

describe('writeSpecTree — vision-classification fields propagate end to end', () => {
  it('threads visionClassificationEnabled and pageVisionFallbacks through from generatePageTests', async () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-writetree-visionwiring-repo-'));
    const outputDir = join(tmpdir(), `rebuild-dossier-writetree-visionwiring-out-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

      expect(result.visionClassificationEnabled).toBe(true);
      expect(result.pageVisionFallbacks).toEqual([
        { routeFile: 'other-page.tsx', reason: 'vision classification unavailable or returned an invalid response; used the regex classifier for this page' }
      ]);
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(outputDir, { recursive: true, force: true });
    }
  }, 60000);
});
