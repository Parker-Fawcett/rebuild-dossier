import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { chromium, type Browser, type Page, type BrowserContextOptions } from 'playwright';
import type { EvidenceBundle, RouteEntry } from '../ingest/evidenceSchema.js';
import type { Case } from '../reconciliation/types.js';
import type { GeneratedTestFile } from './generateTests.js';
import type { DomTextNode, DynamicShape, KeyframeUsage, PageCapture, TransitionUsage } from './pageCaptureSchema.js';
import type { AssetManifestEntry } from './assetManifestSchema.js';
import { classifyDomText } from './classifyDomText.js';
import { concretePath, sanitizeFilenameBase } from './routeTestAssertions.js';
import { devServerBoilerplate } from './nextDevServerBoilerplate.js';
import { resolveLocalApiUrlOverrides } from './resolveLocalApiUrlOverrides.js';
import { classifyPageWithVision, DEFAULT_GROQ_VISION_MODEL, VISION_PAGE_PACING_DELAY_MS } from './visionClassifier.js';

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
// Replaces a former flat ANIMATION_SETTLE_WAIT_MS = 1500ms wait (see git
// history) with a real capture-readiness signal: poll document.body.innerText
// at short intervals and only proceed once it's stayed byte-identical across
// several consecutive polls, instead of guessing a fixed clock long enough
// for JS-driven motion — a requestAnimationFrame counter, a setTimeout-staged
// reveal — to settle before either the DOM-text or screenshot capture reads
// the page. Real, live-triggered finding this whole mechanism exists to fix:
// a single generate_spec call's DOM-text capture and screenshot capture
// disagreed with each other on an animated counter's value ("0" vs "104+",
// neither the true settled "12,400+") because they were captured sequentially
// with no synchronization at all. The fixed-wait version of this fix was
// itself confirmed (not assumed) to fail on the same real case it was
// written for: the driftlight counter that surfaced this actually runs to
// ~1.4s (traced directly against the finding that motivated it, not a
// restated "~10s" figure that turned out not to match the source) — a fixed
// 1500ms wait already had almost no margin against that real number, and any
// number chosen for a fixed wait is wrong for a counter that legitimately
// runs longer, no matter what it's set to. Polling for actual stability has
// no such ceiling by construction: it waits exactly as long as content keeps
// changing, not a guessed constant.
//
// A genuinely infinite JS-driven text mutation (unlike this, a live clock
// re-rendering every second forever, say) would never satisfy the stability
// check on its own, so DOM_STABILITY_MAX_WAIT_MS below bounds the poll loop
// the same way MAX_REDIRECT_HOPS bounds waitForRedirectsToSettle — a
// safety fallback, not the expected path. Deliberately NOT what makes the
// existing CSS-only `glow-pulse` keyframe animation (see
// injectAnimationNeutralizingOverride below) safe: that animation never
// touches document text at all, so this polling loop sees stable text on its
// very first read regardless of how this constant is tuned — it's made
// deterministic entirely by the separate animation-iteration-count: 1
// override, and never exercises this max-wait fallback. Only a page whose
// *text content* is driven by a genuinely never-settling JS process reaches
// this fallback; see the dedicated regression fixture for that case in
// generatePageTests.spec.ts; a glow-pulse-only fixture cannot stand in for
// it, since it never reaches this code path at all.
const DOM_STABILITY_POLL_INTERVAL_MS = 150;
// 4 consecutive identical reads (600ms of confirmed stability at the
// interval above) — enough to not settle on a single coincidental match
// mid-transition (e.g. a counter that pauses briefly between animation
// frames), without adding much latency to the common static-page case.
const DOM_STABILITY_REQUIRED_STABLE_POLLS = 4;
// Comfortably above the real settle time (~1.4s) this whole mechanism was
// built against, with room for a slower CI machine or a legitimately longer
// counter, while still bounding a genuinely infinite case to a fixed,
// finite cost instead of hanging capture forever.
const DOM_STABILITY_MAX_WAIT_MS = 8000;

