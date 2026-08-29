import { describe, expect, it } from 'vitest';
import { chromium } from 'playwright';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import {
  generatePageTests,
  buildPageTestContent,
  applyVisionClassification,
  hasRealTransition,
  triggerConditionFor,
  waitForRedirectsToSettle,
  waitForDomTextStability,
  resolveAuthStorageState,
  AUTH_STORAGE_STATE_FIXTURE_RELATIVE_PATH
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

// Uses a real Playwright browser (page.route()-mocked responses, no next dev
// or real HTTP server needed), same rationale as waitForRedirectsToSettle's
// own describe block above: this is normal Node-side code, never serialized
// into an isolated browser realm, so it's fully testable here. Regression
// coverage for the two real, previously-confirmed shapes this replaces a
// fixed wait for (see DOM_STABILITY_* in generatePageTests.ts):
// driftlight's requestAnimationFrame counter (which a fixed 1500ms wait
// truncated mid-count) and a genuinely infinite JS-driven text mutation
// (which any fixed wait would either truncate or never need to bound).
describe('waitForDomTextStability (real browser)', () => {
  it('settles quickly on a page with no motion at all', async () => {
    const browser = await chromium.launch();
    try {
      const page = await (await browser.newContext()).newPage();
      await page.route('**/static-page', (route) =>
        route.fulfill({ contentType: 'text/html', body: '<html><body><div>nothing moves here</div></body></html>' })
      );
      await page.goto('http://example.test/static-page', { waitUntil: 'load' });
      const start = Date.now();
      await waitForDomTextStability(page);
      const elapsedMs = Date.now() - start;
      // Well under the 8s max-wait fallback — a static page shouldn't pay
      // anything close to that just to confirm nothing is changing.
      expect(elapsedMs).toBeLessThan(3000);
      expect(await page.textContent('body')).toContain('nothing moves here');
    } finally {
      await browser.close();
    }
  }, 15000);

  it('captures the true settled value of a driftlight-shaped requestAnimationFrame counter, not a mid-count reading', async () => {
    // Mirrors the real, live-triggered finding this whole mechanism exists
    // to fix: driftlight's own counter runs from 0 to 12,400 over ~1.4s
    // (confirmed against the actual finding, not a differently-remembered
    // duration) — a fixed 1500ms wait had almost no margin against that
    // real number and a longer-running counter would blow through it
    // outright. Polling has no such ceiling: it simply waits for the text to
    // stop changing.
    const browser = await chromium.launch();
    try {
      const page = await (await browser.newContext()).newPage();
      await page.route('**/driftlight-counter', (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: `<html><body><div id="counter">0</div><script>
            const el = document.getElementById('counter');
            const start = performance.now();
            const durationMs = 1400;
            const target = 12400;
            function tick(now) {
              const t = Math.min((now - start) / durationMs, 1);
              el.textContent = Math.floor(t * target).toLocaleString() + '+';
              if (t < 1) requestAnimationFrame(tick);
            }
            requestAnimationFrame(tick);
          </script></body></html>`
        })
      );
      await page.goto('http://example.test/driftlight-counter', { waitUntil: 'load' });
      await waitForDomTextStability(page);
      expect(await page.textContent('body')).toContain('12,400+');
    } finally {
      await browser.close();
    }
  }, 15000);

  it('does not wait out an infinite CSS-only animation — DOM text with no motion settles immediately regardless', async () => {
    // The existing CSS glow-pulse case (see injectAnimationNeutralizingOverride
    // in generatePageTests.ts) never touches document text, so it can never
    // exercise this function's max-wait fallback no matter how long the
    // keyframe animation itself runs (here: forever, animation-iteration-count:
    // infinite, deliberately NOT neutralized in this test, unlike real capture
    // which applies that override separately) — this is the explicit
    // distinction the max-wait fallback below exists to NOT be needed for.
    const browser = await chromium.launch();
    try {
      const page = await (await browser.newContext()).newPage();
      await page.route('**/glow-pulse-page', (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: `<html><head><style>
            @keyframes glow-pulse { 0% { box-shadow: 0 0 2px #e8a548; } 50% { box-shadow: 0 0 20px #e8a548; } 100% { box-shadow: 0 0 2px #e8a548; } }
            .cta { animation: glow-pulse 2s infinite; }
          </style></head><body><button class="cta">Get started</button></body></html>`
        })
      );
      await page.goto('http://example.test/glow-pulse-page', { waitUntil: 'load' });
      const start = Date.now();
      await waitForDomTextStability(page);
      const elapsedMs = Date.now() - start;
      // The keyframe animation never ends, but text never changes — must
      // resolve on ordinary stable-text timing, not the 8s max-wait fallback.
      expect(elapsedMs).toBeLessThan(3000);
      expect(await page.textContent('body')).toContain('Get started');
    } finally {
      await browser.close();
    }
  }, 15000);

  it('falls through the max-wait fallback, rather than hanging, for genuinely infinite JS-driven text mutation', async () => {
    // The one shape that legitimately needs the safety net: text that is
    // never going to stop changing, by design (unlike driftlight's counter,
    // which settles). Proves this resolves — capture proceeds anyway — and
    // does so at roughly the bounded max-wait cost, not indefinitely.
    const browser = await chromium.launch();
    try {
      const page = await (await browser.newContext()).newPage();
      await page.route('**/never-settles', (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: `<html><body><div id="clock"></div><script>
            const el = document.getElementById('clock');
            setInterval(() => { el.textContent = String(performance.now()); }, 100);
          </script></body></html>`
        })
      );
      await page.goto('http://example.test/never-settles', { waitUntil: 'load' });
      const start = Date.now();
      await waitForDomTextStability(page);
      const elapsedMs = Date.now() - start;
      // Bounded near the fallback's own budget (~8s), not the unbounded time
      // an infinitely-changing page would otherwise force a naive "wait
      // until stable" loop to spend.
      expect(elapsedMs).toBeGreaterThan(6000);
      expect(elapsedMs).toBeLessThan(11000);
    } finally {
      await browser.close();
    }
  }, 20000);
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
      pageStylesheetAnimations: [],
      usedAuthStorageState: false
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

  it('uses a plain, unauthenticated context by default (usedAuthStorageState omitted)', () => {
    const content = buildPageTestContent(route, capture());
    expect(content).toContain('await browser.newContext();');
    expect(content).not.toContain('storageState');
  });

  it('loads the copied auth storageState fixture when usedAuthStorageState is true', () => {
    const content = buildPageTestContent(route, capture(), true);
    expect(content).toContain('storageState:');
    expect(content).toContain("'..', \"fixtures/auth-storage-state.json\"");
    // Must reference the SAME relative fixture path writeSpecTree.ts copies
    // the caller's file to and runMutationCheck.ts's scratch-copy mirrors —
    // see AUTH_STORAGE_STATE_FIXTURE_RELATIVE_PATH's own doc comment.
    expect(content).toContain(AUTH_STORAGE_STATE_FIXTURE_RELATIVE_PATH);
    // Real, traced-before-shipping requirement (see resolveAuthStorageState's
    // doc comment): the fixture's own baked-in origin can never match this
    // generated test's own fresh, randomly-chosen dev-server port, so the
    // generated test must remap origins[] to its own baseUrl at run time
    // rather than loading the fixture verbatim by path.
    expect(content).toContain("import { readFileSync } from 'node:fs';");
    expect(content).toContain('JSON.parse(readFileSync(');
    expect(content).toContain('origin: baseUrl');
  });

  it('does not load storageState when usedAuthStorageState is explicitly false', () => {
    const content = buildPageTestContent(route, capture(), false);
    expect(content).toContain('await browser.newContext();');
    expect(content).not.toContain('storageState');
  });
});

