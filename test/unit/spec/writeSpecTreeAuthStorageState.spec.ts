import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EvidenceBundle } from '../../../src/ingest/evidenceSchema.js';

// Same rationale as writeSpecTreePageOnly.spec.ts: a real auth-gated capture
// would need a genuinely running `next dev` + Chromium instance (covered by
// generatePageTests.spec.ts's real-browser tests and the manual smoke test),
// so this file mocks generatePageTests.ts's capture phase to isolate the
// assertion to writeSpecTree.ts's own fixture-copy/.gitignore wiring. A
// single hoisted vi.fn() mock, overridden per test via mockResolvedValueOnce,
// so each test controls its own captured-pages shape without needing
// vi.resetModules()/dynamic re-import.
const mockedGeneratePageTests = vi.fn();
vi.mock('../../../src/spec/generatePageTests.js', () => ({
  generatePageTests: mockedGeneratePageTests,
  AUTH_STORAGE_STATE_FIXTURE_RELATIVE_PATH: 'fixtures/auth-storage-state.json'
}));

const { writeSpecTree } = await import('../../../src/spec/writeSpecTree.js');

function pageResultWith(capturedPages: string[]) {
  return {
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
    capturedPages,
    skippedPages: capturedPages.length > 0 ? [] : [{ routeFile: 'page.tsx', reason: 'mocked: not captured' }],
    visionClassificationEnabled: false,
    pageVisionFallbacks: [],
    pageStylesheetAnimations: [],
    usedAuthStorageState: capturedPages.length > 0
  };
}

const now = new Date(0).toISOString();

function evidenceFor(repoDir: string): EvidenceBundle {
  return {
    repoPath: repoDir,
    generatedAt: now,
    packageJson: { name: 'app', scripts: {}, dependencies: { next: '^16.0.0' }, devDependencies: {} },
    buildConfig: [],
    routes: [{ path: '/', file: 'page.tsx', kind: 'page', startLine: 1 }],
    existingTests: [],
    signals: []
  };
}

describe('writeSpecTree — auth storage state fixture copy', () => {
  it('copies the supplied storageState into tests/fixtures and gitignores it when a page was captured', async () => {
    mockedGeneratePageTests.mockResolvedValueOnce(pageResultWith(['page.tsx']));

    const repoDir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-writetree-authstate-repo-'));
    const outputDir = join(tmpdir(), `rebuild-dossier-writetree-authstate-out-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const authStorageStatePath = join(repoDir, 'state.json');
    try {
      writeFileSync(join(repoDir, 'page.tsx'), 'export default function Home() { return null; }');
      writeFileSync(authStorageStatePath, JSON.stringify({ cookies: [{ name: 'session', value: 'abc' }], origins: [] }));

      await writeSpecTree({ repoPath: repoDir, outputDir, evidence: evidenceFor(repoDir), cases: [], authStorageStatePath });

      const copiedPath = join(outputDir, 'tests', 'fixtures', 'auth-storage-state.json');
      expect(existsSync(copiedPath)).toBe(true);
      expect(readFileSync(copiedPath, 'utf-8')).toBe(readFileSync(authStorageStatePath, 'utf-8'));

      const gitignore = readFileSync(join(outputDir, '.gitignore'), 'utf-8');
      expect(gitignore).toContain('tests/fixtures/auth-storage-state.json');
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(outputDir, { recursive: true, force: true });
    }
  }, 60000);

  it('does not copy anything when no page was captured, even if authStorageStatePath was supplied', async () => {
    mockedGeneratePageTests.mockResolvedValueOnce(pageResultWith([]));

    const repoDir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-writetree-authstate-repo-'));
    const outputDir = join(tmpdir(), `rebuild-dossier-writetree-authstate-out-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const authStorageStatePath = join(repoDir, 'state.json');
    try {
      writeFileSync(join(repoDir, 'page.tsx'), 'export default function Home() { return null; }');
      writeFileSync(authStorageStatePath, JSON.stringify({ cookies: [], origins: [] }));

      await writeSpecTree({ repoPath: repoDir, outputDir, evidence: evidenceFor(repoDir), cases: [], authStorageStatePath });

      expect(existsSync(join(outputDir, 'tests', 'fixtures', 'auth-storage-state.json'))).toBe(false);
      expect(existsSync(join(outputDir, '.gitignore'))).toBe(false);
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(outputDir, { recursive: true, force: true });
    }
  }, 60000);
});
