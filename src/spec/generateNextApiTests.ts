import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EvidenceBundle, RouteEntry } from '../ingest/evidenceSchema.js';
import type { Case } from '../reconciliation/types.js';
import type { GeneratedTestFile } from './generateTests.js';
import { inferRequestBodyFields } from './inferRequestBodyFields.js';
import { inferSuccessStatusCode } from './inferSuccessStatusCode.js';
import {
  concretePath,
  METHODS_WITH_BODY,
  placeholderBodyLiteral,
  reconciliationAssertion,
  sanitizeFilenameBase
} from './routeTestAssertions.js';

const HELD_OUT_EVERY = 3; // same deterministic split as the Express generator

// Next.js App Router API routes are the more common shape than a hand-rolled
// Express app in a lot of real codebases, and — unlike Express — there's no
// single app instance to boot: each route.ts exports one plain async function
// per HTTP method. So there's nothing to spin up a server for; the handler
// is called directly, the same way Next's own router would dispatch to it.
const ROUTE_FILE_PATTERN = /route\.(ts|tsx|js|jsx)$/;

function importPathFor(routeFile: string): string {
  // Tests live at <rebuild>/tests/visible|held-out/<name>.spec.ts — two
  // directories up reaches <rebuild>/, then into the mirrored source path.
  return `../../${routeFile.replace(/\.tsx?$/, '.js')}`;
}

function paramNamesFor(path: string): string[] {
  return [...path.matchAll(/:([^/]+)/g)].map((m) => m[1]!);
}

function paramsObjectLiteral(path: string): string {
  const names = paramNamesFor(path);
  if (names.length === 0) return '{ params: {} }';
  const entries = names.map((name) => `${name}: 'test-value-123'`).join(', ');
  return `{ params: { ${entries} } }`;
}

// Real, live-triggered finding: a NextRequest constructed with no body at
// all makes any handler that unconditionally calls request.json() throw
// (SyntaxError: Unexpected end of JSON input) on this exact smoke test —
// every time, regardless of whether the route's actual logic is correct.
// That's not a signal about the target app; it's the generated test never
// having sent something for `request.json()` to parse. Originally scoped to
// POST/PUT/PATCH only, on the assumption DELETE conventionally identifies
// its target via the URL, not a body. A genuinely third-party app (a
// Next.js todo API, evaluated specifically because it wasn't ours) proved
// that assumption wrong: its real DELETE handler reads `{ id }` from the
// body, and the generated smoke test crashed against it with the identical
// SyntaxError — not a rebuild-specific bug, confirmed by running the same
// request against the original app's own handler. DELETE now always gets
// an empty `{}` placeholder body too, the same minimal fix POST/PUT/PATCH
// got before field inference existed (inferRequestBodyFields.ts) — enough
// to prevent the crash. Deliberately not extended further: DELETE stays
// outside METHODS_WITH_BODY, so it gets no inferred fields and no
// success-status-trust gate below, since a DELETE that reads a lookup key
// from its body would face the same placeholder-vs-real-record mismatch
// already true of PUT (a fresh placeholder value won't match a real
// record, so the handler may legitimately return "not found" instead of
// its declared success status) — widening that trust boundary to DELETE is
// a separate, unevaluated change this fix does not make. GET is still left
// alone entirely; a body on GET remains genuinely unusual, unlike DELETE.
// `fields` (from inferRequestBodyFields, best-effort static analysis of the
// handler's own source) drives a more realistic placeholder for
// METHODS_WITH_BODY — falls back to `{}` when nothing could be inferred,
// the same `{}` DELETE always gets since it isn't a member of that set.
// Either way, a handler's own validation logic then runs and correctly
// returns its own 4xx for missing fields, which still satisfies
// `toBeLessThan(500)`, rather than crashing before any of that logic runs.
function requestInitFor(method: string, fields: string[]): string {
  if (!METHODS_WITH_BODY.has(method) && method !== 'DELETE') return `{ method: '${method}' }`;
  return `{ method: '${method}', body: JSON.stringify(${placeholderBodyLiteral(fields)}), headers: { 'Content-Type': 'application/json' } }`;
}

// A route's file can legitimately be unreadable here (some existing tests
// pass a placeholder repoPath with no real file behind it; in real runs a
// route's file could disappear between ingest and generation) — falling
// back to [] reproduces the pre-existing `{}` placeholder exactly, rather
// than crashing the whole generator over one route's missing source.
function inferFieldsSafely(repoPath: string, route: RouteEntry): string[] {
  try {
    const text = readFileSync(join(repoPath, route.file), 'utf-8');
    return inferRequestBodyFields(text, route);
  } catch {
    return [];
  }
}

