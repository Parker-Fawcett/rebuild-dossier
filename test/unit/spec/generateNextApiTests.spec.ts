import { describe, expect, it } from 'vitest';
import { generateNextApiTests } from '../../../src/spec/generateNextApiTests.js';
import type { EvidenceBundle } from '../../../src/ingest/evidenceSchema.js';
import type { Case } from '../../../src/reconciliation/types.js';

const now = new Date(0).toISOString();

function minimalEvidence(overrides: Partial<EvidenceBundle> = {}): EvidenceBundle {
  return {
    repoPath: 'irrelevant',
    generatedAt: now,
    packageJson: { scripts: {}, dependencies: { next: '^14.2.35' }, devDependencies: {} },
    buildConfig: [],
    routes: [],
    existingTests: [],
    signals: [],
    ...overrides
  };
}

describe('generateNextApiTests', () => {
  it('generates a smoke test for a Next.js API route, importing the handler directly (no Express app)', () => {
    const evidence = minimalEvidence({
      routes: [{ path: '/api/health', method: 'GET', file: 'src/app/api/health/route.ts', kind: 'api', startLine: 5 }]
    });

    const { visible, heldOut } = generateNextApiTests('irrelevant', evidence, []);
    const all = [...visible, ...heldOut];

    expect(all).toHaveLength(1);
    expect(all[0]?.content).toContain("import { GET } from '../../src/app/api/health/route.js'");
    expect(all[0]?.content).toContain("from 'next/server'");
    expect(all[0]?.content).toContain('/api/health');
    expect(all[0]?.content).toContain('res.status');
    expect(all[0]?.sourceFile).toBe('src/app/api/health/route.ts');
  });

  it('builds a params object for dynamic route segments', () => {
    const evidence = minimalEvidence({
      routes: [
        {
          path: '/api/cards/:id/price-history',
          method: 'GET',
          file: 'src/app/api/cards/[id]/price-history/route.ts',
          kind: 'api',
          startLine: 3
        }
      ]
    });

    const { visible, heldOut } = generateNextApiTests('irrelevant', evidence, []);
    const content = [...visible, ...heldOut][0]?.content ?? '';

    expect(content).toContain("{ params: { id: 'test-value-123' } }");
    expect(content).toContain('/api/cards/test-value-123/price-history');
  });

  it('adds a reconciliation-backed assertion when a resolved case states the expected status', () => {
    const evidence = minimalEvidence({
      routes: [{ path: '/api/users/:id', method: 'GET', file: 'src/app/api/users/[id]/route.ts', kind: 'api', startLine: 6 }]
    });
    const cases: Case[] = [
      {
        id: 'case:route:GET:/api/users/:id',
        topicKey: 'route:GET:/api/users/:id',
        signals: [
          {
            id: 's1',
            source: 'ingest',
            locator: { file: 'src/app/api/users/[id]/route.ts', startLine: 6, endLine: 6 },
            topicKey: 'route:GET:/api/users/:id',
            claim: 'returns 404 when the user does not exist',
            evidenceText: 'e',
            detectedAt: now
          }
        ],
        matchedKnownBugs: [],
        status: 'auto_resolved',
        autoResolution: { decision: 'intentional', reason: 'r' }
      }
    ];

    const { visible, heldOut } = generateNextApiTests('irrelevant', evidence, cases);
    const content = [...visible, ...heldOut].map((f) => f.content).join('\n');

    expect(content).toContain('404');
    expect(content).toContain('from-reconciliation');
  });

  it('splits generated files deterministically between visible and held-out', () => {
    const evidence = minimalEvidence({
      routes: [
        { path: '/api/a', method: 'GET', file: 'src/app/api/a/route.ts', kind: 'api', startLine: 1 },
        { path: '/api/b', method: 'GET', file: 'src/app/api/b/route.ts', kind: 'api', startLine: 1 },
        { path: '/api/c', method: 'GET', file: 'src/app/api/c/route.ts', kind: 'api', startLine: 1 }
      ]
    });

    const first = generateNextApiTests('irrelevant', evidence, []);
    const second = generateNextApiTests('irrelevant', evidence, []);

    expect(first.heldOut.length).toBeGreaterThan(0);
    expect(first.visible.length).toBeGreaterThan(0);
    expect(second.heldOut.map((f) => f.filename)).toEqual(first.heldOut.map((f) => f.filename));
  });

  it('returns nothing when next is not a dependency', () => {
    const evidence = minimalEvidence({
      packageJson: { scripts: {}, dependencies: {}, devDependencies: {} },
      routes: [{ path: '/api/health', method: 'GET', file: 'src/app/api/health/route.ts', kind: 'api', startLine: 5 }]
    });
    const { visible, heldOut } = generateNextApiTests('irrelevant', evidence, []);
    expect(visible).toEqual([]);
    expect(heldOut).toEqual([]);
  });

  it('returns nothing for page routes or non-route.* api-kind files', () => {
    const evidence = minimalEvidence({
      routes: [{ path: '/', file: 'src/app/page.tsx', kind: 'page', startLine: 1 }]
    });
    const { visible, heldOut } = generateNextApiTests('irrelevant', evidence, []);
    expect(visible).toEqual([]);
    expect(heldOut).toEqual([]);
  });

  it('returns nothing when there are no api routes at all', () => {
    const evidence = minimalEvidence({ routes: [] });
    const { visible, heldOut } = generateNextApiTests('irrelevant', evidence, []);
    expect(visible).toEqual([]);
    expect(heldOut).toEqual([]);
  });

  it('sends a JSON body for POST/PUT/PATCH so a handler calling request.json() does not crash on missing input', () => {
    const evidence = minimalEvidence({
      routes: [
        { path: '/api/notes', method: 'POST', file: 'src/app/api/notes/route.ts', kind: 'api', startLine: 1 },
        { path: '/api/notes/:id', method: 'PUT', file: 'src/app/api/notes/[id]/route.ts', kind: 'api', startLine: 1 },
        { path: '/api/notes/:id', method: 'PATCH', file: 'src/app/api/notes/[id]/route.ts', kind: 'api', startLine: 1 }
      ]
    });

    const { visible, heldOut } = generateNextApiTests('irrelevant', evidence, []);
    for (const file of [...visible, ...heldOut]) {
      expect(file.content).toContain("body: JSON.stringify({})");
      expect(file.content).toContain("'Content-Type': 'application/json'");
    }
  });

  it('does not send a body for GET/DELETE', () => {
    const evidence = minimalEvidence({
      routes: [
        { path: '/api/notes', method: 'GET', file: 'src/app/api/notes/route.ts', kind: 'api', startLine: 1 },
        { path: '/api/notes/:id', method: 'DELETE', file: 'src/app/api/notes/[id]/route.ts', kind: 'api', startLine: 1 }
      ]
    });

    const { visible, heldOut } = generateNextApiTests('irrelevant', evidence, []);
    for (const file of [...visible, ...heldOut]) {
      expect(file.content).not.toContain('body:');
      expect(file.content).not.toContain('Content-Type');
    }
  });
});