// Real, live-triggered finding (a stage-4 diagnostic run against
// catchandtrade): a client-side redirect (`if (!token) {
// window.location.href = '/login'; return; }` inside a mounted useEffect)
// fires AFTER page.goto's own 'load' event, as a completely separate
// navigation nothing previously waited for. If the destination route's
// first Next-dev compile is slow, this could still be in flight once a
// fixed wait elapses — capture then non-deterministically shows either the
// source page's own transitional pre-redirect state or the settled
// destination, depending on incidental page-capture order (whichever page
// happens to warm that route's compile first). Traced directly before
// picking a number: reusing the animation-settle wait's old fixed value
// (1500ms, since replaced by DOM_STABILITY_MAX_WAIT_MS's polling approach
// above) as this same detection window still misses a realistic combined
// case (an ~800ms effect-firing delay plus a ~3000ms cold-compile delay on
// the destination); 5000ms correctly waits out that same combined case.
const REDIRECT_DETECTION_WINDOW_MS = 5000;
// The real motivating shape is one hop (a single auth-gate redirect); a
// couple more as a safety margin against a chained redirect, bounded so a
// genuine redirect loop can't hang capture indefinitely.
const MAX_REDIRECT_HOPS = 3;

// Exported so this is directly testable with a real Chromium instance and
// page.route()-mocked responses — unlike the __name/page.evaluate bug this
// codebase already has, this function is normal Node-side code called
// directly, never serialized into an isolated browser realm, so it isn't
// subject to that same untestable-under-vitest problem.
export async function waitForRedirectsToSettle(page: Page): Promise<void> {
  for (let hop = 0; hop < MAX_REDIRECT_HOPS; hop++) {
    const urlBeforeWait = page.url();
    try {
      await page.waitForURL((url) => url.toString() !== urlBeforeWait, { timeout: REDIRECT_DETECTION_WINDOW_MS });
    } catch {
      return; // no further navigation started within the window — settled
    }
    // Best-effort: a real navigation failure on the destination surfaces
    // elsewhere (console errors, the eventual content assertion), not as a
    // crash here.
    await page.waitForLoadState('load', { timeout: 30000 }).catch(() => {});
  }
}

// Exported for the same reason waitForRedirectsToSettle is: directly
// testable with a real Chromium instance and page.route()-mocked responses,
// no mocking of this function itself needed. See DOM_STABILITY_* above for
// why this replaces a fixed wait, and why a CSS-only infinite animation
// (glow-pulse) can never exercise the maxWaitMs fallback branch below —
// only genuinely infinite JS-driven *text* mutation can.
export async function waitForDomTextStability(page: Page): Promise<void> {
  const deadline = Date.now() + DOM_STABILITY_MAX_WAIT_MS;
  let lastText: string | null = null;
  let stableCount = 0;
  while (Date.now() < deadline) {
    const text = await page.evaluate(() => document.body.innerText);
    if (text === lastText) {
      stableCount++;
    } else {
      stableCount = 1;
      lastText = text;
    }
    if (stableCount >= DOM_STABILITY_REQUIRED_STABLE_POLLS) return;
    await page.waitForTimeout(DOM_STABILITY_POLL_INTERVAL_MS);
  }
  // Deadline reached without ever observing DOM_STABILITY_REQUIRED_STABLE_POLLS
  // consecutive identical reads — a genuinely infinite or abnormally slow
  // JS-driven text mutation. Falls through and returns rather than looping
  // forever: capture proceeds against whatever state the page is in, the
  // same "give up and capture anyway" contract the old fixed wait always
  // had, except this path is now only taken when content actually never
  // settles, not unconditionally on every single page.
}

// Relative to the rebuild output dir's tests/ directory — a fixed, shared
// name (not derived from the user's original filename) so every generated
// page test can compute the same relative path via import.meta.url
// regardless of what the source file was called. writeSpecTree.ts copies the
// user-supplied storageState file to this same relative path in the output
// tree, and runMutationCheck.ts's scratch-copy fixture write mirrors it too —
// all three must agree, since nothing re-derives this path from a shared
// input at runtime.
export const AUTH_STORAGE_STATE_FIXTURE_RELATIVE_PATH = 'fixtures/auth-storage-state.json';

export interface SkippedPage {
  routeFile: string;
  reason: string;
}

export interface CapturedScreenshot {
  path: string; // relative to the rebuild output dir, e.g. spec/assets/screenshots/PAGE-root.png
  buffer: Buffer;
}

export interface PageStylesheetAnimations {
  routeFile: string;
  keyframeUsages: KeyframeUsage[];
  transitionUsages: TransitionUsage[];
}

