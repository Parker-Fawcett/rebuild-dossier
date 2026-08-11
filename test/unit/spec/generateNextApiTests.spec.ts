import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

  it('adds a from-source success-status assertion for a body-carrying route with no dynamic path segment', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-nextapi-'));
    try {
      mkdirSync(join(dir, 'src/app/api/notes'), { recursive: true });
      writeFileSync(
        join(dir, 'src/app/api/notes/route.ts'),
        [
          'export async function POST(request) {',
          '  const { name } = await request.json();',
          '  if (!name) {',
          "    return NextResponse.json({ error: 'name required' }, { status: 400 });",
          '  }',
          '  return NextResponse.json({ id: 1, name }, { status: 201 });',
          '}'
        ].join('\n')
      );
      const evidence = minimalEvidence({
        routes: [{ path: '/api/notes', method: 'POST', file: 'src/app/api/notes/route.ts', kind: 'api', startLine: 1 }]
      });

      const { visible, heldOut } = generateNextApiTests(dir, evidence, []);
      const content = [...visible, ...heldOut][0]?.content ?? '';

      expect(content).toContain('returns 201 on success (from-source)');
      expect(content).toContain('expect(res.status).toBe(201)');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not add a from-source success-status assertion for a route with a dynamic path segment (lookup-gated, not trustworthy)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-nextapi-'));
    try {
      mkdirSync(join(dir, 'src/app/api/users/[id]'), { recursive: true });
      writeFileSync(
        join(dir, 'src/app/api/users/[id]/route.ts'),
        [
          'export async function GET(request, { params }) {',
          '  const user = findUser(params.id);',
          '  if (!user) {',
          "    return NextResponse.json({ error: 'not found' }, { status: 404 });",
          '  }',
          '  return NextResponse.json(user, { status: 200 });',
          '}'
        ].join('\n')
      );
      const evidence = minimalEvidence({
        routes: [{ path: '/api/users/:id', method: 'GET', file: 'src/app/api/users/[id]/route.ts', kind: 'api', startLine: 1 }]
      });

      const { visible, heldOut } = generateNextApiTests(dir, evidence, []);
      const content = [...visible, ...heldOut][0]?.content ?? '';

      expect(content).not.toContain('from-source');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('prefers the reconciliation-backed assertion over a from-source success status when both would apply', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-nextapi-'));
    try {
      mkdirSync(join(dir, 'src/app/api/notes'), { recursive: true });
      writeFileSync(
        join(dir, 'src/app/api/notes/route.ts'),
        ['export async function POST(request) {', '  return NextResponse.json({ id: 1 }, { status: 201 });', '}'].join('\n')
      );
      const evidence = minimalEvidence({
        routes: [{ path: '/api/notes', method: 'POST', file: 'src/app/api/notes/route.ts', kind: 'api', startLine: 1 }]
      });
      const cases: Case[] = [
        {
          id: 'case:route:POST:/api/notes',
          topicKey: 'route:POST:/api/notes',
          signals: [
            {
              id: 's1',
              source: 'ingest',
              locator: { file: 'src/app/api/notes/route.ts', startLine: 1, endLine: 1 },
              topicKey: 'route:POST:/api/notes',
              claim: 'returns 201 on create',
              evidenceText: 'e',
              detectedAt: now
            }
          ],
          matchedKnownBugs: [],
          status: 'auto_resolved',
          autoResolution: { decision: 'intentional', reason: 'r' }
        }
      ];

      const { visible, heldOut } = generateNextApiTests(dir, evidence, cases);
      const content = [...visible, ...heldOut][0]?.content ?? '';

      expect(content).toContain('from-reconciliation');
      expect(content).not.toContain('from-source');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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

  it('uses inferred field names to build a realistic placeholder body when the real source is readable', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-nextapi-'));
    try {
      mkdirSync(join(dir, 'src/app/api/notes'), { recursive: true });
      writeFileSync(
        join(dir, 'src/app/api/notes/route.ts'),
        [
          "export async function POST(request) {",
          '  const { message } = await request.json();',
          '  return NextResponse.json({ message });',
          '}'
        ].join('\n')
      );
      const evidence = minimalEvidence({
        routes: [{ path: '/api/notes', method: 'POST', file: 'src/app/api/notes/route.ts', kind: 'api', startLine: 1 }]
      });

      const { visible, heldOut } = generateNextApiTests(dir, evidence, []);
      const content = [...visible, ...heldOut][0]?.content ?? '';

      expect(content).toContain("body: JSON.stringify({ message: 'test-value-123' })");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not send a body for GET', () => {
    const evidence = minimalEvidence({
      routes: [{ path: '/api/notes', method: 'GET', file: 'src/app/api/notes/route.ts', kind: 'api', startLine: 1 }]
    });

    const { visible, heldOut } = generateNextApiTests('irrelevant', evidence, []);
    for (const file of [...visible, ...heldOut]) {
      expect(file.content).not.toContain('body:');
      expect(file.content).not.toContain('Content-Type');
    }
  });

  it('sends an empty JSON body for DELETE, so a handler reading the request body does not crash (real, live-triggered bug against a genuinely third-party app)', () => {
    // export const DELETE = async (req) => { const { id } = await req.json(); ... } —
    // a real, valid pattern (reading a lookup key from the body rather than the
    // URL) this generator previously had no way to know about, crashing its own
    // generated smoke test with `SyntaxError: Unexpected end of JSON input`
    // against a correctly-implemented handler, not just against a rebuild of one.
    const evidence = minimalEvidence({
      routes: [{ path: '/api/notes', method: 'DELETE', file: 'src/app/api/notes/route.ts', kind: 'api', startLine: 1 }]
    });

    const { visible, heldOut } = generateNextApiTests('irrelevant', evidence, []);
    for (const file of [...visible, ...heldOut]) {
      expect(file.content).toContain("body: JSON.stringify({})");
      expect(file.content).toContain("'Content-Type': 'application/json'");
    }
  });
});
