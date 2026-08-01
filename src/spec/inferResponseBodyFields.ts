import type { RouteEntry } from '../ingest/evidenceSchema.js';
import { isolateHandlerBody } from './isolateHandlerSource.js';

// Best-effort, regex-based extraction of response-body field names from a
// route handler's own source — companion to inferRequestBodyFields.ts,
// same narrow-heuristic philosophy, scoped to literal response construction
// in the SAME file only. Extracted names are used ONLY for documentation in
// the generated contract .md — never a new assertion, since a bad
// extraction must never be able to fail a genuinely correct rebuild. Unlike
// the request side, there's no realistic-placeholder use case here either
// (a response is observed, not fabricated by a test), so this module has no
// effect on generated test content at all.
//
// Known, named limitations (accepted, confirmed scope, not oversights):
// 1. Response built by calling a separate function is invisible
//    (`NextResponse.json(createNote(name, message))`,
//    `NextResponse.json(listNotes())`) — the single most consequential
//    limitation. A future increment could resolve one level of import and
//    parse the called function's return statement or an explicit
//    TypeScript return-type interface — real follow-up work, not built
//    here; cross-file resolution is a materially bigger, riskier increment
//    than same-file extraction.
// 2. A bare variable/array response (`NextResponse.json(rows)`) is
//    invisible for the same reason.
// 3. Multiple return sites in one handler (e.g. an early error response
//    and a later success response) have their fields unioned together, not
//    distinguished by status code — still more informative than nothing,
//    and the doc section's own "best-effort, not verified" framing already
//    sets that expectation.
// 4. Spread-only entries (`{ ...note, extra: true }` only captures
//    `extra`), computed/bracket-notation keys (`{ [key]: value }`), and
//    quoted-string keys (`{ 'name': value }`) are all dropped — same
//    accepted-risk category as inferRequestBodyFields.ts's equivalent
//    limitations.
// 5. Naive bracket-depth counting doesn't parse string/template literals —
//    a stray bracket character inside a string value could in principle
//    throw off argument/entry boundaries. Low-probability, low-consequence
//    (worst case: a missing/extra doc line — this module never touches
//    test assertions at all).
// 6. Only recognizes the conventional `NextResponse`/`Response`/`res`
//    receiver names — a differently-named response object is invisible.

const IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const RESPONSE_CALL_PATTERN = /\b(?:NextResponse|Response|res)\.(?:status\([^)]*\)\.)?json\s*\(/g;

function findMatchingClose(text: string, openIndex: number, openChar: string, closeChar: string): number {
  let depth = 0;
  for (let i = openIndex; i < text.length; i++) {
    if (text[i] === openChar) depth++;
    else if (text[i] === closeChar) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// `callOpenIndex` is the position of the call's own opening "(". Returns the
// first top-level argument's raw text (trimmed), tracking depth across
// (){}[] so a nested object/array/call in the argument doesn't get mistaken
// for the boundary between argument 1 and a second `{ status: ... }` arg.
function firstArgument(text: string, callOpenIndex: number): string | null {
  let depth = 0;
  const start = callOpenIndex + 1;
  for (let i = callOpenIndex; i < text.length; i++) {
    const c = text[i];
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') {
      depth--;
      if (depth === 0) return text.slice(start, i).trim(); // reached the call's own closing paren
    } else if (c === ',' && depth === 1) {
      return text.slice(start, i).trim();
    }
  }
  return null;
}

function splitTopLevelEntries(inner: string): string[] {
  const entries: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') depth--;
    else if (c === ',' && depth === 0) {
      entries.push(inner.slice(start, i).trim());
      start = i + 1;
    }
  }
  const last = inner.slice(start).trim();
  if (last) entries.push(last);
  return entries;
}

function topLevelColonIndex(entry: string): number {
  let depth = 0;
  for (let i = 0; i < entry.length; i++) {
    const c = entry[i];
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') depth--;
    else if (c === ':' && depth === 0) return i;
  }
  return -1;
}

interface ObjectLiteralEntry {
  key: string;
  // For a shorthand property this equals `key` itself; for a keyed property
  // it's the text after the top-level colon. Shared by inferResponseBodyFields
  // (uses only .key, unchanged public behavior) and
  // inferResponseValueFormatHints (uses .valueExpression too) — kept in one
  // place so the two never silently diverge on what counts as an entry.
  valueExpression: string;
}

function extractObjectLiteralEntries(literalText: string): ObjectLiteralEntry[] {
  const inner = literalText.slice(1, -1); // strip outer { }
  const entries: ObjectLiteralEntry[] = [];
  for (const entry of splitTopLevelEntries(inner)) {
    if (entry.startsWith('...')) continue; // spread — no key name available
    const colonIndex = topLevelColonIndex(entry);
    if (colonIndex === -1) {
      if (IDENTIFIER_PATTERN.test(entry)) entries.push({ key: entry, valueExpression: entry }); // shorthand property
      continue;
    }
    const key = entry.slice(0, colonIndex).trim();
    if (IDENTIFIER_PATTERN.test(key)) {
      entries.push({ key, valueExpression: entry.slice(colonIndex + 1).trim() }); // drops computed/quoted-string keys
    }
  }
  return entries;
}

// Shared by both public functions below: finds every response-construction
// call in the handler body and returns each one's literal-object argument's
// entries (skipping non-literal/unbalanced arguments the same way both
// callers already did independently before this refactor).
function literalEntriesFromResponseCalls(handlerBody: string): ObjectLiteralEntry[] {
  const entries: ObjectLiteralEntry[] = [];
  for (const m of handlerBody.matchAll(RESPONSE_CALL_PATTERN)) {
    const callOpenIndex = m.index + m[0].length - 1; // position of the call's own "("
    const arg = firstArgument(handlerBody, callOpenIndex);
    if (!arg || !arg.startsWith('{')) continue; // not a literal — honest bail-out, not a guess
    const closeIndex = findMatchingClose(arg, 0, '{', '}');
    if (closeIndex !== arg.length - 1) continue; // unbalanced — don't guess with a partial slice
    entries.push(...extractObjectLiteralEntries(arg));
  }
  return entries;
}

export function inferResponseBodyFields(sourceCode: string, route: RouteEntry): string[] {
  if (route.kind !== 'api') return [];
  const handlerBody = isolateHandlerBody(sourceCode, route);
  if (!handlerBody) return [];
  const found = new Set<string>();
  literalEntriesFromResponseCalls(handlerBody).forEach((entry) => found.add(entry.key));
  return [...found];
}

// Companion to inferResponseBodyFields above — same scope, same source, same
// "documentation only, never asserted" philosophy, but answers a different
// question: not just that a field exists, but how its value is actually
// produced (e.g. `created_at` via `new Date().toISOString()`). Shows the
// real source expression verbatim — no curated pattern classifier, no
// guessing at meaning — matching generateContracts.ts's own "verbatim from
// source, never a paraphrase" philosophy (sourceLine).
//
// Additional named limitations beyond inferResponseBodyFields's own list:
// 7. A shorthand/bare-identifier value is traced back to its most recent
//    `const`/`let` declaration in the SAME handler — a later plain
//    reassignment (`created_at = ...;` without a keyword) isn't tracked,
//    since JS doesn't repeat the keyword on reassignment and distinguishing
//    "reassigned before this point" from "reassigned after" would need real
//    control-flow analysis.
// 8. Only one level of variable aliasing is resolved — if the traced
//    expression is itself just another bare identifier, no hint is shown
//    (an alias name alone isn't informative over the field name itself).
// 9. A field whose value is a plain literal (a number, string, boolean, or
//    null/undefined) never gets a hint — "computed as: `1`" isn't a format
//    worth documenting.
const TRIVIAL_LITERAL_PATTERN = /^(?:-?\d+(\.\d+)?|(['"`]).*\2|true|false|null|undefined)$/;

function isTrivialLiteral(expr: string): boolean {
  return TRIVIAL_LITERAL_PATTERN.test(expr.trim());
}

function escapeRegExpLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findLocalDeclarationExpr(handlerBody: string, varName: string): string | null {
  const pattern = new RegExp(`(?:const|let)\\s+${escapeRegExpLiteral(varName)}\\s*=\\s*([^;]+);`, 'g');
  let lastMatch: RegExpExecArray | null = null;
  for (const m of handlerBody.matchAll(pattern)) lastMatch = m;
  return lastMatch ? lastMatch[1]!.trim() : null;
}

function formatHintForExpression(handlerBody: string, valueExpression: string): string | undefined {
  let expr = valueExpression;
  if (IDENTIFIER_PATTERN.test(expr)) {
    const traced = findLocalDeclarationExpr(handlerBody, expr);
    if (!traced) return undefined; // no local declaration found (e.g. destructured from the request, a param) — nothing to show
    expr = traced;
    if (IDENTIFIER_PATTERN.test(expr)) return undefined; // still just an alias after one level — not informative enough to show
  }
  if (isTrivialLiteral(expr)) return undefined;
  return expr;
}

export function inferResponseValueFormatHints(sourceCode: string, route: RouteEntry): Record<string, string> {
  if (route.kind !== 'api') return {};
  const handlerBody = isolateHandlerBody(sourceCode, route);
  if (!handlerBody) return {};
  const hints: Record<string, string> = {};
  for (const entry of literalEntriesFromResponseCalls(handlerBody)) {
    const hint = formatHintForExpression(handlerBody, entry.valueExpression);
    if (hint) hints[entry.key] = hint; // last write wins across multiple return sites, same as field-name unioning elsewhere in this file
  }
  return hints;
}
