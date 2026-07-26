import { describe, expect, it } from 'vitest';
import { generatePageTests, buildPageTestContent, applyVisionClassification } from '../../../src/spec/generatePageTests.js';
import type { EvidenceBundle, RouteEntry } from '../../../src/ingest/evidenceSchema.js';
import type { DomTextNode, PageCapture } from '../../../src/spec/pageCaptureSchema.js';

const now = new Date(0).toISOString();

function minimalEvidence(overrides: Partial<EvidenceBundle> = {}): EvidenceBundle {
  return {
    repoPath: 'irrelevant',
    generatedAt: now,
    packageJson: { name: 'app', scripts: {}, dependencies: { next: '^16.0.0' }, devDependencies: {} },
    buildConfig: [],
    routes: [],
    existingTests: [],
    signals: [],
    ...overrides
  };
}

describe('generatePageTests preconditions', () => {
  // No real browser/next-dev involved in any of these — every case here is
  // rejected before the async capture phase would ever spawn anything, so
  // these stay fast, matching generateGateTests.spec.ts's own structure.

  it('returns an empty result when next is not a dependency', async () => {
    const evidence = minimalEvidence({
      packageJson: { scripts: {}, dependencies: {}, devDependencies: {} },
      routes: [{ path: '/', file: 'page.tsx', kind: 'page', startLine: 1 }]
    });
    const result = await generatePageTests('/irrelevant', evidence, []);
    expect(result).toEqual({
      visible: [],
      heldOut: [],
      assetManifest: [],
      screenshots: [],
      capturedPages: [],
      skippedPages: [],
      visionClassificationEnabled: false,
      pageVisionFallbacks: []
    });
  });

  it('returns an empty result when there are no kind: page routes', async () => {
    const evidence = minimalEvidence({
      routes: [{ path: '/api/health', method: 'GET', file: 'src/app/api/health/route.ts', kind: 'api', startLine: 1 }]
    });
    const result = await generatePageTests('/irrelevant', evidence, []);
    expect(result.visible).toEqual([]);
    expect(result.heldOut).toEqual([]);
    expect(result.skippedPages).toEqual([]);
  });

  it('visibly skips every page route when next dev cannot even be resolved for the target repo', async () => {
    // No node_modules/next exists for this made-up repoPath, so
    // require.resolve('next/dist/bin/next', { paths: [repoPath] }) throws —
    // the whole capture phase fails, and every page route must be reported
    // as skipped rather than the caller seeing an empty, ambiguous result.
    const evidence = minimalEvidence({
      routes: [{ path: '/', file: 'page.tsx', kind: 'page', startLine: 1 }]
    });
    const result = await generatePageTests('/definitely/does/not/exist', evidence, []);
    expect(result.visible).toEqual([]);
    expect(result.heldOut).toEqual([]);
    expect(result.capturedPages).toEqual([]);
    expect(result.skippedPages).toHaveLength(1);
    expect(result.skippedPages[0]?.routeFile).toBe('page.tsx');
    expect(result.skippedPages[0]?.reason).toBeTruthy();
  }, 15000);
});

describe('applyVisionClassification', () => {
  const domOutline: DomTextNode[] = [
    { selectorHint: 'h1', text: 'Welcome', kind: 'static' },
    { selectorHint: '.price', text: '$42.00', kind: 'dynamic', dynamicShape: 'currency' }
  ];

  it('applies a valid vision result over the regex baseline, node by node', () => {
    const visionResult = [{ kind: 'static' as const }, { kind: 'static' as const }];
    expect(applyVisionClassification(domOutline, visionResult)).toEqual([
      { selectorHint: 'h1', text: 'Welcome', kind: 'static' },
      { selectorHint: '.price', text: '$42.00', kind: 'static' }
    ]);
  });

  it('leaves domOutline untouched when the vision result is null', () => {
    expect(applyVisionClassification(domOutline, null)).toEqual(domOutline);
  });

  it('leaves domOutline untouched when the vision result length does not match', () => {
    expect(applyVisionClassification(domOutline, [{ kind: 'static' }])).toEqual(domOutline);
  });
});

describe('buildPageTestContent', () => {
  const route: RouteEntry = { path: '/users/:id', file: 'users/[id]/page.tsx', kind: 'page', startLine: 1 };

  function capture(overrides: Partial<PageCapture> = {}): PageCapture {
    return {
      routeFile: route.file,
      path: route.path,
      capturedAt: now,
      consoleErrors: [],
      domOutline: [],
      ...overrides
    };
  }

  it('substitutes dynamic route segments the same way generateTests.ts does', () => {
    const content = buildPageTestContent(route, capture());
    // "The same way generateTests.ts does" means: the raw route pattern
    // (e.g. "/users/:id") stays in the describe title as human-readable
    // documentation of which route this test covers — see
    // generateTests.spec.ts's own assertion that its content DOES contain
    // the raw "/api/users/:id" pattern — while only the actual navigation
    // call needs a concrete, resolvable path. Only the goto() call gets the
    // substituted value; asserting the raw pattern is fully absent from the
    // file would make page tests inconsistent with generateTests.ts/
    // generateGateTests.ts for no reason.
    expect(content).toContain('/users/test-value-123');
    expect(content).toContain('page: /users/:id');
  });

  it('asserts static dom text with an exact toContain check', () => {
    const content = buildPageTestContent(
      route,
      capture({ domOutline: [{ selectorHint: 'h1', text: 'Welcome back', kind: 'static' }] })
    );
    expect(content).toContain('expect(body).toContain("Welcome back")');
  });

  it('asserts dynamic dom text with a shape/pattern check, not the exact captured value', () => {
    const content = buildPageTestContent(
      route,
      capture({ domOutline: [{ selectorHint: '.price', text: '$42.00', kind: 'dynamic', dynamicShape: 'currency' }] })
    );
    expect(content).toContain('expect(body).toMatch(');
    expect(content).not.toContain('expect(body).toContain("$42.00")');
  });

  it('tolerates the same console-error count observed at capture time, not stricter', () => {
    const content = buildPageTestContent(route, capture({ consoleErrors: ['a pre-existing warning'] }));
    expect(content).toContain('expect(consoleErrors.length).toBeLessThanOrEqual(1)');
  });

  it('reuses the shared next-dev + Chromium boilerplate rather than a second copy', () => {
    const content = buildPageTestContent(route, capture());
    expect(content).toContain("from 'playwright'");
    expect(content).toContain('beforeAll');
    expect(content).toContain('afterAll');
  });
});
