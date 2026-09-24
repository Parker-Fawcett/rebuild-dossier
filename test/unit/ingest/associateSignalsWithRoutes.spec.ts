import { describe, expect, it } from 'vitest';
import { associateSignalsWithRoutes } from '../../../src/ingest/associateSignalsWithRoutes.js';
import type { RouteEntry } from '../../../src/ingest/evidenceSchema.js';
import type { Signal } from '../../../src/reconciliation/types.js';

const now = new Date(0).toISOString();

function commentSignal(file: string, startLine: number): Signal {
  return {
    id: `comment:${file}:${startLine}`,
    source: 'ingest',
    locator: { file, startLine, endLine: startLine },
    topicKey: `component:${file}`,
    claim: 'a comment',
    evidenceText: 'a comment',
    detectedAt: now
  };
}

const routes: RouteEntry[] = [
  { path: '/api/users/:id', method: 'GET', file: 'src/server.ts', kind: 'api', startLine: 6 },
  { path: '/api/users', method: 'POST', file: 'src/server.ts', kind: 'api', startLine: 16 }
];

describe('associateSignalsWithRoutes', () => {
  it('reassigns a comment to the nearest preceding route in the same file', () => {
    const [result] = associateSignalsWithRoutes(routes, [commentSignal('src/server.ts', 8)]);
    expect(result?.topicKey).toBe('route:GET:/api/users/:id');
  });

  it('reassigns a comment after the second route to that route, not the first', () => {
    const [result] = associateSignalsWithRoutes(routes, [commentSignal('src/server.ts', 17)]);
    expect(result?.topicKey).toBe('route:POST:/api/users');
  });

  it('falls back to the first route in the file when the comment precedes every route', () => {
    const [result] = associateSignalsWithRoutes(routes, [commentSignal('src/server.ts', 1)]);
    expect(result?.topicKey).toBe('route:GET:/api/users/:id');
  });

  // Cold-run regression: in an Express app, each "// Add todo ..." header on
  // the line above app.post(...) was filed under the previous route.
  it('assigns a header comment on the line directly above a route to that route', () => {
    const [result] = associateSignalsWithRoutes(routes, [commentSignal('src/server.ts', 15)]);
    expect(result?.topicKey).toBe('route:POST:/api/users');
  });

  it('still assigns a comment two lines above a route to the preceding route', () => {
    const [result] = associateSignalsWithRoutes(routes, [commentSignal('src/server.ts', 14)]);
    expect(result?.topicKey).toBe('route:GET:/api/users/:id');
  });

  it('leaves the topicKey untouched when the file has no detected routes', () => {
    const [result] = associateSignalsWithRoutes(routes, [commentSignal('src/util.ts', 3)]);
    expect(result?.topicKey).toBe('component:src/util.ts');
  });

  it('leaves non-comment (already route-scoped) signals untouched', () => {
    const routeSignal: Signal = {
      id: 'crawl-1',
      source: 'crawl',
      locator: { path: '/api/users', method: 'GET' },
      topicKey: 'route:GET:/api/users',
      claim: 'returns 200',
      evidenceText: 'e',
      detectedAt: now
    };
    const [result] = associateSignalsWithRoutes(routes, [routeSignal]);
    expect(result).toEqual(routeSignal);
  });
});
