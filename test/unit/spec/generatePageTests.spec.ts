import { describe, expect, it } from 'vitest';
import { chromium } from 'playwright';
import {
  generatePageTests,
  buildPageTestContent,
  applyVisionClassification,
  hasRealTransition,
  triggerConditionFor,
  waitForRedirectsToSettle
} from '../../../src/spec/generatePageTests.js';
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

// Uses a real Playwright browser (page.route()-mocked responses, no next
// dev or real HTTP server needed) — a genuine navigation-timing mechanic,
// unlike the __name/page.evaluate bug this codebase already has.
// waitForRedirectsToSettle is normal Node-side code called directly, never
// serialized into an isolated browser realm, so it's fully testable here
// (traced live before picking REDIRECT_DETECTION_WINDOW_MS's value — see
// its own doc comment in generatePageTests.ts).
describe('waitForRedirectsToSettle (real browser)', () => {
  it('does not disturb a page that never redirects at all', async () => {
    const browser = await chromium.launch();
    try {
      const page = await (await browser.newContext()).newPage();
      await page.route('**/no-redirect', (route) =>
        route.fulfill({ contentType: 'text/html', body: '<html><body><div>source content only</div></body></html>' })
      );
      await page.goto('http://example.test/no-redirect', { waitUntil: 'load' });
      await waitForRedirectsToSettle(page);
      expect(page.url()).toBe('http://example.test/no-redirect');
      expect(await page.textContent('body')).toContain('source content only');
    } finally {
      await browser.close();
    }
  }, 15000);

  it('captures the real destination, not a transitional pre-redirect state, for a delayed client-side redirect', async () => {
    const browser = await chromium.launch();
    try {
      const page = await (await browser.newContext()).newPage();
      // 800ms delay simulates React hydration + a mounted useEffect firing
      // the redirect, not an instant navigation.
      await page.route('**/source-delayed', (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: `<html><body><div>transitional pre-redirect state</div><script>setTimeout(() => { window.location.href = '/destination-delayed'; }, 800);</script></body></html>`
        })
      );
      await page.route('**/destination-delayed', (route) =>
        route.fulfill({ contentType: 'text/html', body: '<html><body><div>real destination content</div></body></html>' })
      );
      await page.goto('http://example.test/source-delayed', { waitUntil: 'load' });
      await waitForRedirectsToSettle(page);
      expect(page.url()).toBe('http://example.test/destination-delayed');
      expect(await page.textContent('body')).toContain('real destination content');
    } finally {
      await browser.close();
    }
  }, 15000);

  it('waits out a delayed redirect combined with a slow destination response — the exact scenario that motivated this fix', async () => {
    const browser = await chromium.launch();
    try {
      const page = await (await browser.newContext()).newPage();
      await page.route('**/source-combo', (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: `<html><body><div>transitional combo</div><script>setTimeout(() => { window.location.href = '/destination-combo'; }, 800);</script></body></html>`
        })
      );
      await page.route('**/destination-combo', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 3000)); // simulates a cold Next-dev compile
        await route.fulfill({ contentType: 'text/html', body: '<html><body><div>destination settled after cold compile</div></body></html>' });
      });
      await page.goto('http://example.test/source-combo', { waitUntil: 'load' });
      await waitForRedirectsToSettle(page);
      expect(page.url()).toBe('http://example.test/destination-combo');
      expect(await page.textContent('body')).toContain('destination settled after cold compile');
    } finally {
      await browser.close();
    }
  }, 15000);

  it('settles on the final destination of a chained (2-hop) redirect', async () => {
    const browser = await chromium.launch();
    try {
      const page = await (await browser.newContext()).newPage();
      await page.route('**/chain-a', (route) =>
        route.fulfill({ contentType: 'text/html', body: `<html><body><script>window.location.href = '/chain-b';</script></body></html>` })
      );
      await page.route('**/chain-b', (route) =>
        route.fulfill({ contentType: 'text/html', body: `<html><body><script>window.location.href = '/chain-c';</script></body></html>` })
      );
      await page.route('**/chain-c', (route) =>
        route.fulfill({ contentType: 'text/html', body: '<html><body><div>final chained destination</div></body></html>' })
      );
      await page.goto('http://example.test/chain-a', { waitUntil: 'load' });
      await waitForRedirectsToSettle(page);
      expect(page.url()).toBe('http://example.test/chain-c');
      expect(await page.textContent('body')).toContain('final chained destination');
    } finally {
      await browser.close();
    }
  }, 15000);

  it('bounds a long redirect chain rather than following it indefinitely', async () => {
    const browser = await chromium.launch();
    try {
      const page = await (await browser.newContext()).newPage();
      // A chain of 6 distinct redirects, each delayed ~200ms — deliberately
      // more than MAX_REDIRECT_HOPS (3) — proves the function itself
      // returns rather than following the whole chain indefinitely. A
      // delay on each hop is essential here: an immediate, delay-less
      // `window.location.href` chain gets fully followed by page.goto's
      // own `waitUntil: 'load'` semantics before this function ever gets a
      // chance to observe anything (confirmed directly — an earlier draft
      // of this test with no delay landed on the final page before
      // waitForRedirectsToSettle was even called, proving nothing about
      // this function's own hop-bounding at all).
      const hopCount = 6;
      for (let i = 0; i < hopCount; i++) {
        const next = i + 1 < hopCount ? `/long-chain-${i + 1}` : null;
        await page.route(`**/long-chain-${i}`, (route) =>
          route.fulfill({
            contentType: 'text/html',
            body: next
              ? `<html><body><script>setTimeout(() => { window.location.href = '${next}'; }, 200);</script></body></html>`
              : '<html><body><div>end of chain, never reached within the hop budget</div></body></html>'
          })
        );
      }
      const start = Date.now();
      await page.goto('http://example.test/long-chain-0', { waitUntil: 'load' });
      await waitForRedirectsToSettle(page);
      const elapsedMs = Date.now() - start;
      // Bounded, not hanging: stops well short of following all 6 hops.
      expect(page.url()).not.toBe('http://example.test/long-chain-5');
      expect(elapsedMs).toBeLessThan(20000);
    } finally {
      await browser.close();
    }
  }, 25000);
});

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
      pageVisionFallbacks: [],
      pageStylesheetAnimations: []
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