export interface GeneratePageTestsResult {
  visible: GeneratedTestFile[];
  heldOut: GeneratedTestFile[];
  assetManifest: AssetManifestEntry[];
  screenshots: CapturedScreenshot[];
  capturedPages: string[]; // route files successfully captured
  skippedPages: SkippedPage[]; // route files visibly skipped, with why — never silently absent
  visionClassificationEnabled: boolean; // whether this run attempted vision classification at all (both GROQ_API_KEY and REBUILD_DOSSIER_ENABLE_VISION_CLASSIFICATION must be set)
  pageVisionFallbacks: SkippedPage[]; // captured pages that fell back to the regex classifier despite vision being enabled, with why — never silently indistinguishable from a page vision actually classified
  pageStylesheetAnimations: PageStylesheetAnimations[]; // routes whose authored CSS declares a real animation/transition — documentation only, see generateContracts.ts
  usedAuthStorageState: boolean; // whether a caller-supplied Playwright storageState was used for this run's captures — see capturePage
}

const EMPTY_RESULT: GeneratePageTestsResult = {
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

// Real, confirmed regression (found via a live diagnostic run against
// catchandtrade, not a hypothetical): tsx/esbuild's transform wraps any
// NESTED function — a named declaration or a const-bound arrow, either one —
// inside a function passed to page.evaluate/page.addInitScript with a call
// to a `__name(fn, "name")` helper, used to preserve `.name` across the
// transform. That helper is defined once at this module's own top level;
// page.evaluate/addInitScript only serialize the ONE passed function's own
// text (via Function.prototype.toString()), so the helper's definition is
// missing from what actually runs in the isolated browser realm, throwing
// `ReferenceError: __name is not defined` the moment the inner function is
// declared — breaking extractStylesheetAnimations's own nested
// matchesLiveElement below, and, more consequentially,
// injectAnimationNeutralizingOverride's nested `inject` arrow (silently,
// since an addInitScript failure doesn't reject the same way a failed
// page.evaluate call does — the settle-override could be silently not
// applying at all). Verified as fully general with a minimal reproduction
// completely outside this codebase (any page.evaluate(fn) where fn declares
// an inner function throws identically), not specific to any one
// extractor's code shape. Fixed by defining a no-op `__name` directly on the
// page's own global scope before any other addInitScript/evaluate call that
// might need it — as a plain STRING, deliberately, not a function reference,
// so it can never itself become subject to the same transform.
// Not covered by a vitest regression test — confirmed directly, not
// assumed, that vitest's own transform pipeline doesn't reproduce this at
// all (a nested function's serialized .toString() shows no __name wrapping
// under vitest, unlike under tsx, the real production entrypoint), so a
// vitest-based test would either pass trivially or could never fail
// meaningfully. Same category as the next-dev process-group-leak bug this
// codebase already has (a real environment/tooling mechanic a unit test
// can't surface) — verified instead via a live pipeline re-run against a
// real fixture. Exported for reuse by any future live-verification script
// that needs it, not for a unit test.
export const NAME_HELPER_SHIM_SCRIPT = 'window.__name = window.__name || ((fn) => fn);';

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

// Executed inside the page via page.addInitScript — runs before the page's
// own scripts, on every navigation, so it's active from first paint. This is
// the standard visual-regression-testing technique (the same one Percy/
// Chromatic use) for making a screenshot deterministic: near-zero (not
// literal zero — some browsers treat a 0-duration animation as "no
// animation" and skip settling oddly) duration, and critically
// animation-iteration-count: 1 so even an `infinite` keyframe animation
// collapses to one deterministic pass instead of looping forever during
// capture. Self-correcting against any small timing gap — even if a real
// animation starts a few ms before this lands, its already-elapsed time
// immediately reads as far past the override's ~1ms duration, so it settles
// on its final keyframe regardless. Marked with data-rebuild-dossier-override
// so extractStylesheetAnimations below can positively identify and skip this
// exact stylesheet, never mistaking its own `*` rule for page-authored CSS.
function injectAnimationNeutralizingOverride(): void {
  const inject = () => {
    if (!document.head) {
      requestAnimationFrame(inject); // document.head may not exist yet this early in addInitScript
      return;
    }
    const style = document.createElement('style');
    style.setAttribute('data-rebuild-dossier-override', 'true');
    style.textContent = `
      *, *::before, *::after {
        animation-delay: -1ms !important;
        animation-duration: 1ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 1ms !important;
        transition-delay: -1ms !important;
      }
    `;
    document.head.appendChild(style);
  };
  inject();
}

// Pure, exported so this one piece of real logic in extractStylesheetAnimations
// is unit-testable without a real browser (matches this codebase's
// convention of extracting anything with actual logic — see
// applyVisionClassification, redactObviousSecrets — for exactly this
// reason). '0s'/'none' are CSS's own "nothing declared" defaults — every
// element matches some rule with these properties present at their default
// value (a CSS reset commonly sets transition-property: none globally), so
// only a real, non-zero duration counts as "this selector has a transition."
export function hasRealTransition(duration: string, property: string): boolean {
  return Boolean(duration) && duration !== '0s' && Boolean(property) && property !== 'none';
}

// Longer/more-specific alternatives listed before their shorter prefixes
// (focus-within/focus-visible before focus) — regex alternation tries
// left-to-right and takes the first match, not the longest; traced directly
// against '.input:focus-within' before finalizing (an earlier ordering
// matched only ':focus', leaving '-within' as corrupted leftover text).
const STATE_PSEUDO_CLASS_PATTERN =
  /:(hover|focus-within|focus-visible|focus|active|target|checked|disabled|enabled|valid|invalid)\b/gi;

// Pure, Node-side, unit-tested directly — same "extract anything with real
// logic" convention as hasRealTransition just above. Real, live-triggered
// finding this exists to record: a blind rebuild reproduced a keyframe NAME
// correctly but wired it to `:hover` instead of the original's unconditional
// application — without this label, a rebuild agent has no way to tell
// "always on" from "only on hover" from the contract doc alone.
export function triggerConditionFor(selectorText: string): string {
  const matches = selectorText.match(STATE_PSEUDO_CLASS_PATTERN);
  if (!matches || matches.length === 0) return 'unconditional';
  return Array.from(new Set(matches.map((m) => m.toLowerCase()))).join(', ');
}

// Plain-object records (all string fields) can repeat across CSS rules that
// resolve to the same (selector, trigger[, keyframeName]) combination — a
// media-query-wrapped duplicate of the same rule, for instance. Dedupe by
// full content rather than a hand-picked key so this stays correct
// regardless of which record shape (keyframe usage or transition usage)
// it's called with.
function dedupeByJson<T>(records: T[]): T[] {
  const seen = new Map<string, T>();
  for (const record of records) {
    seen.set(JSON.stringify(record), record);
  }
  return Array.from(seen.values());
}

// Executed inside the page via page.evaluate — must be self-contained (no
// closures over this module's scope), matching extractDomOutline's own
// convention. Reads AUTHORED stylesheet rules, never computed style: after
// injectAnimationNeutralizingOverride runs, getComputedStyle(el) would read
// the override's forced values for every element, making real-vs-none
// completely indistinguishable — reading document.styleSheets directly
// inspects what the page's own CSS declares, unaffected by what the
// override forces into effect. Documentation only (see
// generateContracts.ts's stylesheetAnimationsSection) — never asserted
// against, so a false negative here never fails a correct rebuild.
//
// Real, live-triggered finding: a shared stylesheet (e.g. globals.css,
// loaded via a Next.js root layout on every route) commonly declares
// @keyframes/transitions used by only SOME pages. Without checking whether
// a rule's selector actually matches an element present on THIS page, every
// page sharing that stylesheet would report identical animations regardless
// of whether it uses them — confirmed directly: an "about" page with no
// animated elements at all initially reported the same hero-fade/glow-pulse
// as the pages that actually use them. `document.querySelector` (a native
// browser API, not this module's other functions) is safe to call here —
// only hasRealTransition/triggerConditionFor below can't be, since those are
// Node-side logic.
interface RawStylesheetAnimations {
  keyframeUsageCandidates: { selector: string; keyframeName: string }[];
  // Raw candidates only — deciding which of these constitute a "real"
  // transition (vs. a selector merely matching CSS's own '0s'/'none'
  // defaults) happens in Node via hasRealTransition, same as classifyDomText
  // interprets extractDomOutline's raw {selectorHint, text} pairs after the
  // page.evaluate call returns. This function cannot call hasRealTransition
  // itself — page.evaluate serializes only the function passed to it and
  // executes it in an isolated browser realm with no access to this
  // module's other functions.
  transitionCandidates: { selectorText: string; transitionDuration: string; transitionProperty: string }[];
}

function extractStylesheetAnimations(): RawStylesheetAnimations {
  const declaredKeyframeNames = new Set<string>();
  const keyframeUsageCandidates: RawStylesheetAnimations['keyframeUsageCandidates'] = [];
  const transitionCandidates: RawStylesheetAnimations['transitionCandidates'] = [];

  function matchesLiveElement(selectorText: string): boolean {
    // Must stay in sync with the module-level STATE_PSEUDO_CLASS_PATTERN
    // used by triggerConditionFor in Node — duplicated here because
    // page.evaluate can't reference this module's other functions/constants
    // (see the note on hasRealTransition above for why). Stripping the
    // state pseudo-class before querying matters, not just for labeling:
    // `document.querySelector('.button:hover')` returns null during
    // automated capture regardless of whether `.button` exists, since
    // nothing is actually being hovered — without stripping first, every
    // state-gated rule would be invisible to detection entirely, not just
    // unlabeled (confirmed directly: this was the actual bug behind the
    // `:hover`-vs-unconditional gap this whole feature exists to close).
    const STATE_PSEUDO_CLASS_PATTERN =
      /:(hover|focus-within|focus-visible|focus|active|target|checked|disabled|enabled|valid|invalid)\b/gi;
    const baseSelector = selectorText.replace(STATE_PSEUDO_CLASS_PATTERN, '').trim();
    try {
      return document.querySelector(baseSelector || selectorText) !== null;
    } catch {
      // An invalid/unparseable selector (rare, but real CSS can contain
      // vendor-prefixed or newer-syntax selectors querySelector rejects)
      // can't be confirmed as matching anything real either way.
      return false;
    }
  }

  function walkRules(rules: CSSRuleList) {
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSKeyframesRule) {
        declaredKeyframeNames.add(rule.name);
      } else if (rule instanceof CSSStyleRule) {
        if (!rule.selectorText) continue;
        const animationName = rule.style.animationName;
        const hasAnimationRef = Boolean(animationName) && animationName !== 'none';
        const hasTransitionRef = rule.style.transitionDuration !== '0s'; // cheap pre-filter before the more expensive DOM query below
        if (!hasAnimationRef && !hasTransitionRef) continue;
        if (!matchesLiveElement(rule.selectorText)) continue;
        if (hasAnimationRef) {
          for (const name of animationName.split(',').map((n) => n.trim())) {
            if (name) keyframeUsageCandidates.push({ selector: rule.selectorText, keyframeName: name });
          }
        }
        if (hasTransitionRef) {
          transitionCandidates.push({
            selectorText: rule.selectorText,
            transitionDuration: rule.style.transitionDuration,
            transitionProperty: rule.style.transitionProperty
          });
        }
      } else if (rule instanceof CSSMediaRule) {
        // One level of recursion catches the common, accessibility-conscious
        // `@media (prefers-reduced-motion: no-preference) { @keyframes ... }`
        // pattern without over-engineering deeper @supports/@media nesting —
        // a named, accepted gap, not built for.
        walkRules(rule.cssRules);
      }
      // Every other rule type (font-face, import, page, supports, ...) is
      // deliberately skipped, not crashed on — none carry animation info.
    }
  }

  for (const sheet of Array.from(document.styleSheets)) {
    const ownerNode = sheet.ownerNode as Element | null;
    if (ownerNode?.getAttribute?.('data-rebuild-dossier-override') === 'true') continue;
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules; // cross-origin sheets (a Google Fonts <link>) throw here
    } catch {
      continue;
    }
    walkRules(rules);
  }

  // Only a keyframe usage whose name is both declared somewhere AND
  // referenced by a rule whose selector matches a live element on this page
  // counts — see the doc comment above for why the intersection is required.
  const keyframeUsageCandidatesFiltered = keyframeUsageCandidates.filter((c) => declaredKeyframeNames.has(c.keyframeName));

  return { keyframeUsageCandidates: keyframeUsageCandidatesFiltered, transitionCandidates };
}