// Real, live-triggered finding (a real aliased-path fixture's GET
// /api/users/:id route): inferSuccessStatusCode correctly identifies the
// handler's own unconditional "success" status from its source, but the
// generated smoke test's placeholder path segment ('test-value-123') has no
// relationship to whether a record actually exists — a lookup-gated route
// legitimately hits its "not found" branch instead, and asserting the
// code's success status would then fail a genuinely correct server. Scoped
// down to exactly the shape the placeholder request can actually be trusted
// to reach: a body-carrying method (whose placeholder body — from
// inferRequestBodyFields — really does fill in every known field, avoiding
// simple presence guards) with no dynamic path segment at all (a GET, or
// any route depending on a lookup keyed by the URL, is not trustworthy this
// way). Documentation (generateContracts.ts) is NOT scoped this way — this
// gate is test-assertion-only, since a wrong guess there is directly
// test-facing.
function canTrustSuccessStatusForTest(route: RouteEntry): boolean {
  return METHODS_WITH_BODY.has(route.method ?? '') && !/:[^/]+/.test(route.path);
}

// Same safe-read convention as inferFieldsSafely above (duplicated
// per-generator by existing precedent, not shared). Only consulted when
// reconciliation has no claim for this route — the two signals both derive
// from the same source repo, but reconciliation encodes a documented
// (comment/TODO) claim while this is read directly from the handler's own
// code; never asserting both at once avoids a self-contradictory generated
// test if they ever happened to disagree.
function inferSuccessStatusSafely(repoPath: string, route: RouteEntry) {
  if (!canTrustSuccessStatusForTest(route)) return null;
  try {
    const text = readFileSync(join(repoPath, route.file), 'utf-8');
    return inferSuccessStatusCode(text, route);
  } catch {
    return null;
  }
}

function testFileFor(repoPath: string, route: RouteEntry, importPath: string, cases: Case[], fields: string[]): string {
  const method = route.method ?? 'GET';
  const concrete = concretePath(route.path);
  const reconciliation = reconciliationAssertion(route, cases);
  const successStatus = reconciliation ? null : inferSuccessStatusSafely(repoPath, route);
  const paramsArg = paramsObjectLiteral(route.path);
  const requestInit = requestInitFor(method, fields);

  const tests = [
    `  it('responds without crashing (from-repo contract)', async () => {
    const request = new NextRequest('http://localhost:3000${concrete}', ${requestInit});
    const res = await ${method}(request, ${paramsArg});
    expect(res.status).toBeLessThan(500);
  });`
  ];

  if (reconciliation) {
    tests.push(
      `  it(${JSON.stringify(`${reconciliation.claim} (from-reconciliation)`)}, async () => {
    const request = new NextRequest('http://localhost:3000${concrete}', ${requestInit});
    const res = await ${method}(request, ${paramsArg});
    expect(res.status).toBe(${reconciliation.status});
  });`
    );
  } else if (successStatus) {
    tests.push(
      `  it(${JSON.stringify(`${successStatus.claim} (from-source)`)}, async () => {
    const request = new NextRequest('http://localhost:3000${concrete}', ${requestInit});
    const res = await ${method}(request, ${paramsArg});
    expect(res.status).toBe(${successStatus.status});
  });`
    );
  }

  return `import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { ${method} } from '${importPath}';

describe(${JSON.stringify(`${method} ${route.path}`)}, () => {
${tests.join('\n\n')}
});
`;
}

export function generateNextApiTests(
  repoPath: string,
  evidence: EvidenceBundle,
  cases: Case[]
): { visible: GeneratedTestFile[]; heldOut: GeneratedTestFile[] } {
  const apiRoutes = evidence.routes.filter((r) => r.kind === 'api' && ROUTE_FILE_PATTERN.test(r.file));
  if (apiRoutes.length === 0 || !Object.hasOwn(evidence.packageJson.dependencies, 'next')) {
    return { visible: [], heldOut: [] };
  }

  const visible: GeneratedTestFile[] = [];
  const heldOut: GeneratedTestFile[] = [];

  apiRoutes.forEach((route, index) => {
    const fields = inferFieldsSafely(repoPath, route);
    const file: GeneratedTestFile = {
      filename: `${sanitizeFilenameBase(route.method, route.path)}.spec.ts`,
      content: testFileFor(repoPath, route, importPathFor(route.file), cases, fields),
      sourceFile: route.file
    };
    if (index % HELD_OUT_EVERY === HELD_OUT_EVERY - 1) {
      heldOut.push(file);
    } else {
      visible.push(file);
    }
  });

  return { visible, heldOut };
}
