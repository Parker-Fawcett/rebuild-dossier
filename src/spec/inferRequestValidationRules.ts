import type { RouteEntry } from '../ingest/evidenceSchema.js';
import { inferRequestBodyFields } from './inferRequestBodyFields.js';
import { isolateHandlerBody } from './isolateHandlerSource.js';
import { findZodSchemasForRoute } from './parseZodObjectSchema.js';

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
// 3. Recognizes three guard shapes: a bare/optionally-chained negated
//    identifier (`!name`, `!name?.trim()`), a `typeof` type-check
//    (`typeof x !== 'string'` — only the negative form; a positive
//    `typeof x === 'string'` as a *rejection* condition is inverted, unusual
//    logic and not recognized), and an explicit non-empty-length check
//    (`x.length === 0`, `x.length < 1` — distinct from `!x.length`, which
//    the negated-identifier pattern already catches via its optional
//    `[?.].*` suffix). Zod object schemas applied to request data are
//    handled separately below (issue #11) — required fields plus custom
//    rejection messages — because recognizing a schema object is
//    structurally different from recognizing a bare guard clause, and
//    Zod-validated handlers rarely contain `if (!x)` guards at all.
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
const TYPEOF_PATTERN = new RegExp(`^typeof\\s+(${IDENTIFIER_SOURCE})\\s*!==?\\s*(['"])(\\w+)\\2$`);
const NON_EMPTY_LENGTH_PATTERN = new RegExp(`^(${IDENTIFIER_SOURCE})\\.length\\s*(?:===\\s*0|<\\s*1)$`);

export interface ValidationRule {
  expression: string; // raw checked-via branch text, shown verbatim
  kind: 'required' | 'type' | 'non-empty';
  expectedType?: string; // only set for kind: 'type' — the literal type name captured from the guard
  message?: string; // custom rejection message captured from a Zod schema
  // argument (`.min(3, 'msg')` / `{ message: 'msg' }`) — carried into the
  // contract so a rebuild reproduces the exact text (issue #11), never
  // asserted against
}

function classifyBranch(branch: string): { field: string; rule: ValidationRule } | null {
  const negated = NEGATED_IDENTIFIER_PATTERN.exec(branch);
  if (negated) return { field: negated[1]!, rule: { expression: branch, kind: 'required' } };

  const typeofMatch = TYPEOF_PATTERN.exec(branch);
  if (typeofMatch) {
    return { field: typeofMatch[1]!, rule: { expression: branch, kind: 'type', expectedType: typeofMatch[3]! } };
  }

  const lengthMatch = NON_EMPTY_LENGTH_PATTERN.exec(branch);
  if (lengthMatch) return { field: lengthMatch[1]!, rule: { expression: branch, kind: 'non-empty' } };

  return null;
}

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

export function inferRequestValidationRules(sourceCode: string, route: RouteEntry): Record<string, ValidationRule> {
  const handlerBody = isolateHandlerBody(sourceCode, route);
  if (!handlerBody) return {};

  const knownFields = new Set(inferRequestBodyFields(sourceCode, route));
  const rules: Record<string, ValidationRule> = {};

  for (const m of handlerBody.matchAll(IF_PATTERN)) {
    const openParenIndex = m.index + m[0].length - 1;
    const cond = isolateParenExpr(handlerBody, openParenIndex);
    if (!cond) continue;

    const block = isolateBraceBlock(handlerBody, cond.endIndex + 1);
    if (!block) continue; // brace-less one-liner — named limitation, not built for
    if (!ERROR_STATUS_PATTERN.test(block)) continue; // not actually a rejection
    if (cond.expr.includes('&&')) continue; // ambiguous at-least-one-of-N semantics — deferred

    for (const branch of cond.expr.split('||').map((b) => b.trim())) {
      const classified = classifyBranch(branch);
      if (!classified) continue;
      if (knownFields.has(classified.field)) rules[classified.field] = classified.rule;
    }
  }

  // Issue #11: Zod schemas applied to request data are declarative required
  // rules with (often custom) rejection messages. They fill gaps the guard
  // scan cannot see — Zod-validated handlers rarely contain `if (!x)`
  // guards — but never override a guard-derived rule, which describes
  // observed handler behavior rather than declared schema. A schema field
  // is trusted here for the same reason parseZodObjectSchema trusts it:
  // the schema is applied to this route's request data.
  for (const schema of findZodSchemasForRoute(sourceCode, route)) {
    for (const field of schema.fields) {
      if (!field.required || rules[field.name]) continue;
      const rule: ValidationRule = { expression: field.expression, kind: 'required' };
      const firstMessage = field.constraints.map((c) => c.message).find((msg) => msg !== undefined);
      if (firstMessage !== undefined) rule.message = firstMessage;
      rules[field.name] = rule;
      knownFields.add(field.name);
    }
  }

  return rules;
}
