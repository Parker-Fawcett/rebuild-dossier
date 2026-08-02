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
// 2. Only relative specifiers (`./`, `../`) are resolved — a bare package
//    import (`from 'uuid'`) or a tsconfig path alias (`from '@/lib/db'`) is
//    left alone. Path-alias resolution is a real, separate feature
//    (parsing and matching tsconfig's glob-based `paths` mappings).
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

function resolveModuleFile(repoPath: string, routeFile: string, specifier: string): string | null {
  const routeDir = dirname(join(repoPath, routeFile));
  const base = resolve(routeDir, specifier);
  for (const suffix of CANDIDATE_SUFFIXES) {
    const candidate = base + suffix;
    if (existsSync(candidate)) return candidate;
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
  if (!imported.specifier.startsWith('.')) return null; // bare package / path alias — not resolved

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
    resolvedFrom: { file: relative(repoPath, moduleFile), functionName: imported.realName }
  };
}
