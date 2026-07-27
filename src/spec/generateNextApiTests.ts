import type { EvidenceBundle, RouteEntry } from '../ingest/evidenceSchema.js';
import type { Case } from '../reconciliation/types.js';
import type { GeneratedTestFile } from './generateTests.js';
import { concretePath, reconciliationAssertion, sanitizeFilenameBase } from './routeTestAssertions.js';

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
// having sent something for `request.json()` to parse. Scoped to the HTTP
// methods that conventionally carry a body — GET/DELETE requests with a
// body are unusual and left alone, matching real REST conventions. `{}` is
// a deliberately minimal, generic placeholder (no attempt to infer the
// route's real expected shape, which isn't available from static analysis
// alone) — a handler's own validation logic then runs and correctly
// returns its own 4xx for missing fields, which still satisfies
// `toBeLessThan(500)`, rather than crashing before any of that logic runs.
const METHODS_WITH_BODY = new Set(['POST', 'PUT', 'PATCH']);

function requestInitFor(method: string): string {
  if (!METHODS_WITH_BODY.has(method)) return `{ method: '${method}' }`;
  return `{ method: '${method}', body: JSON.stringify({}), headers: { 'Content-Type': 'application/json' } }`;
}

function testFileFor(route: RouteEntry, importPath: string, cases: Case[]): string {
  const method = route.method ?? 'GET';
  const concrete = concretePath(route.path);
  const reconciliation = reconciliationAssertion(route, cases);
  const paramsArg = paramsObjectLiteral(route.path);
  const requestInit = requestInitFor(method);

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
  _repoPath: string,
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
    const file: GeneratedTestFile = {
      filename: `${sanitizeFilenameBase(route.method, route.path)}.spec.ts`,
      content: testFileFor(route, importPathFor(route.file), cases),
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
