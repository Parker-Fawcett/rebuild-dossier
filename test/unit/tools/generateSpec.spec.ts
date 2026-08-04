import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSpecHandler, buildVisionClassificationNote } from '../../../src/tools/generateSpec.js';
import { VISION_PAGE_PACING_DELAY_MS } from '../../../src/spec/visionClassifier.js';
import { evidencePath } from '../../../src/state/dossierPaths.js';
import { atomicWriteFile } from '../../../src/state/atomicWrite.js';
import { saveCases } from '../../../src/state/caseStore.js';
import type { EvidenceBundle } from '../../../src/ingest/evidenceSchema.js';
import type { Case } from '../../../src/reconciliation/types.js';

const now = new Date(0).toISOString();

function minimalEvidence(overrides: Partial<EvidenceBundle> = {}): EvidenceBundle {
  return {
    repoPath: 'irrelevant',
    generatedAt: now,
    packageJson: { name: 'sample-app', scripts: {}, dependencies: {}, devDependencies: {} },
    buildConfig: [],
    routes: [],
    existingTests: [],
    signals: [],
    ...overrides
  };
}

describe('generate_spec tool', () => {
  it('refuses to run while any case is still open', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-genspec-'));
    const outputDir = `${dir}-rebuild`;
    try {
      atomicWriteFile(evidencePath(dir), JSON.stringify(minimalEvidence()));
      saveCases(dir, [{ id: 'case:1', topicKey: 'x', signals: [], matchedKnownBugs: [], status: 'open' }]);

      const result = await generateSpecHandler({ repoPath: dir });

      expect(result.isError).toBe(true);
      expect(existsSync(outputDir)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('writes the sibling <repo>-rebuild directory once the queue is empty', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-genspec-'));
    const outputDir = `${dir}-rebuild`;
    try {
      atomicWriteFile(evidencePath(dir), JSON.stringify(minimalEvidence()));
      saveCases(dir, []);

      const result = await generateSpecHandler({ repoPath: dir });

      expect(result.isError).toBeUndefined();
      expect(existsSync(join(outputDir, 'CLAUDE.md'))).toBe(true);
      expect(existsSync(join(dir, 'CLAUDE.md'))).toBe(false); // never written into the original repo
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('reports an error when no evidence has been ingested yet', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-genspec-'));
    try {
      const result = await generateSpecHandler({ repoPath: dir });
      expect(result.isError).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('warns when the target repo has no node_modules of its own — mutation-check results are unreliable without it', async () => {
    // Real finding: a user ran generate_spec against a real app they had
    // never `npm install`ed. Every generated test failed to even import its
    // dependencies, so every one landed in tests/weak/ as "unrunnable" — but
    // nothing in the output said why, and it was initially misdiagnosed as
    // a Prisma/database problem. Reproduced directly: removing node_modules
    // from a real target repo and re-running generate_spec gives the exact
    // same 0 visible / 0 held-out / all-unrunnable shape.
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-genspec-'));
    const outputDir = `${dir}-rebuild`;
    try {
      mkdirSync(join(dir, 'src', 'app', 'api', 'health'), { recursive: true });
      writeFileSync(
        join(dir, 'src', 'app', 'api', 'health', 'route.ts'),
        "import { NextResponse } from 'next/server';\nexport async function GET() {\n  return NextResponse.json({ status: 'ok' });\n}\n"
      );
      const evidence = minimalEvidence({
        packageJson: { name: 'sample-app', scripts: {}, dependencies: { next: '^14.0.0' }, devDependencies: {} },
        routes: [{ path: '/api/health', method: 'GET', file: 'src/app/api/health/route.ts', kind: 'api', startLine: 2 }]
      });
      atomicWriteFile(evidencePath(dir), JSON.stringify(evidence));
      saveCases(dir, []);

      const result = await generateSpecHandler({ repoPath: dir });
      const summary = JSON.parse(result.content[0]!.text);

      expect(summary.warning).toBeDefined();
      expect(summary.warning).toContain('node_modules');
      expect(summary.warning).toContain('npm install');
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(outputDir, { recursive: true, force: true });
    }
  }, 60000);

  it('refuses to generate a spec when 0 routes were ingested and the repo looks like a monorepo root', async () => {
    // Real bug, found via a live fresh-agent handoff (OpenCode against a real
    // repo): ingest_repo was correctly re-pointed at apps/web (83 routes) after
    // the monorepo hint fired, but generate_spec was then called against the
    // monorepo ROOT path, whose own (separate) evidence.json still had 0
    // routes from the original ingest. generate_spec had no equivalent guard
    // to ingest_repo's monorepoHint, so it silently produced a syntactically
    // valid but completely empty spec (0 contracts, 0 tests) instead of
    // refusing — a fresh agent then reported "nothing to rebuild" as if that
    // were a real, correct conclusion about the app.
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-genspec-monorepo-'));
    const outputDir = `${dir}-rebuild`;
    try {
      mkdirSync(join(dir, 'apps', 'web'), { recursive: true });
      writeFileSync(join(dir, 'apps', 'web', 'package.json'), JSON.stringify({ name: '@app/web' }));
      atomicWriteFile(evidencePath(dir), JSON.stringify(minimalEvidence({ repoPath: dir })));
      saveCases(dir, []);

      const result = await generateSpecHandler({ repoPath: dir });

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('apps/web');
      expect(existsSync(outputDir)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('does not refuse for a genuinely route-less repo that is not monorepo-shaped', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-genspec-noroutes-'));
    const outputDir = `${dir}-rebuild`;
    try {
      atomicWriteFile(evidencePath(dir), JSON.stringify(minimalEvidence({ repoPath: dir })));
      saveCases(dir, []);

      const result = await generateSpecHandler({ repoPath: dir });

      expect(result.isError).toBeUndefined();
      expect(existsSync(join(outputDir, 'CLAUDE.md'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('rejects a missing authStorageStatePath instead of silently falling back to unauthenticated capture', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-genspec-'));
    try {
      atomicWriteFile(evidencePath(dir), JSON.stringify(minimalEvidence()));
      saveCases(dir, []);

      const result = await generateSpecHandler({ repoPath: dir, authStorageStatePath: join(dir, 'does-not-exist.json') });

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('does not exist');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects an authStorageStatePath that is not valid JSON', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-genspec-'));
    try {
      atomicWriteFile(evidencePath(dir), JSON.stringify(minimalEvidence()));
      saveCases(dir, []);
      const badStatePath = join(dir, 'bad-state.json');
      writeFileSync(badStatePath, 'not valid json{{{');

      const result = await generateSpecHandler({ repoPath: dir, authStorageStatePath: badStatePath });

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('not valid JSON');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('accepts a valid authStorageStatePath and proceeds normally for an app with no page routes to use it on', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-genspec-'));
    const outputDir = `${dir}-rebuild`;
    try {
      atomicWriteFile(evidencePath(dir), JSON.stringify(minimalEvidence()));
      saveCases(dir, []);
      const statePath = join(dir, 'good-state.json');
      writeFileSync(statePath, JSON.stringify({ cookies: [], origins: [] }));

      const result = await generateSpecHandler({ repoPath: dir, authStorageStatePath: statePath });

      expect(result.isError).toBeUndefined();
      expect(existsSync(join(outputDir, 'CLAUDE.md'))).toBe(true);
      // No page routes were captured (this app has none at all), so nothing
      // needed the fixture — must not copy a live session-cookie file into
      // the output tree for no reason.
      expect(existsSync(join(outputDir, 'tests', 'fixtures', 'auth-storage-state.json'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('does not warn when the target repo has its own node_modules', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-genspec-'));
    const outputDir = `${dir}-rebuild`;
    try {
      mkdirSync(join(dir, 'node_modules'), { recursive: true });
      atomicWriteFile(evidencePath(dir), JSON.stringify(minimalEvidence()));
      saveCases(dir, []);

      const result = await generateSpecHandler({ repoPath: dir });
      const summary = JSON.parse(result.content[0]!.text);

      expect(summary.warning).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(outputDir, { recursive: true, force: true });
    }
  });
});

describe('buildVisionClassificationNote', () => {
  it('estimates zero added pacing time for a single captured page (no "next page" to pace against)', () => {
    expect(buildVisionClassificationNote(1)).toContain('roughly 0s of added time');
    expect(buildVisionClassificationNote(1)).toContain('this run\'s 1 captured page(s)');
  });

  it('estimates (n - 1) pacing delays for n captured pages', () => {
    const note = buildVisionClassificationNote(19);
    const expectedSeconds = (18 * VISION_PAGE_PACING_DELAY_MS) / 1000;
    expect(note).toContain(`roughly ${expectedSeconds}s of added time`);
    expect(note).toContain('this run\'s 19 captured page(s)');
  });

  it('never estimates negative added time for zero captured pages', () => {
    expect(buildVisionClassificationNote(0)).toContain('roughly 0s of added time');
  });

  it('states plainly that page content leaves the machine', () => {
    expect(buildVisionClassificationNote(5)).toContain('Page content leaves this machine');
  });
});
