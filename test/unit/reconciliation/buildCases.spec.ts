import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCases } from '../../../src/reconciliation/buildCases.js';
import { atomicWriteFile } from '../../../src/state/atomicWrite.js';
import { evidencePath, crawlEvidencePath } from '../../../src/state/dossierPaths.js';
import { saveCases, loadCases } from '../../../src/state/caseStore.js';
import { addKnownBug } from '../../../src/state/knownBugs.js';
import type { EvidenceBundle } from '../../../src/ingest/evidenceSchema.js';
import type { CrawlEvidence } from '../../../src/crawl/crawlEvidenceSchema.js';

const now = new Date(0).toISOString();

function minimalEvidence(overrides: Partial<EvidenceBundle> = {}): EvidenceBundle {
  return {
    repoPath: 'irrelevant',
    generatedAt: now,
    packageJson: { scripts: {}, dependencies: {}, devDependencies: {} },
    buildConfig: [],
    routes: [],
    existingTests: [],
    signals: [],
    ...overrides
  };
}

function minimalCrawl(overrides: Partial<CrawlEvidence> = {}): CrawlEvidence {
  return { baseUrl: 'http://x', generatedAt: now, routesVisited: [], signals: [], ...overrides };
}

describe('buildCases', () => {
  it('groups ingest + crawl signals sharing a topicKey into one case and classifies it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-buildcases-'));
    try {
      const evidence = minimalEvidence({
        signals: [
          {
            id: 's1',
            source: 'ingest',
            locator: { path: '/api/users/:id', method: 'GET' },
            topicKey: 'route:GET:/api/users/:id',
            claim: 'returns 404 when id is missing',
            evidenceText: 'e',
            detectedAt: now
          }
        ]
      });
      const crawl = minimalCrawl({
        signals: [
          {
            id: 's2',
            source: 'crawl',
            locator: { path: '/api/users/:id', method: 'GET' },
            topicKey: 'route:GET:/api/users/:id',
            claim: 'returns 404 when id is missing',
            evidenceText: 'e',
            detectedAt: now
          }
        ]
      });
      atomicWriteFile(evidencePath(dir), JSON.stringify(evidence));
      atomicWriteFile(crawlEvidencePath(dir), JSON.stringify(crawl));

      const cases = buildCases(dir);

      expect(cases).toHaveLength(1);
      expect(cases[0]?.topicKey).toBe('route:GET:/api/users/:id');
      expect(cases[0]?.signals).toHaveLength(2);
      expect(cases[0]?.status).toBe('open'); // silent agreement, no affirmative intent
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('persists the classified cases to .dossier/cases.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-buildcases-'));
    try {
      const evidence = minimalEvidence({
        signals: [
          {
            id: 's1',
            source: 'ingest',
            locator: { path: '/x', method: 'GET' },
            topicKey: 'route:GET:/x',
            claim: 'does a thing',
            evidenceText: 'e',
            detectedAt: now
          }
        ]
      });
      atomicWriteFile(evidencePath(dir), JSON.stringify(evidence));

      buildCases(dir);

      expect(loadCases(dir)).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('preserves a resolved_by_human case across a rebuild instead of overwriting it with fresh classification', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-buildcases-'));
    try {
      const signal = {
        id: 's1',
        source: 'ingest' as const,
        locator: { path: '/x', method: 'GET' },
        topicKey: 'route:GET:/x',
        claim: 'does a thing',
        evidenceText: 'e',
        detectedAt: now
      };
      atomicWriteFile(evidencePath(dir), JSON.stringify(minimalEvidence({ signals: [signal] })));

      // First build: comes back open (silent agreement rule / single signal).
      const firstPass = buildCases(dir);
      expect(firstPass[0]?.status).toBe('open');

      // Human resolves it.
      const resolved = {
        ...firstPass[0]!,
        status: 'resolved_by_human' as const,
        humanDecision: { decision: 'intentional', decidedAt: now, via: 'resolve_case_tool' as const }
      };
      saveCases(dir, [resolved]);

      // Re-running ingestion (e.g. re-ran ingest_repo) must not discard that decision.
      const secondPass = buildCases(dir);
      expect(secondPass).toHaveLength(1);
      expect(secondPass[0]?.status).toBe('resolved_by_human');
      expect(secondPass[0]?.humanDecision?.decision).toBe('intentional');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('routes a case matching a flagged known bug straight to auto_resolved bug', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-buildcases-'));
    try {
      atomicWriteFile(
        evidencePath(dir),
        JSON.stringify(
          minimalEvidence({
            signals: [
              {
                id: 's1',
                source: 'ingest',
                locator: { path: '/api/users', method: 'GET' },
                topicKey: 'route:GET:/api/users',
                claim: 'silently drops the last page of results',
                evidenceText: 'e',
                detectedAt: now
              }
            ]
          })
        )
      );
      addKnownBug(dir, 'pagination drops the last page');

      const cases = buildCases(dir);

      expect(cases[0]?.status).toBe('auto_resolved');
      expect(cases[0]?.autoResolution?.decision).toBe('bug');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns an empty array when there is no evidence or crawl data at all', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-buildcases-'));
    try {
      expect(buildCases(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('surfaces a flagged known bug as its own case even with zero corroborating signals — a bug must never silently vanish for lack of a matching signal', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-buildcases-'));
    try {
      // No evidence.json / crawl.json at all — nothing for the bug to attach to.
      const bug = addKnownBug(dir, 'the login gate secret check runs entirely client-side and is bypassable');

      const cases = buildCases(dir);

      expect(cases).toHaveLength(1);
      expect(cases[0]?.matchedKnownBugs).toContain(bug.id);
      expect(cases[0]?.status).toBe('auto_resolved');
      expect(cases[0]?.autoResolution?.decision).toBe('bug');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Found live twice (5 flags -> 1 decision, 3 -> 1): bugs sharing route words
  // matched each other's synthetic case, and only the first description
  // reached the package.
  it('gives each flagged known bug its own case, even when their descriptions share words', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-buildcases-'));
    try {
      const put = addKnownBug(dir, 'PUT /api/v1/recipes/:id reads the data file instead of writing the update; intended: save it and return 200.');
      const del = addKnownBug(dir, 'DELETE /api/v1/recipes/:id calls res.statusCode(204) as a function and throws; intended: return 204.');
      const login = addKnownBug(dir, 'POST /api/v1/users/login issues a token even when the password is wrong; intended: reject it.');

      const cases = buildCases(dir);

      expect(cases).toHaveLength(3);
      for (const bug of [put, del, login]) {
        const own = cases.find((c) => c.topicKey === `known-bug:${bug.id}`);
        expect(own?.matchedKnownBugs).toEqual([bug.id]);
        expect(own?.signals[0]?.claim).toBe(bug.description);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not create a duplicate synthetic case for a known bug that already matches a real signal', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-buildcases-'));
    try {
      atomicWriteFile(
        evidencePath(dir),
        JSON.stringify(
          minimalEvidence({
            signals: [
              {
                id: 's1',
                source: 'ingest',
                locator: { path: '/api/users', method: 'GET' },
                topicKey: 'route:GET:/api/users',
                claim: 'silently drops the last page of results',
                evidenceText: 'e',
                detectedAt: now
              }
            ]
          })
        )
      );
      addKnownBug(dir, 'pagination drops the last page');

      const cases = buildCases(dir);

      expect(cases).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('cross-references cases whose source files are near-content-duplicates of each other', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-buildcases-'));
    try {
      const gateShape = (variant: string) =>
        `"use client";\nconst SECRET_NAME = "Madeline";\nexport function LoginGate${variant}() {\n  const handleSubmit = () => {\n    if (input.trim().toLowerCase() === SECRET_NAME.toLowerCase()) {\n      setUnlocked();\n    }\n  };\n  return <div className="flex min-h-screen items-center justify-center"><input onKeyDown={handleSubmit} /></div>;\n}\n`;

      mkdirSync(join(dir, 'src', 'components'), { recursive: true });
      writeFileSync(join(dir, 'src', 'components', 'login-gate.tsx'), gateShape(''));
      writeFileSync(join(dir, 'src', 'components', 'login-gate-variant-a.tsx'), gateShape('A'));
      writeFileSync(join(dir, 'src', 'components', 'unrelated.tsx'), 'export default function Unrelated() { return <main>Totally different content here</main>; }');

      atomicWriteFile(
        evidencePath(dir),
        JSON.stringify(
          minimalEvidence({
            signals: [
              {
                id: 's1',
                source: 'ingest',
                locator: { file: 'src/components/login-gate.tsx', startLine: 5, endLine: 5 },
                topicKey: 'smell:client-side-secret-gate:src/components/login-gate.tsx',
                claim: 'possible client-side-only credential gate',
                evidenceText: 'e',
                detectedAt: now
              },
              {
                id: 's2',
                source: 'ingest',
                locator: { file: 'src/components/login-gate-variant-a.tsx', startLine: 5, endLine: 5 },
                topicKey: 'smell:client-side-secret-gate:src/components/login-gate-variant-a.tsx',
                claim: 'possible client-side-only credential gate',
                evidenceText: 'e',
                detectedAt: now
              },
              {
                id: 's3',
                source: 'ingest',
                locator: { file: 'src/components/unrelated.tsx', startLine: 1, endLine: 1 },
                topicKey: 'smell:client-side-secret-gate:src/components/unrelated.tsx',
                claim: 'possible client-side-only credential gate',
                evidenceText: 'e',
                detectedAt: now
              }
            ]
          })
        )
      );

      const cases = buildCases(dir);
      const gateCase = cases.find((c) => c.topicKey.endsWith('login-gate.tsx'))!;
      const variantCase = cases.find((c) => c.topicKey.endsWith('login-gate-variant-a.tsx'))!;
      const unrelatedCase = cases.find((c) => c.topicKey.endsWith('unrelated.tsx'))!;

      expect(gateCase.relatedCaseIds).toEqual([variantCase.id]);
      expect(variantCase.relatedCaseIds).toEqual([gateCase.id]);
      expect(unrelatedCase.relatedCaseIds).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
