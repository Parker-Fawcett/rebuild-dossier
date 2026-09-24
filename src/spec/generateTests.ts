import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import type { EvidenceBundle, RouteEntry } from '../ingest/evidenceSchema.js';
import type { Case } from '../reconciliation/types.js';
import type { GeneratedFile } from './generateContracts.js';
import { inferRequestBodyFields } from './inferRequestBodyFields.js';
import { inferSuccessStatusCode } from './inferSuccessStatusCode.js';
import { inferZodRequiredFields } from './parseZodObjectSchema.js';
import {
  concretePath,
  METHODS_WITH_BODY,
  placeholderBodyLiteral,
  reconciliationAssertion,
  sanitizeFilenameBase
} from './routeTestAssertions.js';

const HELD_OUT_EVERY = 3; // deterministic split, not random — see generateTests below

interface AppExport {
  file: string;
  exportName: string;
  isDefault: boolean;
}

// Real, live-triggered finding (issue #7): route files that register routes
// via `export function registerRoutes(app, db)` carry no app export at all,
// and apps using named exports (`export const app`, `export { app }`) or
// CommonJS (`module.exports = app`) were invisible to the old
// `export default`-only scan — so generation silently produced zero tests.
// Detection is deliberately restricted to the literal `app` binding: the
// emitted harness passes the import straight to `createServer()`, and
// guessing at any other binding (PORT, router, config) would fabricate a
// broken suite instead of an empty one.
function findAppExport(repoPath: string, files: string[]): AppExport | null {
  // Route files first (existing behavior), then conventional entry points —
  // the app instance usually lives in index/server/app, not in a route file.
  const entryCandidates = [
    'index.js',
    'index.ts',
    'server.js',
    'server.ts',
    'app.js',
    'app.ts',
    'main.js',
    'main.ts',
    'src/index.js',
    'src/index.ts',
    'src/server.js',
    'src/server.ts',
    'src/app.js',
    'src/app.ts'
  ];
  const ordered = [...new Set([...files, ...entryCandidates])];
  for (const file of ordered) {
    const fullPath = join(repoPath, file);
    if (!existsSync(fullPath)) continue;
    let text: string;
    try {
      text = readFileSync(fullPath, 'utf-8');
    } catch {
      continue;
    }
    const def = text.match(/export\s+default\s+(\w+)/);
    if (def) return { file, exportName: def[1]!, isDefault: true };
    if (/export\s+(?:const|let|var)\s+app\b/.test(text)) return { file, exportName: 'app', isDefault: false };
    if (/export\s*\{[^}]*\bapp\b[^}]*\}/.test(text)) return { file, exportName: 'app', isDefault: false };
    // `module.exports = app` makes the app function itself the module, so ESM
    // sees it only as the default export; `import { app }` binds undefined, the
    // test server gets no handler, and every request hangs to a timeout. Found
    // live in a cold run (all 10 tests of an Express app came back unrunnable);
    // the old test here only string-matched the import and never ran it.
    if (/module\.exports\s*=\s*app\b/.test(text)) return { file, exportName: 'app', isDefault: true };
    if (/module\.exports\s*=\s*\{[^}]*\bapp\b[^}]*\}/.test(text)) return { file, exportName: 'app', isDefault: false };
    if (/exports\.app\s*=/.test(text)) return { file, exportName: 'app', isDefault: false };
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
// Same DELETE fix as generateNextApiTests.ts, and the same deliberate
// limit — see that file's identical helper for the real, live-triggered
// finding (a third-party app's DELETE handler reading its body) that
// motivated it, and why DELETE stays out of METHODS_WITH_BODY itself.
function requestInitFor(method: string, fields: string[]): string {
  if (!METHODS_WITH_BODY.has(method) && method !== 'DELETE') return `{ method: '${method}' }`;
  return `{ method: '${method}', body: JSON.stringify(${placeholderBodyLiteral(fields)}), headers: { 'Content-Type': 'application/json' } }`;
}