describe('resolveAuthStorageState', () => {
  it('remaps every origins[] entry to this run\'s own baseUrl, regardless of what origin the file was captured against', () => {
    const dir = mkdtempSync(pathJoin(tmpdir(), 'rebuild-dossier-authstate-'));
    try {
      const filePath = pathJoin(dir, 'state.json');
      writeFileSync(
        filePath,
        JSON.stringify({
          cookies: [{ name: 'session', value: 'abc', domain: 'localhost', path: '/' }],
          origins: [{ origin: 'http://localhost:54321', localStorage: [{ name: 'token', value: 'jwt-123' }] }]
        })
      );

      const result = resolveAuthStorageState(filePath, 'http://localhost:9999');

      expect(result.origins).toEqual([
        { origin: 'http://localhost:9999', localStorage: [{ name: 'token', value: 'jwt-123' }] }
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('leaves cookies untouched — cookie matching is host-scoped, not port-scoped, so no remap is needed', () => {
    const dir = mkdtempSync(pathJoin(tmpdir(), 'rebuild-dossier-authstate-'));
    try {
      const filePath = pathJoin(dir, 'state.json');
      const cookies = [{ name: 'session', value: 'abc', domain: 'localhost', path: '/' }];
      writeFileSync(filePath, JSON.stringify({ cookies, origins: [] }));

      const result = resolveAuthStorageState(filePath, 'http://localhost:9999');

      expect(result.cookies).toEqual(cookies);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('handles a file with no origins array at all', () => {
    const dir = mkdtempSync(pathJoin(tmpdir(), 'rebuild-dossier-authstate-'));
    try {
      const filePath = pathJoin(dir, 'state.json');
      writeFileSync(filePath, JSON.stringify({ cookies: [] }));

      const result = resolveAuthStorageState(filePath, 'http://localhost:9999');

      expect(result.origins).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