// Playwright's own object shape for BrowserContextOptions.storageState (it
// also accepts a plain file path string — Exclude drops that variant, since
// this always needs the parsed object to remap origins below).
export type StorageStateData = Exclude<NonNullable<BrowserContextOptions['storageState']>, string>;

// Real, traced-before-shipping finding: Playwright's storageState "origins"
// entries are matched by EXACT origin string (protocol+host+port). Cookies
// are host-scoped, not port-scoped, so a cookie captured against
// localhost:ANY_PORT applies regardless of which port this run's dev server
// happens to land on — but localStorage genuinely IS origin-scoped including
// port, per same-origin policy. This tool's dev server picks a fresh random
// port every single generate_spec call specifically to avoid collisions
// (see the port constant below), which means a caller-supplied storageState
// captured once, in advance, against whatever port that capture session used
// would never origin-match THIS run's port — every origins[] entry would
// silently fail to apply, no error, capture landing right back on
// unauthenticated content. Confirmed directly: a localStorage-gated fixture
// (matching the real catchandtrade portfolio/page.tsx shape this whole
// feature exists to close) showed exactly this silent failure the first time
// this was tried across two different ports. Since every route this tool
// ever captures belongs to the SAME single, locally-spawned dev server, every
// origins[] entry can always be safely remapped to THIS run's baseUrl — there
// is never a second, genuinely different real origin in play.
export function resolveAuthStorageState(authStorageStatePath: string, baseUrl: string): StorageStateData {
  const raw: StorageStateData = JSON.parse(readFileSync(authStorageStatePath, 'utf-8'));
  return { ...raw, origins: (raw.origins ?? []).map((o) => ({ ...o, origin: baseUrl })) };
}

