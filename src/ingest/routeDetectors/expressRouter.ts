import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { RouteDetector } from './detector.js';
import type { RouteEntry } from '../evidenceSchema.js';
import { toPosixRelative } from '../../util/paths.js';
import { lineNumberAt } from '../../util/lines.js';

// Express route registrations, found by pattern rather than by running the app.
//
// Three shapes, the last two added after a cold run of docs/validators.md on an
// unfamiliar Express app found 3 of its 8 routes:
//   1. `<instance>.get('/path', ...)` (and post/put/patch/delete);
//   2. chained `<instance>.route('/path').get(h).post(h)`, which the original
//      single regex never matched (all five of that app's recipe routes);
//   3. mount prefixes: `app.use('/api/v1/users', usersRouter)` makes a router
//      file's `/signup` really `/api/v1/users/signup`. Without it, generated
//      tests hit a path that 404s, and a 404 still passes "status < 500".
// `<instance>` is `app`, `router`, or any identifier the same file assigns
// from `express()` / `express.Router()` / `Router()`. Nothing else, so calls
// like `axios.get('/x')` or `cache.delete('k')` are never mistaken for routes.
const METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);
const IDENT = String.raw`[A-Za-z_$][\w$]*`;
const DIRECT_CALL = new RegExp(String.raw`\b(${IDENT})\s*\.\s*(get|post|put|patch|delete)\s*\(\s*(['"\x60])([^'"\x60]+)\3`, 'g');
const ROUTE_CALL = new RegExp(String.raw`\b(${IDENT})\s*\.\s*route\s*\(\s*(['"\x60])([^'"\x60]+)\2\s*\)`, 'g');
const USE_CALL = new RegExp(String.raw`\b(${IDENT})\s*\.\s*use\s*\(\s*(['"\x60])(\/[^'"\x60]*)\2\s*,`, 'g');
const INSTANCE_DECL = new RegExp(String.raw`\b(?:const|let|var)\s+(${IDENT})\s*=\s*(?:express\s*\(|(?:express\s*\.\s*)?Router\s*\()`, 'g');
const CHAIN_STEP = new RegExp(String.raw`^\s*\.\s*(${IDENT})\s*\(`);
const REQUIRE_EXPR = /^require\s*\(\s*(['"`])([^'"`]+)\1\s*\)$/;
const SOURCE_EXTENSIONS = ['', '.js', '.ts', '.mjs', '.cjs', '/index.js', '/index.ts', '/index.mjs', '/index.cjs'];

interface RawRoute {
  path: string;
  method: string;
  startLine: number;
}

interface Mount {
  parentFile: string;
  prefix: string;
  childFile: string;
}

// Index of the `)` closing the `(` at `open`, skipping string literals; -1 if unbalanced.
function matchParen(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i]!;
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      for (i++; i < text.length && text[i] !== quote; i++) if (text[i] === '\\') i++;
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return i;
  }
  return -1;
}

// The last top-level argument of a call's argument text (commas inside
// nested calls, arrays and objects don't split).
function lastArgument(argsText: string): string {
  let depth = 0;
  let start = 0;
  for (let i = 0; i < argsText.length; i++) {
    const c = argsText[i]!;
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      for (i++; i < argsText.length && argsText[i] !== quote; i++) if (argsText[i] === '\\') i++;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) start = i + 1;
  }
  return argsText.slice(start).trim();
}

export function joinRoutePath(prefix: string, path: string): string {
  const joined = `${prefix}/${path}`.replace(/\/+/g, '/');
  return joined.length > 1 ? joined.replace(/\/$/, '') : joined;
}

function instanceNames(text: string): Set<string> {
  const names = new Set(['app', 'router']);
  for (const m of text.matchAll(INSTANCE_DECL)) names.add(m[1]!);
  return names;
}

