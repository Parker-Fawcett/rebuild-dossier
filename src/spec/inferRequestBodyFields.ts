import type { RouteEntry } from '../ingest/evidenceSchema.js';
import { METHODS_WITH_BODY } from './routeTestAssertions.js';

// Best-effort, regex-based extraction of request-body field names from a
// route handler's own source — never a real parser, matching this
// codebase's existing narrow-heuristic style (classifyDomText.ts,
// visionClassifier.ts's redactObviousSecrets). Extracted names are used
// ONLY for (a) a documentation section in the generated contract .md and
// (b) a more realistic placeholder body in generated smoke tests — never
// to add a new assertion on response content, since a bad extraction (a
// missed rename, a computed key, a spread pattern) must never be able to
// fail a genuinely correct rebuild.
//
// Response-body field-name inference is out of scope for v1 — for simple
// CRUD routes that echo back what they stored, fixing the request side
// transitively fixes the response side too.
//
// Known, named limitations (accepted, not oversights):
// 1. Renamed destructuring (`{ message: msg }`) — dropped entirely, neither
//    name captured.
// 2. Computed/bracket-notation keys (`body[key]`, `body['message']`) — not
//    matched.
// 3. Spread-only usage (`{ ...rest }`) — dropped.
// 4. Default-valued destructuring (`{ message = '' }`) — dropped (contains
//    `=`).
// 5. Chained access without a `body`-named variable
//    (`(await request.json()).message`), or a differently-named local
//    (`const payload = ...; payload.message`) — not recognized. `body` is
//    an extremely standard convention for exactly this purpose in
//    server-side route handlers (no `document.body`-style collision risk
//    here, since there's no DOM global server-side), so this
//    simplification is low-risk in practice, not an oversight.
// 6. Nested destructuring (`{ meta: { message } }`) — the inner `message`
//    isn't recognized as a top-level identifier.
// 7. Naive brace counting doesn't parse string/template/regex literals — a
//    stray brace character inside a string constant could in principle
//    throw off isolation. Low-probability, and low-consequence given the
//    scope constraint (worst case: an extra/missing key in a placeholder
//    body or doc line, never a false test failure).
// 8. Express inline-middleware ordering — if a route registration has an
//    earlier inline function argument before the real handler, the first
//    `{` found belongs to that earlier function.
// 9. Destructuring combined with a type assertion on the right-hand side
//    (`const { name, message } = body as { name: string; message: string };`),
//    or through an intermediate Zod-parsed variable (`const parsed =
//    schema.parse(await request.json()); const { name } = parsed;`) —
//    neither destructuring pattern's RHS matcher recognizes `body as {...}`
//    or an arbitrary intermediate variable name.

const IDENTIFIER_SOURCE = '[A-Za-z_$][A-Za-z0-9_$]*';
const BARE_IDENTIFIER_PATTERN = new RegExp(`^${IDENTIFIER_SOURCE}$`);

const DESTRUCTURE_FROM_JSON_PATTERN = /(?:const|let)\s*\{([^}]*)\}\s*=\s*await\s+(?:request|req)\.json\(\)/g;
const DESTRUCTURE_FROM_REQ_BODY_PATTERN = /(?:const|let)\s*\{([^}]*)\}\s*=\s*req\.body\b/g;
const PROPERTY_ACCESS_PATTERN = new RegExp(`\\bbody\\??\\.(${IDENTIFIER_SOURCE})`, 'g');
// Handles the common strict-TypeScript idiom of narrowing an `unknown`/`any`
// body before touching a property, e.g.
// `(body as Record<string, unknown> | null)?.name` or
// `(body as Record<string, unknown>).name` — traced directly against the
// real handler shape that motivated this module; without this pattern the
// extractor gets zero matches on that exact real-world code. Also accepts
// `(req.body as ...)` directly (no intermediate `body` variable) — an
// equally realistic Express idiom, found by tracing a live Express fixture
// during verification, not assumed in advance.
const CASTED_PROPERTY_ACCESS_PATTERN = new RegExp(`\\(\\s*(?:req\\.)?body\\s+as\\s+[^)]*\\)\\s*[?!]?\\.(${IDENTIFIER_SOURCE})`, 'g');

function bareIdentifiersFrom(rawGroup: string): string[] {
  return rawGroup
    .split(',')
    .map((item) => item.trim())
    .filter((item) => BARE_IDENTIFIER_PATTERN.test(item));
}

function escapeRegExpLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function nextHandlerPattern(method: string): RegExp {
  // Safe to interpolate directly: `method` only ever reaches here as one of
  // METHODS_WITH_BODY's own literal members, supplied by this module's own
  // gate below — never raw text read from the target repo.
  return new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}\\s*\\(`);
}

function expressHandlerPattern(method: string, path: string): RegExp {
  return new RegExp(`\\b(?:app|router)\\.${method.toLowerCase()}\\s*\\(\\s*(['"\`])${escapeRegExpLiteral(path)}\\1`);
}

function isolateFunctionBody(sourceCode: string, fromIndex: number): string | null {
  const openBraceIndex = sourceCode.indexOf('{', fromIndex);
  if (openBraceIndex === -1) return null;
  let depth = 0;
  for (let i = openBraceIndex; i < sourceCode.length; i++) {
    if (sourceCode[i] === '{') depth++;
    else if (sourceCode[i] === '}') {
      depth--;
      if (depth === 0) return sourceCode.slice(openBraceIndex, i + 1);
    }
  }
  return null; // never balanced within the file — don't guess with a partial slice
}

function isolateHandlerBody(sourceCode: string, route: RouteEntry): string | null {
  const method = route.method ?? '';

  const nextMatch = sourceCode.match(nextHandlerPattern(method));
  if (nextMatch?.index !== undefined) {
    const body = isolateFunctionBody(sourceCode, nextMatch.index + nextMatch[0].length);
    if (body) return body;
  }

  const expressMatch = sourceCode.match(expressHandlerPattern(method, route.path));
  if (expressMatch?.index !== undefined) {
    return isolateFunctionBody(sourceCode, expressMatch.index + expressMatch[0].length);
  }

  return null;
}

function extractFieldNames(handlerBody: string): string[] {
  const found = new Set<string>();
  for (const m of handlerBody.matchAll(DESTRUCTURE_FROM_JSON_PATTERN)) {
    bareIdentifiersFrom(m[1] ?? '').forEach((name) => found.add(name));
  }
  for (const m of handlerBody.matchAll(DESTRUCTURE_FROM_REQ_BODY_PATTERN)) {
    bareIdentifiersFrom(m[1] ?? '').forEach((name) => found.add(name));
  }
  for (const m of handlerBody.matchAll(PROPERTY_ACCESS_PATTERN)) {
    found.add(m[1]!);
  }
  for (const m of handlerBody.matchAll(CASTED_PROPERTY_ACCESS_PATTERN)) {
    found.add(m[1]!);
  }
  return [...found];
}

export function inferRequestBodyFields(sourceCode: string, route: RouteEntry): string[] {
  if (!METHODS_WITH_BODY.has(route.method ?? '')) return [];
  const handlerBody = isolateHandlerBody(sourceCode, route);
  if (!handlerBody) return [];
  return extractFieldNames(handlerBody);
}
