import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import type { RouteEntry } from '../ingest/evidenceSchema.js';
import {
  extractObjectLiteralEntries,
  findLocalDeclarationExpr,
  findResponseCallArguments,
  formatHintForExpression
} from './inferResponseBodyFields.js';
import { isolateHandlerBody } from './isolateHandlerSource.js';

// Follows exactly ONE level of same-repo relative import to resolve response
// fields for the real, motivating shape inferResponseBodyFields.ts's own
// header names as its single most consequential limitation:
//
//   import { createNote } from '../../../lib/db';
//   export async function POST(request) {
//     return NextResponse.json(createNote(name, message), { status: 201 });
//   }
//
// Documentation only, same as every other inferred-* section — never
// asserted against. Attempted only as a fallback when same-file extraction
// (inferResponseBodyFields) finds nothing, so this never changes behavior
// for a route that already resolves fields today.
//
// Known, named limitations (accepted, not oversights):
// 1. Cross-file request-field extraction and cross-file validation-rule
//    extraction are out of scope here — no confirmed real gap on either
//    side yet (the real motivating app's request fields and validation
//    guard are both same-file already).
// 2. Relative specifiers (`./`, `../`) and tsconfig path aliases (`@/lib/db`,
//    matched against `compilerOptions.paths`) are both resolved; a bare
//    package import (`from 'uuid'`) is left alone. Only the first matching
//    `paths` pattern is tried (not TypeScript's full longest-prefix-wins
//    algorithm across several applicable patterns); a tsconfig.json with
//    comments/trailing commas (real JSONC, not strict JSON) fails to parse
//    and falls through to "not resolved," not a crash; `extends`-based
//    tsconfig inheritance is not followed — only the repo-root
//    tsconfig.json's own `compilerOptions` are read directly.
// 3. CommonJS `require(...)` imports, default-exported callees, and a
//    callee re-exported via a separate `export { name }` statement rather
//    than declared inline are all real but unrecognized shapes.
// 4. Only `export function name(...) {...}` and `export const name = (...)
//    => {...}` (arrow, block body) are recognized — an implicit-return
//    arrow (`export const f = (...) => ({...})`) is a real, separate shape,
//    not built here. A `return someVar;` is traced one level back to its
//    most recent local declaration in the same callee body (a real, common
//    build-then-return shape); a return that traces to another bare
//    identifier, or to no local declaration at all, is not followed further.
// 5. Multiple return sites in the resolved function are unioned together,
//    not distinguished by which one a given call path actually hits — same
//    accepted risk as inferResponseBodyFields.ts's own equivalent
//    limitation.
// 6. Single-hop only — if the resolved callee itself delegates to a third
//    file, that inner call is just another non-literal return expression
//    from this module's point of view, correctly yielding no further
//    fields rather than being followed.

export interface DelegatedResponseFields {
  fields: string[];
  formatHints: Record<string, string>;
  resolvedFrom: { file: string; functionName: string };
}

const BARE_CALL_PATTERN = new RegExp(`^([A-Za-z_$][A-Za-z0-9_$]*)\\s*\\(([\\s\\S]*)\\)$`);
const NAMED_IMPORT_PATTERN = /import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
const ALIASED_IMPORT_NAME_PATTERN = /^([A-Za-z_$][A-Za-z0-9_$]*)\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*)$/;
const CANDIDATE_SUFFIXES = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js', '/index.jsx'];

function detectDelegatedCall(arg: string): { calleeName: string } | null {
  if (arg.startsWith('{')) return null; // a literal — inferResponseBodyFields.ts already handles this
  const m = BARE_CALL_PATTERN.exec(arg.trim());
  return m ? { calleeName: m[1]! } : null;
}

// Returns the real exported name (resolving an alias, e.g. `createNote as
// cn` when called as `cn(...)`) and the raw import specifier — or null if
// no import brings calleeName into scope at all.
function resolveImportSpecifier(fullSource: string, calleeName: string): { specifier: string; realName: string } | null {
  for (const m of fullSource.matchAll(NAMED_IMPORT_PATTERN)) {
    const names = m[1]!.split(',').map((s) => s.trim()).filter(Boolean);
    for (const name of names) {
      const aliasMatch = ALIASED_IMPORT_NAME_PATTERN.exec(name);
      if (aliasMatch && aliasMatch[2] === calleeName) return { specifier: m[2]!, realName: aliasMatch[1]! };
      if (!aliasMatch && name === calleeName) return { specifier: m[2]!, realName: calleeName };
    }
  }
  return null;
}

