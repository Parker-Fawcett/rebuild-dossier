import type { RouteEntry } from '../ingest/evidenceSchema.js';

// Shared by every static-source-analysis extractor that needs "just this one
// route handler's function body, not the whole file" (inferRequestBodyFields.ts,
// inferResponseBodyFields.ts) — kept in one place so a future fix to isolation
// itself (e.g. better string-literal handling) can't silently diverge between
// consumers that must agree on what "the handler body" means for the same route.

function escapeRegExpLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function nextHandlerPattern(method: string): RegExp {
  // Safe to interpolate directly: callers only ever pass a route's own
  // `method` field here, never raw text read from the target repo.
  return new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}\\s*\\(`);
}

function expressHandlerPattern(method: string, path: string): RegExp {
  return new RegExp(`\\b(?:app|router)\\.${method.toLowerCase()}\\s*\\(\\s*(['"\`])${escapeRegExpLiteral(path)}\\1`);
}

function isolateBalanced(source: string, openIndex: number, openChar: string, closeChar: string): number {
  let depth = 0;
  for (let i = openIndex; i < source.length; i++) {
    if (source[i] === openChar) depth++;
    else if (source[i] === closeChar) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// Real, live-triggered bug (found verifying a Next.js dynamic-route
// fixture, `export async function GET(request, { params }) {...}`, a
// standard App Router idiom): searching for the function body's opening
// brace starting from right after the handler name's own `(` finds the `{`
// of a destructured parameter (`{ params }`) first, since object-destructure
// parameters begin with `{` too — every consumer of isolateHandlerBody was
// silently isolating a 2-token fragment instead of the real body whenever a
// handler destructured a parameter inline. Fixed by explicitly skipping
// past the parameter list's own balanced `(...)` before searching for the
// body's `{`, rather than assuming the first `{` after the match belongs to
// the body.
function skipParameterList(source: string, searchFromIndex: number): number {
  const openParen = source.indexOf('(', searchFromIndex);
  if (openParen === -1) return searchFromIndex;
  const closeParen = isolateBalanced(source, openParen, '(', ')');
  return closeParen === -1 ? searchFromIndex : closeParen + 1;
}

function isolateFunctionBody(sourceCode: string, fromIndex: number): string | null {
  const afterParams = skipParameterList(sourceCode, fromIndex);
  const openBraceIndex = sourceCode.indexOf('{', afterParams);
  if (openBraceIndex === -1) return null;
  const closeBraceIndex = isolateBalanced(sourceCode, openBraceIndex, '{', '}');
  return closeBraceIndex === -1 ? null : sourceCode.slice(openBraceIndex, closeBraceIndex + 1);
}

export function isolateHandlerBody(sourceCode: string, route: RouteEntry): string | null {
  const method = route.method ?? '';

  const nextMatch = sourceCode.match(nextHandlerPattern(method));
  if (nextMatch?.index !== undefined) {
    // nextMatch[0] ends at (and includes) the handler's own opening "(" —
    // back up one character so skipParameterList balances the real
    // parameter list, not a parameter list it hasn't found yet.
    const body = isolateFunctionBody(sourceCode, nextMatch.index + nextMatch[0].length - 1);
    if (body) return body;
  }

  const expressMatch = sourceCode.match(expressHandlerPattern(method, route.path));
  if (expressMatch?.index !== undefined) {
    return isolateFunctionBody(sourceCode, expressMatch.index + expressMatch[0].length);
  }

  return null;
}
