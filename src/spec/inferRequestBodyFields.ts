import type { RouteEntry } from '../ingest/evidenceSchema.js';
import { isolateHandlerBody } from './isolateHandlerSource.js';
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
// 5. Chained access with no intermediate variable at all
//    (`(await request.json()).message`) — not recognized; there's no
//    assignment for jsonAssignedVarNames to discover a name from. A
//    differently-named local IS recognized as long as it's the variable
//    `await request.json()`/`await req.json()` is itself assigned to
//    (directly, or via a later plain reassignment of an earlier `let`
//    declaration) — but a second-hop alias off that variable
//    (`const body = await request.json(); const payload = body;
//    payload.message`) is not traced any further and stays unrecognized.
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
// `body` is an extremely common convention, but not the only one a real
// handler uses — traced against this exact real-world regression (a
// same-shaped handler using `raw` instead of `body` for the parsed JSON
// payload) after it silently produced zero fields despite having the
// otherwise-well-supported cast-and-access idiom below. Finds whichever
// identifier a handler actually assigns `await request.json()`/`await
// req.json()` to — via `const`/`let` declaration, or a plain reassignment of
// a variable declared earlier (the real fieldnotes idiom: `let body; try {
// body = await request.json(); } catch {...}`) — and property-access
// matching below runs against every name found this way, `body` included
// unconditionally so the original convention keeps working even when no
// explicit assignment is visible (e.g. it's a function parameter).
const JSON_ASSIGNMENT_PATTERN = new RegExp(
  `(?:^|[\\n;{])\\s*(?:const|let)?\\s*(${IDENTIFIER_SOURCE})\\s*=\\s*await\\s+(?:request|req)\\.json\\(\\)`,
  'g'
);
// `(req.body as ...)` directly (no intermediate variable at all) — a
// realistic Express idiom, found by tracing a live Express fixture during
// verification, kept as its own fixed check since "req" is never itself a
// JSON-assigned local variable the pattern above could discover.
const CASTED_REQ_BODY_PATTERN = new RegExp(`\\(\\s*req\\.body\\s+as\\s+[^)]*\\)\\s*[?!]?\\.(${IDENTIFIER_SOURCE})`, 'g');

function bareIdentifiersFrom(rawGroup: string): string[] {
  return rawGroup
    .split(',')
    .map((item) => item.trim())
    .filter((item) => BARE_IDENTIFIER_PATTERN.test(item));
}

function jsonAssignedVarNames(handlerBody: string): Set<string> {
  const names = new Set<string>(['body']); // conventional name, always checked
  for (const m of handlerBody.matchAll(JSON_ASSIGNMENT_PATTERN)) names.add(m[1]!);
  return names;
}

function extractFieldNames(handlerBody: string): string[] {
  const found = new Set<string>();
  for (const m of handlerBody.matchAll(DESTRUCTURE_FROM_JSON_PATTERN)) {
    bareIdentifiersFrom(m[1] ?? '').forEach((name) => found.add(name));
  }
  for (const m of handlerBody.matchAll(DESTRUCTURE_FROM_REQ_BODY_PATTERN)) {
    bareIdentifiersFrom(m[1] ?? '').forEach((name) => found.add(name));
  }
  for (const varName of jsonAssignedVarNames(handlerBody)) {
    const propertyAccess = new RegExp(`\\b${varName}\\??\\.(${IDENTIFIER_SOURCE})`, 'g');
    for (const m of handlerBody.matchAll(propertyAccess)) found.add(m[1]!);
    // Handles the common strict-TypeScript idiom of narrowing an
    // `unknown`/`any` body before touching a property, e.g. `(body as
    // Record<string, unknown> | null)?.name` — traced directly against the
    // real handler shape that motivated this module; without this pattern
    // the extractor gets zero matches on that exact real-world code.
    const castedPropertyAccess = new RegExp(`\\(\\s*${varName}\\s+as\\s+[^)]*\\)\\s*[?!]?\\.(${IDENTIFIER_SOURCE})`, 'g');
    for (const m of handlerBody.matchAll(castedPropertyAccess)) found.add(m[1]!);
  }
  for (const m of handlerBody.matchAll(CASTED_REQ_BODY_PATTERN)) {
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
