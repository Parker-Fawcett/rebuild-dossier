import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { chromium, type Browser } from 'playwright';
import type { EvidenceBundle, RouteEntry } from '../ingest/evidenceSchema.js';
import type { Case } from '../reconciliation/types.js';
import type { GeneratedTestFile } from './generateTests.js';
import type { DomTextNode, DynamicShape, PageCapture } from './pageCaptureSchema.js';
import type { AssetManifestEntry } from './assetManifestSchema.js';
import { classifyDomText } from './classifyDomText.js';
import { concretePath, sanitizeFilenameBase } from './routeTestAssertions.js';
import { devServerBoilerplate } from './nextDevServerBoilerplate.js';

// Complements generateGateTests.ts/generateTests.ts for page/component routes
// with real Playwright-driven capture (see the plan this module implements:
// "Real page-test generation for rebuild-dossier"). Unlike those generators,
// this one has a real, async I/O phase (spinning up `next dev` + a real
// Chromium instance once per `generate_spec` call) before it can produce any
// test content — everything below the CAPTURE PHASE marker is pure/sync and
// unit-testable directly; everything above it needs a real target app and is
// only exercised by the manual smoke test (see the plan's Verification
// section), matching the existing precedent in writeSpecTree.spec.ts of not
// asserting on real mutation-check execution in unit tests.
//
// MUTATION-KILL CAVEAT (Decision A in the plan): tsMorphEngine's mutators are
// generic (comparison/boolean/arithmetic flips, etc.) with no concept of
// "this site affects rendered output." For a page component that's mostly
// JSX with little branching, the capped mutation sites below (see
// MAX_MUTATION_SITES_PER_PAGE) could land anywhere in the file, including
// logic with no connection to the text a generated test actually asserts on.
// A "killed" mutation for a page test therefore only demonstrates "the test
// fails when the underlying source file changes" — NOT "the test's
// assertions specifically caught the change," which is the stronger
// guarantee API-route mutation testing gets. This is an accepted, documented
// limitation, not a bug; the smoke test manually traces at least one real
// kill to spot-check it was content-driven rather than incidental.
//
// DEV-SERVER REUSE ACROSS MUTANTS (deferred follow-up, not attempted here):
// runMutationCheck spawns one fresh scratch copy (and, for a page test, one
// fresh `next dev` boot) per mutation site. Reusing a single dev server
// across mutants via HMR would cut that cost, but risks stale-HMR false
// negatives that would undermine the mutation-testing trust model this
// tool's whole value rests on — deliberately out of scope for this pass.

const HELD_OUT_EVERY = 3; // same deterministic split convention as generateTests.ts/generateNextApiTests.ts
const MAX_MUTATION_SITES_PER_PAGE = 3; // bounds runMutationCheck's per-site `next dev` boot cost (see runMutationCheck.ts)
const MAX_DOM_TEXT_NODES = 60; // keeps a generated test (and the capture itself) from ballooning on a very text-heavy page
const DEV_SERVER_READY_TIMEOUT_MS = 60_000;

export interface SkippedPage {
  routeFile: string;
  reason: string;
}

export interface CapturedScreenshot {
  path: string; // relative to the rebuild output dir, e.g. spec/assets/screenshots/PAGE-root.png
  buffer: Buffer;
}

export interface GeneratePageTestsResult {
  visible: GeneratedTestFile[];
  heldOut: GeneratedTestFile[];
  assetManifest: AssetManifestEntry[];
  screenshots: CapturedScreenshot[];
  capturedPages: string[]; // route files successfully captured
  skippedPages: SkippedPage[]; // route files visibly skipped, with why — never silently absent
}

const EMPTY_RESULT: GeneratePageTestsResult = {
  visible: [],
  heldOut: [],
  assetManifest: [],
  screenshots: [],
  capturedPages: [],
  skippedPages: []
};