interface CapturedPage {
  capture: PageCapture;
  screenshotBuffer: Buffer;
}

// The real Playwright call — left to the manual smoke test (no real browser
// in unit tests), matching the documented precedent in writeSpecTree.spec.ts.
async function capturePage(browser: Browser, baseUrl: string, route: RouteEntry, storageState?: StorageStateData): Promise<CapturedPage> {
  // Loads an already-authenticated session the caller supplied out-of-band —
  // this function never logs in itself, never sees a credential, and never
  // submits a form. See generateSpec.ts's authStorageStatePath doc comment
  // for how a caller produces the file in the first place. Already
  // origin-remapped by resolveAuthStorageState before this is called — see
  // its own doc comment for why that step is required, not optional.
  const context = await browser.newContext(storageState ? { storageState } : {});
  const page = await context.newPage();
  // Must be registered before page.goto — addInitScript only takes effect on
  // subsequent navigations, not the current page state. Registered first, so
  // it's already in place by the time injectAnimationNeutralizingOverride's
  // own nested arrow function runs — see NAME_HELPER_SHIM_SCRIPT's own
  // comment for why this is needed at all.
  await page.addInitScript(NAME_HELPER_SHIM_SCRIPT);
  await page.addInitScript(injectAnimationNeutralizingOverride);
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  try {
    await page.goto(`${baseUrl}${concretePath(route.path)}`, { waitUntil: 'load', timeout: 30000 });
    // Waits out a possible client-side redirect before anything below reads
    // the DOM — see waitForRedirectsToSettle's own doc comment. A genuinely
    // different concern from animation settling (navigation vs. motion), so
    // kept as its own sequential step, not merged into the wait below.
    await waitForRedirectsToSettle(page);
    // Polls for real DOM-text stability rather than a fixed wait — see
    // waitForDomTextStability's own doc comment. Both captures below happen
    // only after this resolves, so they can no longer disagree with each
    // other the way a sequential, unsynchronized DOM-text-then-screenshot
    // capture could.
    await waitForDomTextStability(page);
    const rawOutline = await page.evaluate(extractDomOutline);
    const domOutline: DomTextNode[] = rawOutline.slice(0, MAX_DOM_TEXT_NODES).map((node) => ({
      selectorHint: node.selectorHint,
      text: node.text,
      ...classifyDomText(node.text)
    }));
    const rawStylesheetAnimations = await page.evaluate(extractStylesheetAnimations);
    const keyframeUsages = dedupeByJson(
      rawStylesheetAnimations.keyframeUsageCandidates.map((c) => ({
        selector: c.selector,
        keyframeName: c.keyframeName,
        trigger: triggerConditionFor(c.selector)
      }))
    );
    const transitionUsages = dedupeByJson(
      rawStylesheetAnimations.transitionCandidates
        .filter((c) => hasRealTransition(c.transitionDuration, c.transitionProperty))
        .map((c) => ({ selector: c.selectorText, trigger: triggerConditionFor(c.selectorText) }))
    );
    const stylesheetAnimations =
      keyframeUsages.length > 0 || transitionUsages.length > 0 ? { keyframeUsages, transitionUsages } : undefined;
    const screenshotBuffer = await page.screenshot({ fullPage: true });
    const capture: PageCapture = {
      routeFile: route.file,
      path: route.path,
      capturedAt: new Date().toISOString(),
      consoleErrors,
      domOutline,
      ...(stylesheetAnimations ? { stylesheetAnimations } : {})
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

// Applies an optional vision-classification result over the regex-classified
// baseline. `null` (vision disabled, unavailable, or returned something
// invalid) or a length mismatch leaves domOutline completely untouched —
// the regex classifier's guess is always a safe, valid fallback, never
// discarded on a failed vision attempt.
export function applyVisionClassification(
  domOutline: DomTextNode[],
  visionResult: Pick<DomTextNode, 'kind' | 'dynamicShape'>[] | null
): DomTextNode[] {
  if (!visionResult || visionResult.length !== domOutline.length) return domOutline;
  // Explicitly assigns dynamicShape (not just `...visionResult[i]`) — a plain
  // object spread only overwrites keys present on the source, so a node
  // reclassified from dynamic to static would otherwise keep its stale
  // dynamicShape from the regex baseline, since {kind: 'static'} has no
  // dynamicShape key to override it with.
  return domOutline.map((node, i) => ({ ...node, kind: visionResult[i]!.kind, dynamicShape: visionResult[i]!.dynamicShape }));
}

export function buildPageTestContent(route: RouteEntry, capture: PageCapture, usedAuthStorageState = false): string {
  const concrete = concretePath(route.path);
  const assertions = capture.domOutline.map((node) => assertionFor(node)).join('\n');
  // Same fixture path writeSpecTree.ts copies the caller's storageState to,
  // and runMutationCheck.ts's scratch-copy fixture write mirrors — see
  // AUTH_STORAGE_STATE_FIXTURE_RELATIVE_PATH's own doc comment for why these
  // three must agree. `dirname`/`join`/`fileURLToPath` are already imported
  // by devServerBoilerplate() above, not re-imported here. The origin remap
  // below mirrors resolveAuthStorageState in this same file — see its doc
  // comment for why the fixture's own origins[] can't just be used verbatim:
  // this generated test computes its own fresh, random dev-server port at
  // run time, so the fixture's baked-in origin would otherwise never match.
  const newContextCall = usedAuthStorageState
    ? `await browser.newContext({\n      storageState: (() => {\n        const raw = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', ${JSON.stringify(AUTH_STORAGE_STATE_FIXTURE_RELATIVE_PATH)}), 'utf-8'));\n        return { ...raw, origins: (raw.origins ?? []).map((o) => ({ ...o, origin: baseUrl })) };\n      })()\n    });`
    : `await browser.newContext();`;
  const importLine = usedAuthStorageState
    ? `import { describe, it, expect, beforeAll, afterAll } from 'vitest';\nimport { readFileSync } from 'node:fs';`
    : `import { describe, it, expect, beforeAll, afterAll } from 'vitest';`;

  return `${importLine}
${devServerBoilerplate()}
describe(${JSON.stringify(`page: ${route.path} (from-reconciliation)`)}, () => {
  it('loads without crashing and renders its captured content (from-reconciliation)', async () => {
    const context = ${newContextCall}
    const page = await context.newPage();
    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    await page.goto(\`\${baseUrl}${concrete}\`, { waitUntil: 'load' });
    // Same redirect-settling loop the original capture used (see
    // waitForRedirectsToSettle in generatePageTests.ts) — without this, a
    // rebuild that faithfully reproduces the same client-side redirect
    // (e.g. an auth gate) would race this same timing window differently
    // than the original capture did and fail this assertion by reading a
    // transitional, pre-redirect DOM instead of the settled destination.
    for (let hop = 0; hop < ${MAX_REDIRECT_HOPS}; hop++) {
      const urlBeforeWait = page.url();
      try {
        await page.waitForURL((url) => url.toString() !== urlBeforeWait, { timeout: ${REDIRECT_DETECTION_WINDOW_MS} });
      } catch {
        break;
      }
      await page.waitForLoadState('load', { timeout: 30000 }).catch(() => {});
    }
    // Same DOM-text-stability polling the original capture used (see
    // waitForDomTextStability in generatePageTests.ts) — without this, a
    // rebuild that faithfully reproduces JS-driven motion documented in this
    // page's contract (a requestAnimationFrame counter, a staged reveal)
    // would fail this exact assertion by being read before it settles, or,
    // for a legitimately longer-running counter than any fixed wait could
    // guess, by being read too early no matter what constant was chosen.
    // Applied unconditionally, not just when this page had a detected CSS
    // animation — JS-driven motion has no CSS signal to gate on at all.
    // Inlined rather than imported: this generated file is its own, separate
    // npm project with no dependency on rebuild-dossier itself (same reason
    // devServerBoilerplate() above inlines its own helpers).
    {
      const deadline = Date.now() + ${DOM_STABILITY_MAX_WAIT_MS};
      let lastText = null;
      let stableCount = 0;
      while (Date.now() < deadline) {
        const text = await page.evaluate(() => document.body.innerText);
        if (text === lastText) {
          stableCount++;
        } else {
          stableCount = 1;
          lastText = text;
        }
        if (stableCount >= ${DOM_STABILITY_REQUIRED_STABLE_POLLS}) break;
        await page.waitForTimeout(${DOM_STABILITY_POLL_INTERVAL_MS});
      }
    }
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
  _cases: Case[],
  authStorageStatePath?: string
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
      detached: process.platform !== 'win32',
      // Overrides any NEXT_PUBLIC_* var the target app's own .env* files
      // hardcode to a fixed localhost port — see resolveLocalApiUrlOverrides'
      // own doc comment for the real, live-triggered bug this fixes.
      env: { ...process.env, ...resolveLocalApiUrlOverrides(repoPath, baseUrl) }
    });
    await waitForReady(baseUrl, Date.now() + DEV_SERVER_READY_TIMEOUT_MS);
    browser = await chromium.launch({ headless: true });
    // Resolved once, against THIS run's actual baseUrl — see
    // resolveAuthStorageState's own doc comment for why the origin can't
    // just be read verbatim from whatever the caller's file already says.
    const resolvedStorageState = authStorageStatePath ? resolveAuthStorageState(authStorageStatePath, baseUrl) : undefined;

    for (const route of pageRoutes) {
      try {
        const result = await capturePage(browser, baseUrl, route, resolvedStorageState);
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
  const pageStylesheetAnimations: PageStylesheetAnimations[] = [];

  // Deliberately opt-in via two env vars, not bare GROQ_API_KEY presence —
  // an ambient key set for an unrelated tool must never silently start
  // sending this target repo's source code and screenshots to a third
  // party. See visionClassifier.ts's own doc comment and the plan.
  const visionEnabled = Boolean(process.env.GROQ_API_KEY) && process.env.REBUILD_DOSSIER_ENABLE_VISION_CLASSIFICATION === '1';
  const visionModel = process.env.REBUILD_DOSSIER_GROQ_VISION_MODEL || DEFAULT_GROQ_VISION_MODEL;
  const pageVisionFallbacks: SkippedPage[] = [];

  // Deliberately a second, later loop rather than folded into the
  // browser-driving loop above: this runs after the dev server and browser
  // are already closed, so a slow or hung Groq call can never hold either
  // open, and result.capture.domOutline already has its regex-classified
  // baseline to fall back to by simply not overriding it.
  for (const [index, { route, result }] of captures.entries()) {
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

    if (result.capture.stylesheetAnimations) {
      pageStylesheetAnimations.push({
        routeFile: route.file,
        keyframeUsages: result.capture.stylesheetAnimations.keyframeUsages,
        transitionUsages: result.capture.stylesheetAnimations.transitionUsages
      });
    }

    let domOutline = result.capture.domOutline;
    if (visionEnabled) {
      let sourceCode = '';
      try {
        sourceCode = readFileSync(join(repoPath, route.file), 'utf-8');
      } catch {
        // Missing/unreadable source file — proceed with an empty string
        // rather than aborting the page; vision is still attempted on the
        // screenshot alone, just with less signal.
      }
      const visionResult = await classifyPageWithVision(
        result.screenshotBuffer, // the same screenshot already captured for the asset manifest — never re-captured
        domOutline, // full nodes, regex guess included — "confirm or correct," not "classify from scratch"
        sourceCode,
        process.env.GROQ_API_KEY!,
        visionModel
      );
      if (visionResult) {
        domOutline = applyVisionClassification(domOutline, visionResult);
      } else {
        // Covers every failure mode uniformly (bad key, rate-limited past
        // the retry, deprecated model, malformed response, oversized
        // screenshot, timeout) — never silently indistinguishable from a
        // page vision actually classified.
        pageVisionFallbacks.push({
          routeFile: route.file,
          reason: 'vision classification unavailable or returned an invalid response; used the regex classifier for this page'
        });
      }
      // Paces consecutive pages' vision calls (see VISION_PAGE_PACING_DELAY_MS's
      // own doc comment) — skipped after the last page, since there's nothing
      // left to wait for.
      if (index < captures.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, VISION_PAGE_PACING_DELAY_MS));
      }
    }

    const finalCapture: PageCapture = { ...result.capture, domOutline, screenshotAssetId: assetId };

    const testFile: GeneratedTestFile = {
      filename: `${base}.page.spec.ts`,
      content: buildPageTestContent(route, finalCapture, Boolean(authStorageStatePath)),
      sourceFile: route.file,
      coveredRouteFiles: [route.file],
      maxMutationSites: MAX_MUTATION_SITES_PER_PAGE
    };

    if (index % HELD_OUT_EVERY === HELD_OUT_EVERY - 1) {
      heldOut.push(testFile);
    } else {
      visible.push(testFile);
    }
  }

  return {
    visible,
    heldOut,
    assetManifest,
    screenshots,
    capturedPages,
    skippedPages,
    visionClassificationEnabled: visionEnabled,
    pageVisionFallbacks,
    pageStylesheetAnimations,
    usedAuthStorageState: Boolean(authStorageStatePath)
  };
}
