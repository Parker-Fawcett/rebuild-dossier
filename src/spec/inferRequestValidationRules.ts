import type { RouteEntry } from '../ingest/evidenceSchema.js';
import { inferRequestBodyFields } from './inferRequestBodyFields.js';
import { isolateHandlerBody } from './isolateHandlerSource.js';

// Best-effort, regex/brace-balancing extraction of required-field validation
// guards from a route handler's own source — companion to
// inferRequestBodyFields.ts, but a genuinely different kind of scan (guard
// structure, not property access), so it lives in its own file. Documentation
// only; never asserted against, matching every other inferred-* section in
// this codebase.
//
// Scoped, deliberately, to exactly the shape that motivated this (see
// docs/v0-findings.md's notarybox blind-rebuild finding):
//
//   if (!name || !message) {
//     return NextResponse.json({ error: '...' }, { status: 400 });
//   }
//
// Known, named limitations (accepted, not oversights):
// 1. Brace-less one-liners (`if (!name) return res.status(400)...;`) are not
//    matched — only accepts a `{` immediately following the condition.
// 2. `&&`-joined conditions (`if (!a && !b)`) are excluded entirely — that's
//    an at-least-one-of-N rule, a different semantic than "each is
//    individually required," and mislabeling it would misrepresent the rule.
// 3. Non-falsy-check guards (`typeof x !== 'string'`, `.length === 0`,
//    Zod/schema validation) are not recognized — only a bare or
//    optionally-chained negated identifier is.
// 4. A guard whose block contains no 4xx status anywhere is not treated as a
//    rejection, so it's excluded even if it negates a known field.
// 5. Only identifiers already present in inferRequestBodyFields's result for
//    this same route are considered — this is the precision guard that
//    stops an unrelated check (e.g. `if (!isAdmin) return ...403...`) from
//    being misreported as a body-field requirement.

const IDENTIFIER_SOURCE = '[A-Za-z_$][A-Za-z0-9_$]*';
const IF_PATTERN = /\bif\s*\(/g;
const ERROR_STATUS_PATTERN = /status\s*:\s*4\d\d|\.status\s*\(\s*4\d\d\s*\)/;
const NEGATED_IDENTIFIER_PATTERN = new RegExp(`^!\\s*(${IDENTIFIER_SOURCE})(?:[?.].*)?$`);

function isolateParenExpr(source: string, openParenIndex: number): { expr: string; endIndex: number } | null {
  let depth = 0;
  for (let i = openParenIndex; i < source.length; i++) {
    if (source[i] === '(') depth++;
    else if (source[i] === ')') {
      depth--;
      if (depth === 0) return { expr: source.slice(openParenIndex + 1, i), endIndex: i };
    }
  }
  return null;
}

// Only accepts the `{` immediately following fromIndex (skipping whitespace
// only) — a brace-less one-liner must not accidentally bind to some later,
// unrelated block.
function isolateBraceBlock(source: string, fromIndex: number): string | null {
  const openBraceIndex = source.indexOf('{', fromIndex);
  if (openBraceIndex === -1) return null;
  if (!/^\s*$/.test(source.slice(fromIndex, openBraceIndex))) return null;
  let depth = 0;
  for (let i = openBraceIndex; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(openBraceIndex, i + 1);
    }
  }
  return null;
}

export function inferRequestValidationRules(sourceCode: string, route: RouteEntry): Record<string, string> {
  const handlerBody = isolateHandlerBody(sourceCode, route);
  if (!handlerBody) return {};

  const knownFields = new Set(inferRequestBodyFields(sourceCode, route));
  if (knownFields.size === 0) return {};

  const rules: Record<string, string> = {};

  for (const m of handlerBody.matchAll(IF_PATTERN)) {
    const openParenIndex = m.index + m[0].length - 1;
    const cond = isolateParenExpr(handlerBody, openParenIndex);
    if (!cond) continue;

    const block = isolateBraceBlock(handlerBody, cond.endIndex + 1);
    if (!block) continue; // brace-less one-liner — named limitation, not built for
    if (!ERROR_STATUS_PATTERN.test(block)) continue; // not actually a rejection
    if (cond.expr.includes('&&')) continue; // ambiguous at-least-one-of-N semantics — deferred

    for (const branch of cond.expr.split('||').map((b) => b.trim())) {
      const negated = NEGATED_IDENTIFIER_PATTERN.exec(branch);
      if (!negated) continue;
      const field = negated[1]!;
      if (knownFields.has(field)) rules[field] = branch;
    }
  }

  return rules;
}