function firstExistingWithSuffix(base: string): string | null {
  for (const suffix of CANDIDATE_SUFFIXES) {
    const candidate = base + suffix;
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

interface TsconfigPaths {
  baseUrl: string; // resolved, absolute
  paths: Record<string, string[]>;
}

// Returns null on anything that isn't a usable, parseable tsconfig with a
// real `paths` map — including a tsconfig with comments/trailing commas
// (real-world JSONC, not strict JSON), which JSON.parse rejects. Falling
// through to "not resolved" here is the same honest-bail-out philosophy as
// every other extractor in this codebase; it never guesses at a malformed
// config's intent.
function loadTsconfigPaths(repoPath: string): TsconfigPaths | null {
  const tsconfigFile = join(repoPath, 'tsconfig.json');
  if (!existsSync(tsconfigFile)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(tsconfigFile, 'utf-8'));
  } catch {
    return null;
  }
  const compilerOptions = (parsed as { compilerOptions?: unknown } | null)?.compilerOptions as
    | { paths?: unknown; baseUrl?: unknown }
    | undefined;
  const paths = compilerOptions?.paths;
  if (!paths || typeof paths !== 'object') return null;
  const baseUrlRaw = typeof compilerOptions?.baseUrl === 'string' ? compilerOptions.baseUrl : '.';
  return { baseUrl: resolve(repoPath, baseUrlRaw), paths: paths as Record<string, string[]> };
}

// Matches `specifier` against each `paths` pattern in the order they appear
// in the JSON, returning every candidate target for the FIRST matching
// pattern (resolveModuleFile then tries each in turn via
// firstExistingWithSuffix) — not TypeScript's full longest-prefix-wins
// algorithm across multiple applicable patterns, a named, accepted
// simplification. A pattern with no `*` matches only an exact specifier
// (TypeScript's own exact-alias shape, e.g. `"@utils": [...]`); a pattern
// with one `*` matches a prefix/suffix around it and substitutes the
// captured segment into each candidate target's own `*`.
function resolveAliasSpecifier(tsconfig: TsconfigPaths, specifier: string): string[] {
  for (const [pattern, targets] of Object.entries(tsconfig.paths)) {
    const starIndex = pattern.indexOf('*');
    if (starIndex === -1) {
      if (pattern === specifier) return targets.map((t) => join(tsconfig.baseUrl, t));
      continue;
    }
    const prefix = pattern.slice(0, starIndex);
    const suffix = pattern.slice(starIndex + 1);
    if (specifier.startsWith(prefix) && specifier.endsWith(suffix) && specifier.length >= prefix.length + suffix.length) {
      const wildcard = specifier.slice(prefix.length, specifier.length - suffix.length);
      return targets.map((t) => join(tsconfig.baseUrl, t.replace('*', wildcard)));
    }
  }
  return [];
}

function resolveModuleFile(repoPath: string, routeFile: string, specifier: string): string | null {
  if (specifier.startsWith('.')) {
    const routeDir = dirname(join(repoPath, routeFile));
    return firstExistingWithSuffix(resolve(routeDir, specifier));
  }

  const tsconfig = loadTsconfigPaths(repoPath);
  if (!tsconfig) return null; // no tsconfig.json, or no usable `paths` — falls through, same as a bare package import

  for (const base of resolveAliasSpecifier(tsconfig, specifier)) {
    const found = firstExistingWithSuffix(base);
    if (found) return found;
  }
  return null;
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

function escapeRegExpLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findCalleeBody(moduleSource: string, realName: string): string | null {
  const escaped = escapeRegExpLiteral(realName);

  const fnDeclPattern = new RegExp(`export\\s+(?:async\\s+)?function\\s+${escaped}\\s*\\(`);
  const fnMatch = moduleSource.match(fnDeclPattern);
  if (fnMatch?.index !== undefined) {
    const parenOpen = fnMatch.index + fnMatch[0].length - 1;
    const parenClose = isolateBalanced(moduleSource, parenOpen, '(', ')');
    if (parenClose === -1) return null;
    const braceOpen = moduleSource.indexOf('{', parenClose + 1);
    if (braceOpen === -1) return null;
    const braceClose = isolateBalanced(moduleSource, braceOpen, '{', '}');
    return braceClose === -1 ? null : moduleSource.slice(braceOpen, braceClose + 1);
  }

  const arrowPattern = new RegExp(`export\\s+const\\s+${escaped}\\s*=\\s*(?:async\\s*)?\\([^)]*\\)\\s*=>\\s*`);
  const arrowMatch = moduleSource.match(arrowPattern);
  if (arrowMatch?.index !== undefined) {
    let i = arrowMatch.index + arrowMatch[0].length;
    while (/\s/.test(moduleSource[i]!)) i++;
    if (moduleSource[i] !== '{') return null; // implicit-return arrow — named limitation, not built
    const braceClose = isolateBalanced(moduleSource, i, '{', '}');
    return braceClose === -1 ? null : moduleSource.slice(i, braceClose + 1);
  }

  return null;
}

const BARE_RETURN_IDENTIFIER_PATTERN = /^([A-Za-z_$][A-Za-z0-9_$]*)\s*;/;

// Finds every `return { ... };` in the callee body, plus — a real, common
// shape traced live during verification, not assumed in advance — a
// `return someVar;` whose most recent local `const`/`let` declaration in
// the SAME body is itself an object literal (e.g. `const note = {...};
// notes.push(note); return note;`, common when a value is built, used for a
// side effect, then returned). Only one level of tracing, same as
// formatHintForExpression's own aliasing limit — a bare return that traces
// to another bare identifier is not followed further.
function findReturnLiterals(body: string): string[] {
  const literals: string[] = [];
  for (const m of body.matchAll(/\breturn\s*/g)) {
    let i = m.index! + m[0].length;
    while (/\s/.test(body[i]!)) i++;
    if (body[i] === '{') {
      const close = isolateBalanced(body, i, '{', '}');
      if (close !== -1) literals.push(body.slice(i, close + 1));
      continue;
    }
    const idMatch = BARE_RETURN_IDENTIFIER_PATTERN.exec(body.slice(i));
    if (!idMatch) continue;
    const traced = findLocalDeclarationExpr(body, idMatch[1]!);
    if (!traced || !traced.startsWith('{')) continue;
    const close = isolateBalanced(traced, 0, '{', '}');
    if (close === traced.length - 1) literals.push(traced);
  }
  return literals;
}

export function resolveDelegatedResponseFields(
  repoPath: string,
  sourceCode: string,
  route: RouteEntry
): DelegatedResponseFields | null {
  if (route.kind !== 'api') return null;
  const handlerBody = isolateHandlerBody(sourceCode, route);
  if (!handlerBody) return null;

  let calleeName: string | undefined;
  for (const arg of findResponseCallArguments(handlerBody)) {
    const delegated = detectDelegatedCall(arg);
    if (delegated) {
      calleeName = delegated.calleeName;
      break;
    }
  }
  if (!calleeName) return null;

  const imported = resolveImportSpecifier(sourceCode, calleeName);
  if (!imported) return null;

  // resolveModuleFile handles both relative specifiers and tsconfig path
  // aliases, correctly returning null for a bare package import or an
  // unmatched alias — no early bail needed here.
  const moduleFile = resolveModuleFile(repoPath, route.file, imported.specifier);
  if (!moduleFile) return null;

  const moduleSource = readFileSync(moduleFile, 'utf-8');
  const calleeBody = findCalleeBody(moduleSource, imported.realName);
  if (!calleeBody) return null;

  const found = new Set<string>();
  const formatHints: Record<string, string> = {};
  for (const literal of findReturnLiterals(calleeBody)) {
    for (const entry of extractObjectLiteralEntries(literal)) {
      found.add(entry.key);
      const hint = formatHintForExpression(calleeBody, entry.valueExpression);
      if (hint) formatHints[entry.key] = hint;
    }
  }
  if (found.size === 0) return null;

  return {
    fields: [...found],
    formatHints,
    resolvedFrom: { file: relative(repoPath, moduleFile).replace(/\\/g, '/'), functionName: imported.realName }
  };
}