// A route's file can legitimately be unreadable here (a placeholder repoPath
// in a test, or a route's source having gone missing between ingest and
// generation) — falling back to [] reproduces the `{}` placeholder rather
// than crashing the whole generator over one route's missing source.
//
// Issue #9: Zod-validated handlers rarely destructure req.body directly
// (they parse through a schema), so handler-source extraction finds nothing
// and the emitted test posts `{}` — which validation rejects, demoting the
// test to weak. When handler extraction is empty, fall back to the schema's
// required field names. Placeholders stay plain strings (see
// parseZodObjectSchema.ts limitation 4): enough for the dominant
// string-with-min-length case, no worse than `{}` anywhere else.
function inferFieldsSafely(repoPath: string, route: RouteEntry): string[] {
  try {
    const text = readFileSync(join(repoPath, route.file), 'utf-8');
    const fromSource = inferRequestBodyFields(text, route);
    if (fromSource.length > 0) return fromSource;
    return inferZodRequiredFields(text, route);
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

function testFileFor(
  repoPath: string,
  route: RouteEntry,
  importPath: string,
  isDefaultExport: boolean,
  cases: Case[],
  fields: string[]
): string {
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

  // Detection only ever yields the literal `app` binding (see
  // findAppExport), so the local name stays `app` in both forms — only the
  // import syntax differs.
  const importLine = isDefaultExport ? `import app from '${importPath}';` : `import { app } from '${importPath}';`;
  return `import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
${importLine}

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

// Repo-relative files the app-export module loads at import time, following
// relative require()/import specifiers transitively (the export file itself
// included). Every generated API test imports the app, so every one of these
// must exist before any test can even load. Found live in a Codex cold run:
// src/index.js (the app export, whose own GET / had only a weak test) and a
// router it mounts both landed on the untested-contracts blocklist, so the
// rebuild agent could not create the file every visible test imports. Static
// and heuristic: computed or conditional requires are not followed.
const REQUIRE_OR_IMPORT = /(?:require\s*\(\s*|\bimport\s+(?:[^'"]*?\sfrom\s+)?|\bimport\s*\(\s*|\bexport\s+[^'"]*?\sfrom\s+)(['"])(\.{1,2}\/[^'"]+)\1/g;
const MODULE_EXTENSIONS = ['', '.js', '.ts', '.mjs', '.cjs', '.jsx', '.tsx', '/index.js', '/index.ts', '/index.mjs', '/index.cjs'];

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export function importClosure(repoPath: string, entryFile: string): string[] {
  const seen = new Set<string>();
  const queue = [posix.normalize(entryFile)];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    let text: string;
    try {
      text = readFileSync(join(repoPath, file), 'utf-8');
    } catch {
      continue;
    }
    for (const m of text.matchAll(REQUIRE_OR_IMPORT)) {
      const base = posix.join(posix.dirname(file), m[2]!);
      const hit = MODULE_EXTENSIONS.map((ext) => base + ext).find((c) => isFile(join(repoPath, c)));
      if (hit && !seen.has(hit)) queue.push(hit);
    }
  }
  return [...seen];
}

export function noExportedAppNote(routeCount: number): string {
  return (
    `Found ${routeCount} Express API route(s) but no exported Express app instance ` +
    '(looked for `module.exports = app`, `exports.app`, `export default`, and `export const app` / `export { app }` ' +
    'in the route files and in index/server/app/main entry files), so no API tests were generated, and every route file ' +
    'stays in spec/untested-contracts.json. To enable them, export the app in your copy: add `module.exports = app;` ' +
    '(ESM: `export default app;`) and wrap the `app.listen(...)` call in `if (require.main === module) { ... }` so importing ' +
    'the app does not start a server. Then delete or move aside the <repo>-rebuild/ directory this run wrote (generate_spec will not overwrite it) and re-run generate_spec.'
  );
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
): { visible: GeneratedTestFile[]; heldOut: GeneratedTestFile[]; note?: string; importClosure?: string[] } {
  const apiRoutes = evidence.routes.filter((r) => r.kind === 'api');
  if (apiRoutes.length === 0 || !Object.hasOwn(evidence.packageJson.dependencies, 'express')) {
    return { visible: [], heldOut: [] };
  }

  const appExport = findAppExport(repoPath, [...new Set(apiRoutes.map((r) => r.file))]);
  if (!appExport) {
    // Found live in a cold run of docs/validators.md: the most common shape
    // for a small Express app (`const app = express(); ... app.listen(5500)`,
    // nothing exported) produced zero tests with no explanation, leaving
    // every route file blocklisted and the rebuild nothing to build against.
    // Still no guessing at a binding (see findAppExport), but never silent.
    return {
      visible: [],
      heldOut: [],
      note: noExportedAppNote(apiRoutes.length)
    };
  }
  const importPath = importPathFor(appExport.file);

  const visible: GeneratedTestFile[] = [];
  const heldOut: GeneratedTestFile[] = [];

  apiRoutes.forEach((route, index) => {
    const fields = inferFieldsSafely(repoPath, route);
    const file: GeneratedTestFile = {
      filename: `${sanitizeFilenameBase(route.method, route.path)}.spec.ts`,
      content: testFileFor(repoPath, route, importPath, appExport.isDefault, cases, fields),
      sourceFile: route.file
    };
    if (index % HELD_OUT_EVERY === HELD_OUT_EVERY - 1) {
      heldOut.push(file);
    } else {
      visible.push(file);
    }
  });

  return { visible, heldOut, importClosure: importClosure(repoPath, appExport.file) };
}
