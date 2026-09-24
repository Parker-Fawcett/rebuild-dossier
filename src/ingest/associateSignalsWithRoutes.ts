import type { RouteEntry } from './evidenceSchema.js';
import type { Signal } from '../reconciliation/types.js';

// Comment signals start out grouped by file only (topicKey `component:<file>`).
// Cases are far more useful — and known-bug matching far more precise — when
// a comment inside a route handler is grouped with that route's own crawl/
// behavioral signals instead. Heuristic: a comment ending on the line directly
// above a registration belongs to it; otherwise the nearest route registration
// at or before the comment's line, within the same file; falls back to the
// first route in the file if the comment precedes all of them.
export function associateSignalsWithRoutes(routes: RouteEntry[], signals: Signal[]): Signal[] {
  const routesByFile = new Map<string, RouteEntry[]>();
  for (const route of routes) {
    if (route.startLine === undefined) continue;
    const list = routesByFile.get(route.file);
    if (list) {
      list.push(route);
    } else {
      routesByFile.set(route.file, [route]);
    }
  }
  for (const list of routesByFile.values()) {
    list.sort((a, b) => a.startLine! - b.startLine!);
  }

  return signals.map((signal) => {
    if (!signal.topicKey.startsWith('component:') || !('file' in signal.locator)) {
      return signal;
    }
    const fileRoutes = routesByFile.get(signal.locator.file);
    if (!fileRoutes || fileRoutes.length === 0) {
      return signal;
    }

    // A comment ending on the line directly above a registration is that
    // route's header ("// Add todo for user by index" over app.post(...)),
    // not a note inside the previous handler. Found live in a cold run: every
    // header comment in an Express app was filed under the route above it.
    const endLine = signal.locator.endLine ?? signal.locator.startLine;
    const headed = fileRoutes.find((route) => route.startLine! === endLine + 1);
    if (headed) {
      return { ...signal, topicKey: `route:${headed.method ?? 'GET'}:${headed.path}` };
    }

    let owner = fileRoutes[0]!;
    for (const route of fileRoutes) {
      if (route.startLine! <= signal.locator.startLine) {
        owner = route;
      } else {
        break;
      }
    }

    return { ...signal, topicKey: `route:${owner.method ?? 'GET'}:${owner.path}` };
  });
}
