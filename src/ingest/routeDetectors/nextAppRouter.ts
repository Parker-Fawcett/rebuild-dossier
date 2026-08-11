import { readFileSync } from 'node:fs';
import type { RouteDetector } from './detector.js';
import type { RouteEntry } from '../evidenceSchema.js';
import { toPosixRelative } from '../../util/paths.js';
import { lineNumberAt } from '../../util/lines.js';

// Two valid, common Next.js Route Handler export styles: a function
// declaration (`export async function GET(...)`) and a const arrow function
// (`export const GET = async (...) => {...}`) — the latter was previously
// unmatched entirely, silently detecting 0 API routes for any app using it.
const METHOD_EXPORT_PATTERN =
  /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b|export\s+const\s+(GET|POST|PUT|PATCH|DELETE)\s*=/g;
const DEFAULT_EXPORT_PATTERN = /export\s+default\s+(?:async\s+)?function\b/;

function toRoutePath(rawPath: string): string | null {
  // Both a root-level app/ and the common src/app/ layout are valid Next.js
  // conventions — strip an optional leading src/ before matching.
  const normalized = rawPath.startsWith('src/') ? rawPath.slice('src/'.length) : rawPath;
  if (!normalized.startsWith('app/') && normalized !== 'app') {
    return null;
  }
  const withoutApp = normalized.slice('app/'.length);
  const segments = withoutApp.split('/').slice(0, -1); // drop the filename itself
  const routeSegments = segments
    .filter((segment) => !/^\(.*\)$/.test(segment)) // route groups don't affect the URL
    .map((segment) => {
      const catchAll = segment.match(/^\[\.\.\.(.+)\]$/);
      if (catchAll) return `:${catchAll[1]}`;
      const dynamic = segment.match(/^\[(.+)\]$/);
      if (dynamic) return `:${dynamic[1]}`;
      return segment;
    });
  return routeSegments.length === 0 ? '/' : `/${routeSegments.join('/')}`;
}

export const nextAppRouterDetector: RouteDetector = {
  name: 'next-app-router',

  applies(pkg) {
    return Object.hasOwn(pkg.dependencies, 'next');
  },

  detect(repoPath, filePaths) {
    const routes: RouteEntry[] = [];
    for (const filePath of filePaths) {
      const relPath = toPosixRelative(repoPath, filePath);
      const fileName = relPath.split('/').at(-1) ?? '';
      const routePath = toRoutePath(relPath);
      if (routePath === null) continue;

      if (fileName.startsWith('route.')) {
        const text = readFileSync(filePath, 'utf-8');
        for (const match of text.matchAll(METHOD_EXPORT_PATTERN)) {
          routes.push({
            path: routePath,
            method: (match[1] ?? match[2])!,
            file: relPath,
            kind: 'api' as const,
            startLine: lineNumberAt(text, match.index ?? 0)
          });
        }
      } else if (fileName.startsWith('page.')) {
        const text = readFileSync(filePath, 'utf-8');
        const match = text.match(DEFAULT_EXPORT_PATTERN);
        const startLine = match ? lineNumberAt(text, match.index ?? 0) : 1;
        routes.push({ path: routePath, file: relPath, kind: 'page' as const, startLine });
      }
    }
    return routes;
  }
};