function rawRoutes(text: string, instances: Set<string>): RawRoute[] {
  const routes: RawRoute[] = [];
  for (const m of text.matchAll(DIRECT_CALL)) {
    if (!instances.has(m[1]!)) continue;
    routes.push({ path: m[4]!, method: m[2]!.toUpperCase(), startLine: lineNumberAt(text, m.index ?? 0) });
  }
  for (const m of text.matchAll(ROUTE_CALL)) {
    if (!instances.has(m[1]!)) continue;
    let i = (m.index ?? 0) + m[0].length;
    for (;;) {
      const step = CHAIN_STEP.exec(text.slice(i));
      if (!step) break;
      const name = step[1]!.toLowerCase();
      const open = i + step[0].length - 1;
      const close = matchParen(text, open);
      if (close < 0) break;
      if (METHODS.has(name)) {
        routes.push({ path: m[3]!, method: name.toUpperCase(), startLine: lineNumberAt(text, i + step[0].indexOf(step[1]!)) });
      }
      i = close + 1;
    }
  }
  return routes.sort((a, b) => a.startLine - b.startLine);
}

function resolveModule(fromFile: string, specifier: string, known: Set<string>): string | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const base = resolve(dirname(fromFile), specifier);
  for (const ext of SOURCE_EXTENSIONS) {
    const candidate = base + ext;
    if (known.has(candidate)) return candidate;
  }
  return undefined;
}

// `const usersRouter = require('./routers/usersRouter')` or
// `import usersRouter from './routers/usersRouter.js'`.
function bindingSpecifier(text: string, name: string): string | undefined {
  const req = new RegExp(String.raw`\b(?:const|let|var)\s+${name}\s*=\s*require\s*\(\s*(['"\x60])([^'"\x60]+)\1\s*\)`).exec(text);
  if (req) return req[2];
  const imp = new RegExp(String.raw`\bimport\s+${name}\s+from\s+(['"])([^'"]+)\1`).exec(text);
  return imp?.[2];
}

function mountsIn(file: string, text: string, instances: Set<string>, known: Set<string>): Mount[] {
  const mounts: Mount[] = [];
  for (const m of text.matchAll(USE_CALL)) {
    if (!instances.has(m[1]!)) continue;
    const open = text.indexOf('(', (m.index ?? 0) + m[1]!.length);
    const close = matchParen(text, open);
    if (close < 0) continue;
    const last = lastArgument(text.slice((m.index ?? 0) + m[0].length, close));
    const inline = REQUIRE_EXPR.exec(last);
    const specifier = inline ? inline[2] : new RegExp(String.raw`^${IDENT}$`).test(last) ? bindingSpecifier(text, last) : undefined;
    const childFile = specifier ? resolveModule(file, specifier, known) : undefined;
    if (childFile && childFile !== file) mounts.push({ parentFile: file, prefix: m[3]!, childFile });
  }
  return mounts;
}

// Every full prefix a file's routes are served under ('' when never mounted).
function prefixesFor(file: string, mounts: Mount[], depth = 0): string[] {
  const incoming = mounts.filter((m) => m.childFile === file);
  if (incoming.length === 0 || depth > 8) return [''];
  const out = new Set<string>();
  for (const m of incoming) for (const p of prefixesFor(m.parentFile, mounts, depth + 1)) out.add(joinRoutePath(p, m.prefix));
  return [...out];
}

export const expressRouterDetector: RouteDetector = {
  name: 'express',

  applies(pkg) {
    return Object.hasOwn(pkg.dependencies, 'express');
  },

  detect(repoPath, filePaths) {
    const known = new Set(filePaths.map((f) => resolve(f)));
    const parsed = filePaths.map((filePath) => {
      const text = readFileSync(filePath, 'utf-8');
      const instances = instanceNames(text);
      return { filePath: resolve(filePath), text, instances };
    });
    const mounts = parsed.flatMap((p) => mountsIn(p.filePath, p.text, p.instances, known));

    const routes: RouteEntry[] = [];
    for (const { filePath, text, instances } of parsed) {
      const relPath = toPosixRelative(repoPath, filePath);
      const prefixes = prefixesFor(filePath, mounts);
      for (const route of rawRoutes(text, instances)) {
        for (const prefix of prefixes) {
          routes.push({
            path: prefix ? joinRoutePath(prefix, route.path) : route.path,
            method: route.method,
            file: relPath,
            kind: 'api',
            startLine: route.startLine
          });
        }
      }
    }
    return routes;
  }
};
