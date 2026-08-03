import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EvidenceBundle, RouteEntry } from '../ingest/evidenceSchema.js';
import type { Case } from '../reconciliation/types.js';
import type { GeneratedFile } from './generateContracts.js';
import { inferRequestBodyFields } from './inferRequestBodyFields.js';
import { inferSuccessStatusCode } from './inferSuccessStatusCode.js';
import {
  concretePath,
  METHODS_WITH_BODY,
  placeholderBodyLiteral,
  reconciliationAssertion,
  sanitizeFilenameBase
} from './routeTestAssertions.js';

const HELD_OUT_EVERY = 3; // deterministic split, not random — see generateTests below

function findAppExport(repoPath: string, files: string[]): { file: string; exportName: string } | null {
  for (const file of files) {
    const fullPath = join(repoPath, file);
    if (!existsSync(fullPath)) continue;
    const text = readFileSync(fullPath, 'utf-8');
    const match = text.match(/export\s+default\s+(\w+)/);
    if (match) return { file, exportName: match[1]! };
  }
  return null;
}

function importPathFor(appFile: string): string {
  // Tests live at <rebuild>/tests/visible|held-out/<name>.spec.ts — two
  // directories up reaches <rebuild>/, then into the mirrored source path.
  return `../../${appFile.replace(/\.tsx?$/, '.js')}`;
}

// Same class of bug as generateNextApiTests.ts's real, live-triggered
// finding: a fetch() call with no body at all makes any handler that
// unconditionally reads req.body throw on this exact smoke test, regardless
// of whether the route's actual logic is correct. `fields` (best-effort
// static analysis of the handler's own source) drives a more realistic
// placeholder body; falls back to `{}` when nothing could be inferred.
function requestInitFor(method: string, fields: string[]): string {
  if (!METHODS_WITH_BODY.has(method)) return `{ method: '${method}' }`;
  return `{ method: '${method}', body: JSON.stringify(${placeholderBodyLiteral(fields)}), headers: { 'Content-Type': 'application/json' } }`;
}

// A route's file can legitimately be unreadable here (a placeholder repoPath
// in a test, or a route's source having gone missing between ingest and
// generation) — falling back to [] reproduces the `{}` placeholder rather
// than crashing the whole generator over one route's missing source.
function inferFieldsSafely(repoPath: string, route: RouteEntry): string[] {
  try {
    const text = readFileSync(join(repoPath, route.file), 'utf-8');
    return inferRequestBodyFields(text, route);
  } catch {
    return [];
  }
}

// Same lookup-gated-route safety gate as generateNextApiTests.ts's
// identical helper — see its comment for the real, live-triggered failure
// (a GET /:id route whose placeholder path segment doesn't match a real
// record) that motivated it.
function canTrustSuccessStatusForTest(route: RouteEntry): boolean {
  return METHODS_WITH_BODY.has(route.method ?? '') && !/:[^/]+/.test(route.path);
}

// Same safe-read convention as inferFieldsSafely above, and same
// reconciliation-takes-precedence rule as generateNextApiTests.ts's
// identical helper — see its comment for why the two signals are never
// asserted together.
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
  const requestInit = requestInitFor(method, fields);

  const tests = [
    `  it('responds without crashing (from-repo contract)', async () => {
    const res = await fetch(\`\${baseUrl}${concrete}\`, ${requestInit});
    expect(res.status).toBeLessThan(500);
  });`
  ];

  if (reconciliation) {
    tests.push(
      `  it(${JSON.stringify(`${reconciliation.claim} (from-reconciliation)`)}, async () => {
    const res = await fetch(\`\${baseUrl}${concrete}\`, ${requestInit});
    expect(res.status).toBe(${reconciliation.status});
  });`
    );
  } else if (successStatus) {
    tests.push(
      `  it(${JSON.stringify(`${successStatus.claim} (from-source)`)}, async () => {
    const res = await fetch(\`\${baseUrl}${concrete}\`, ${requestInit});
    expect(res.status).toBe(${successStatus.status});
  });`
    );
  }

  return `import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import app from '${importPath}';

let server;
let baseUrl;

beforeAll(async () => {
  server = createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = \`http://127.0.0.1:\${server.address().port}\`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(() => resolve()));
});

describe(${JSON.stringify(`${method} ${route.path}`)}, () => {
${tests.join('\n\n')}
});
`;
}

export interface GeneratedTestFile extends GeneratedFile {
  sourceFile: string; // original repo's file the mutation check should mutate
  coveredRouteFiles?: string[]; // route/contract files this test actually exercises, for
  // contract-coverage tracking — usually the same as sourceFile (true for
  // every Express test here), but NOT always: a gate test's sourceFile is
  // the original app's guard mechanism, while the routes it behaviorally
  // covers (and a rebuild agent must still build) can be entirely different
  // files. Falls back to [sourceFile] when absent.
  maxMutationSites?: number; // caps runMutationCheck's per-target mutation-site count — see
  // generatePageTests.ts, which sets this to bound the cost of one fresh
  // `next dev` boot per mutation site. Left undefined (uncapped) for every
  // other generator; runMutationCheck.ts treats undefined as Infinity.
}

export function generateTests(
  repoPath: string,
  evidence: EvidenceBundle,
  cases: Case[]
): { visible: GeneratedTestFile[]; heldOut: GeneratedTestFile[] } {
  const apiRoutes = evidence.routes.filter((r) => r.kind === 'api');
  if (apiRoutes.length === 0 || !Object.hasOwn(evidence.packageJson.dependencies, 'express')) {
    return { visible: [], heldOut: [] };
  }

  const appExport = findAppExport(repoPath, [...new Set(apiRoutes.map((r) => r.file))]);
  if (!appExport) {
    return { visible: [], heldOut: [] };
  }
  const importPath = importPathFor(appExport.file);

  const visible: GeneratedTestFile[] = [];
  const heldOut: GeneratedTestFile[] = [];

  apiRoutes.forEach((route, index) => {
    const fields = inferFieldsSafely(repoPath, route);
    const file: GeneratedTestFile = {
      filename: `${sanitizeFilenameBase(route.method, route.path)}.spec.ts`,
      content: testFileFor(repoPath, route, importPath, cases, fields),
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
