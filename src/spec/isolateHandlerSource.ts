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

export function isolateHandlerBody(sourceCode: string, route: RouteEntry): string | null {
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
