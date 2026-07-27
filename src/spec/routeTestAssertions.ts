import type { RouteEntry } from '../ingest/evidenceSchema.js';
import type { Case } from '../reconciliation/types.js';

// Shared by every generated-test strategy (Express, Next.js API routes, ...) so
// a route's dynamic segments, reconciliation-backed assertions, and filename
// convention stay identical regardless of which framework produced the route.

// HTTP methods that conventionally carry a request body — used to gate both
// "should this generated request include a body" and "should we bother
// trying to infer request-body field names" for a route.
export const METHODS_WITH_BODY = new Set(['POST', 'PUT', 'PATCH']);

// `{}` is a deliberately minimal, generic placeholder when no field names
// could be inferred — matches this file's own `concretePath`'s
// 'test-value-123' placeholder philosophy (a generic, syntactically valid
// stand-in, not an attempt to guess the real semantic value).
export function placeholderBodyLiteral(fields: string[]): string {
  if (fields.length === 0) return '{}';
  return `{ ${fields.map((f) => `${f}: 'test-value-123'`).join(', ')} }`;
}

export function concretePath(path: string): string {
  return path.replace(/:[^/]+/g, 'test-value-123');
}

export function parseExpectedStatus(claim: string): number | null {
  const match = claim.match(/\b([1-5]\d{2})\b/);
  return match ? Number(match[1]) : null;
}

export function reconciliationAssertion(route: RouteEntry, cases: Case[]): { claim: string; status: number } | null {
  const topicKey = `route:${route.method ?? 'GET'}:${route.path}`;
  const kase = cases.find((c) => c.topicKey === topicKey);
  if (!kase) return null;

  const decision = kase.autoResolution?.decision ?? kase.humanDecision?.decision;
  if (decision !== 'intentional') return null; // unknown correct value for a case resolved as a bug — don't fabricate

  for (const signal of kase.signals) {
    const status = parseExpectedStatus(signal.claim);
    if (status !== null) {
      return { claim: signal.claim, status };
    }
  }
  return null;
}

export function sanitizeFilenameBase(method: string | undefined, path: string): string {
  const prefix = method ?? 'PAGE';
  const pathPart = path
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .join('-');
  return `${prefix}-${pathPart || 'root'}`;
}