async function waitForReady(baseUrl: string, deadline: number): Promise<void> {
  while (Date.now() < deadline) {
    try {
      const res = await fetch(baseUrl);
      if (res.status < 500) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('next dev did not become ready in time');
}

// Executed inside the page via page.evaluate — must be self-contained (no
// closures over this module's scope). Deliberately NOT
// page.accessibility.snapshot(): the a11y tree restructures around ARIA
// semantics and can drop or merge text that doesn't map cleanly to a role.
// This feature needs the literal rendered content (DOM/content assertions
// are the enforced gate — see the plan's Decisions), matching
// generateContracts.ts's own "verbatim from source, never a paraphrase"
// philosophy.
function extractDomOutline(): { selectorHint: string; text: string }[] {
  const results: { selectorHint: string; text: string }[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const parent = node.parentElement;
    if (!parent) continue;
    const tag = parent.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style') continue;
    const text = (node.textContent ?? '').trim().replace(/\s+/g, ' ');
    if (text.length === 0) continue;
    const selectorHint = parent.id ? `#${parent.id}` : parent.className ? `${tag}.${String(parent.className).split(/\s+/)[0]}` : tag;
    results.push({ selectorHint, text });
  }
  return results;
}

interface CapturedPage {
  capture: PageCapture;
  screenshotBuffer: Buffer;
}

// The real Playwright call — left to the manual smoke test (no real browser
// in unit tests), matching the documented precedent in writeSpecTree.spec.ts.
async function capturePage(browser: Browser, baseUrl: string, route: RouteEntry): Promise<CapturedPage> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  try {
    await page.goto(`${baseUrl}${concretePath(route.path)}`, { waitUntil: 'load', timeout: 30000 });
    const rawOutline = await page.evaluate(extractDomOutline);
    const domOutline: DomTextNode[] = rawOutline.slice(0, MAX_DOM_TEXT_NODES).map((node) => ({
      selectorHint: node.selectorHint,
      text: node.text,
      ...classifyDomText(node.text)
    }));
    const screenshotBuffer = await page.screenshot({ fullPage: true });
    const capture: PageCapture = {
      routeFile: route.file,
      path: route.path,
      capturedAt: new Date().toISOString(),
      consoleErrors,
      domOutline
    };
    return { capture, screenshotBuffer };
  } finally {
    await context.close();
  }
}

// Unanchored counterparts of classifyDomText's shape patterns — those are
// anchored (^...$) because they classify one isolated, already-trimmed text
// node; here the same shape needs to match somewhere inside a full
// page.textContent('body') string, so the anchors are deliberately dropped.
const DYNAMIC_SHAPE_BODY_PATTERNS: Record<DynamicShape, string> = {
  uuid: '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i',
  'iso-date': '/\\d{4}-\\d{2}-\\d{2}/',
  currency: '/[$€£¥]\\s?\\d{1,3}(,\\d{3})*(\\.\\d{1,2})?|\\d{1,3}(,\\d{3})*(\\.\\d{1,2})?\\s?(USD|EUR|GBP|usd|eur|gbp)/',
  'relative-time': '/(just now|today|yesterday|\\d+\\s?(second|minute|hour|day|week|month|year)s?\\s+ago)/i',
  number: '/-?\\d+(\\.\\d+)?%?/'
};

function assertionFor(node: DomTextNode): string {
  if (node.kind === 'static') {
    return `    expect(body).toContain(${JSON.stringify(node.text)});`;
  }
  const pattern = DYNAMIC_SHAPE_BODY_PATTERNS[node.dynamicShape!];
  return `    expect(body).toMatch(${pattern}); // dynamic (${node.dynamicShape}), was: ${JSON.stringify(node.text)}`;
}

// ============================= CAPTURE PHASE =============================
// Everything below this line is pure/sync, given a PageCapture — fully
// unit-testable without a real browser.

export function buildPageTestContent(route: RouteEntry, capture: PageCapture): string {
  const concrete = concretePath(route.path);
  const assertions = capture.domOutline.map((node) => assertionFor(node)).join('\n');

  return `import { describe, it, expect, beforeAll, afterAll } from 'vitest';
${devServerBoilerplate()}
describe(${JSON.stringify(`page: ${route.path} (from-reconciliation)`)}, () => {
  it('loads without crashing and renders its captured content (from-reconciliation)', async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    await page.goto(\`\${baseUrl}${concrete}\`, { waitUntil: 'load' });
    // Tolerates the same console-error count the original capture already
    // had (some apps legitimately log a handful) but fails on NEW ones —
    // a strict-equality check here would flake on timing-sensitive warnings
    // that aren't the content regression this test exists to catch.
    expect(consoleErrors.length).toBeLessThanOrEqual(${capture.consoleErrors.length});
    const body = await page.textContent('body');
${assertions || '    expect(body).toEqual(body); // no DOM text nodes were captured for this page'}
    await context.close();
  }, 30000);
});
`;
}

export async function generatePageTests(
  repoPath: string,
  evidence: EvidenceBundle,
  _cases: Case[]
): Promise<GeneratePageTestsResult> {
  const isNext = Object.hasOwn(evidence.packageJson.dependencies, 'next');
  if (!isNext) return EMPTY_RESULT;

  const pageRoutes = evidence.routes.filter((r) => r.kind === 'page');
  if (pageRoutes.length === 0) return EMPTY_RESULT;

  let devServer: ChildProcess | undefined;
  let browser: Browser | undefined;
  const capturedPages: string[] = [];
  const skippedPages: SkippedPage[] = [];
  const captures: { route: RouteEntry; result: CapturedPage }[] = [];

  try {
    const require = createRequire(import.meta.url);
    // Resolved relative to the TARGET repo, not rebuild-dossier's own
    // node_modules — this tool has no dependency on `next` itself; the
    // target app does.
    const nextBin = require.resolve('next/dist/bin/next', { paths: [repoPath] });
    const port = 10000 + Math.floor(Math.random() * 40000);
    // "localhost", not "127.0.0.1" — see nextDevServerBoilerplate.ts's
    // identical note: Next's dev server only trusts "localhost" as a
    // default dev origin.
    const baseUrl = `http://localhost:${port}`;
    // detached: true (POSIX) so this is its own process group — see the
    // identical fix and comment in nextDevServerBoilerplate.ts. Real,
    // live-triggered finding here too: without it, next dev's own
    // worker/compiler children survive the `finally` block's kill of just
    // this pid and are left running indefinitely, each holding real RAM
    // and a real port, until something else notices and kills them by hand.
    devServer = spawn(process.execPath, [nextBin, 'dev', '-p', String(port)], {
      cwd: repoPath,
      stdio: 'ignore',
      detached: process.platform !== 'win32'
    });
    await waitForReady(baseUrl, Date.now() + DEV_SERVER_READY_TIMEOUT_MS);
    browser = await chromium.launch({ headless: true });

    for (const route of pageRoutes) {
      try {
        const result = await capturePage(browser, baseUrl, route);
        captures.push({ route, result });
        capturedPages.push(route.file);
      } catch (err) {
        // One page's capture failing (a client-only crash, a route that
        // needs auth, whatever) must not abort the whole generate_spec
        // call — but it must be visibly skipped, not silently absent (see
        // the plan's skipped-page visibility requirement).
        skippedPages.push({ routeFile: route.file, reason: err instanceof Error ? err.message : String(err) });
      }
    }
  } catch (err) {
    // The whole capture phase failed (e.g. `next dev` never became ready).
    // Every page not already captured is visibly skipped with the same
    // reason, rather than the caller seeing an empty result indistinguishable
    // from "this app just has no pages."
    const reason = err instanceof Error ? err.message : String(err);
    for (const route of pageRoutes) {
      if (!capturedPages.includes(route.file)) {
        skippedPages.push({ routeFile: route.file, reason });
      }
    }
  } finally {
    await browser
      ?.close()
      .catch(() => {
        // best effort — nothing more to do if the browser was already gone
      });
    if (devServer?.pid) {
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/pid', String(devServer.pid), '/t', '/f']);
      } else {
        try {
          // Negative pid targets the whole process group created by
          // detached: true above — see nextDevServerBoilerplate.ts's
          // identical fix.
          process.kill(-devServer.pid, 'SIGKILL');
        } catch {
          // already gone
        }
      }
    }
  }

  const assetManifest: AssetManifestEntry[] = [];
  const screenshots: CapturedScreenshot[] = [];
  const visible: GeneratedTestFile[] = [];
  const heldOut: GeneratedTestFile[] = [];

  captures.forEach(({ route, result }, index) => {
    const base = sanitizeFilenameBase(undefined, route.path);
    const assetId = `${base}-screenshot`;
    const screenshotPath = `spec/assets/screenshots/${base}.png`;
    const hash = createHash('sha256').update(result.screenshotBuffer).digest('hex');

    assetManifest.push({
      id: assetId,
      path: screenshotPath,
      hash,
      kind: 'screenshot',
      metadata: { routeFile: route.file, path: route.path }
    });
    screenshots.push({ path: screenshotPath, buffer: result.screenshotBuffer });

    const finalCapture: PageCapture = { ...result.capture, screenshotAssetId: assetId };

    const testFile: GeneratedTestFile = {
      filename: `${base}.page.spec.ts`,
      content: buildPageTestContent(route, finalCapture),
      sourceFile: route.file,
      coveredRouteFiles: [route.file],
      maxMutationSites: MAX_MUTATION_SITES_PER_PAGE
    };

    if (index % HELD_OUT_EVERY === HELD_OUT_EVERY - 1) {
      heldOut.push(testFile);
    } else {
      visible.push(testFile);
    }
  });

  return { visible, heldOut, assetManifest, screenshots, capturedPages, skippedPages };
}