describe('hasRealTransition', () => {
  it('returns false when no transition duration was ever declared (CSS default)', () => {
    expect(hasRealTransition('0s', 'opacity')).toBe(false);
  });

  it('returns false when transition-property is explicitly none, even with a duration present', () => {
    expect(hasRealTransition('300ms', 'none')).toBe(false);
  });

  it('returns false when both are at their CSS defaults', () => {
    expect(hasRealTransition('0s', 'none')).toBe(false);
  });

  it('returns true for a real, authored transition', () => {
    expect(hasRealTransition('300ms', 'opacity')).toBe(true);
  });

  it('returns false for empty-string inputs', () => {
    expect(hasRealTransition('', '')).toBe(false);
  });
});

describe('triggerConditionFor', () => {
  it('returns "unconditional" for a plain selector with no state pseudo-class', () => {
    expect(triggerConditionFor('.cta')).toBe('unconditional');
  });

  it('returns ":hover" for a hover-gated selector', () => {
    expect(triggerConditionFor('.button:hover')).toBe(':hover');
  });

  it('returns ":focus-within", not ":focus" — the regression case that caught a real alternation-ordering bug', () => {
    // A first version of the pattern listed 'focus' before 'focus-within';
    // since regex alternation tries alternatives left-to-right and takes
    // the first match, not the longest, it matched only ':focus' and left
    // '-within' as corrupted leftover text. Traced directly before shipping.
    expect(triggerConditionFor('.input:focus-within')).toBe(':focus-within');
  });

  it('returns ":focus-visible", not ":focus"', () => {
    expect(triggerConditionFor('.input:focus-visible')).toBe(':focus-visible');
  });

  it('lists multiple distinct pseudo-classes across a selector list, deduped', () => {
    expect(triggerConditionFor('a:hover, a:focus')).toBe(':hover, :focus');
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
