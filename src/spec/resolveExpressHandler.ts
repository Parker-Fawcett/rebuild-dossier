import { readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import type { RouteEntry } from '../ingest/evidenceSchema.js';

// Follows an Express route's handler to the code that actually runs.
//
// Why: many Express apps register handlers by name and define them elsewhere
// (`router.route('/:id').put(auth, updateRecipe)`, with `updateRecipe` in a
// controllers/ file). The locked contract used to be only that registration
// line, which says nothing about behavior, and the mutation check mutated the
// router file, which has almost nothing to mutate. Found live: a Codex
// rebuild agent refused to build from "contracts [that] specify route
// declarations but no handler behavior", and an earlier all-green rebuild
// broke every caller because it had to guess the behavior.
//
// Static and heuristic: relative require/import bindings only, one level of
// callees, definitions found by the common declaration shapes. Anything it
// can't follow is left out, never guessed.

export interface ResolvedFunction {
  file: string; // repo-relative, posix
  name: string;
  startLine: number;
  source: string;
}

export interface ResolvedHandler extends ResolvedFunction {
  callees: ResolvedFunction[]; // local functions the handler calls, one level
}

const IDENT = String.raw`[A-Za-z_$][\w$]*`;
const MODULE_EXTENSIONS = ['', '.js', '.ts', '.mjs', '.cjs', '.jsx', '.tsx', '/index.js', '/index.ts', '/index.mjs', '/index.cjs'];
const MAX_LINES = 120;
const MAX_CALLEES = 6;

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function read(repoPath: string, file: string): string | null {
  try {
    return readFileSync(join(repoPath, file), 'utf-8');
  } catch {
    return null;
  }
}

function lineAt(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Index of the bracket closing the one at `open`, skipping string literals.
function closing(text: string, open: number): number {
  const pairs: Record<string, string> = { '(': ')', '{': '}', '[': ']' };
  const want = pairs[text[open]!];
  if (!want) return -1;
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i]!;
    if (c === "'" || c === '"' || c === '`') {
      for (i++; i < text.length && text[i] !== c; i++) if (text[i] === '\\') i++;
      continue;
    }
    if (c === text[open]) depth++;
    else if (c === want && --depth === 0) return i;
  }
  return -1;
}

function topLevelArgs(argsText: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < argsText.length; i++) {
    const c = argsText[i]!;
    if (c === "'" || c === '"' || c === '`') {
      for (i++; i < argsText.length && argsText[i] !== c; i++) if (argsText[i] === '\\') i++;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) {
      args.push(argsText.slice(start, i).trim());
      start = i + 1;
    }
  }
  args.push(argsText.slice(start).trim());
  return args.filter(Boolean);
}

function clip(source: string): string {
  const lines = source.split('\n');
  return lines.length > MAX_LINES ? [...lines.slice(0, MAX_LINES), `// ... (${lines.length - MAX_LINES} more lines in the original)`].join('\n') : source;
}

// The full text of a function definition starting at `start`: through the
// body's closing brace, or to the end of an expression-bodied arrow.
function definitionText(text: string, start: number): string | null {
  const arrow = text.indexOf('=>', start);
  const paren = text.indexOf('(', start);
  if (paren === -1) return null;
  const paramsEnd = closing(text, paren);
  if (paramsEnd === -1) return null;
  let i = paramsEnd + 1;
  while (/\s/.test(text[i] ?? '')) i++;
  if (text.startsWith('=>', i)) i += 2;
  else if (arrow !== -1 && arrow < paren) i = arrow + 2; // `x => ...` with no parens
  while (/\s/.test(text[i] ?? '')) i++;
  if (text[i] === '{') {
    const end = closing(text, i);
    return end === -1 ? null : text.slice(start, end + 1);
  }
  const eol = text.indexOf('\n', i);
  return text.slice(start, eol === -1 ? text.length : eol).replace(/;?\s*$/, '');
}

// Where `name` is defined in a file, in the usual shapes.
function findDefinition(text: string, name: string): number {
  const n = escape(name);
  const patterns = [
    new RegExp(String.raw`(?:^|[\s;])(?:export\s+)?(?:async\s+)?function\s*\*?\s*${n}\s*\(`, 'm'),
    new RegExp(String.raw`(?:^|[\s;])(?:export\s+)?(?:const|let|var)\s+${n}\s*=\s*(?:async\s*)?(?:function\b|\(|${IDENT}\s*=>)`, 'm'),
    new RegExp(String.raw`(?:module\.)?exports\.${n}\s*=\s*(?:async\s*)?(?:function\b|\(|${IDENT}\s*=>)`, 'm'),
    new RegExp(String.raw`(?:^|[\s,{])(?:async\s+)?${n}\s*\([^)]*\)\s*\{`, 'm') // method shorthand in an exported object
  ];
  for (const p of patterns) {
    const m = p.exec(text);
    if (m) return m.index + m[0].search(/\S/);
  }
  return -1;
}

function resolveModule(repoPath: string, fromFile: string, specifier: string): string | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const base = posix.join(posix.dirname(fromFile), specifier);
  return MODULE_EXTENSIONS.map((ext) => base + ext).find((c) => isFile(join(repoPath, c)));
}

// Which module (and which export) a local binding comes from.
function bindingSource(text: string, local: string): { specifier: string; exportName: string | 'default' | '*' } | null {
  const l = escape(local);
  const destructured = new RegExp(String.raw`(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\s*\(\s*(['"\x60])([^'"\x60]+)\2\s*\)`, 'g');
  for (const m of text.matchAll(destructured)) {
    for (const part of m[1]!.split(',')) {
      const [exp, alias] = part.split(':').map((x) => x.trim());
      if ((alias ?? exp) === local && exp) return { specifier: m[3]!, exportName: exp };
    }
  }
  const whole = new RegExp(String.raw`(?:const|let|var)\s+${l}\s*=\s*require\s*\(\s*(['"\x60])([^'"\x60]+)\1\s*\)`).exec(text);
  if (whole) return { specifier: whole[2]!, exportName: '*' };
  const named = /import\s*\{([^}]*)\}\s*from\s*(['"])([^'"]+)\2/g;
  for (const m of text.matchAll(named)) {
    for (const part of m[1]!.split(',')) {
      const [exp, alias] = part.split(/\s+as\s+/).map((x) => x.trim());
      if ((alias ?? exp) === local && exp) return { specifier: m[3]!, exportName: exp };
    }
  }
  const star = new RegExp(String.raw`import\s*\*\s*as\s+${l}\s+from\s*(['"])([^'"]+)\1`).exec(text);
  if (star) return { specifier: star[2]!, exportName: '*' };
  const def = new RegExp(String.raw`import\s+${l}\s*(?:,\s*\{[^}]*\})?\s+from\s*(['"])([^'"]+)\1`).exec(text);
  if (def) return { specifier: def[2]!, exportName: 'default' };
  return null;
}

// `name` or `mod.name`, as referenced from `file`, to its definition.
function resolveReference(repoPath: string, file: string, reference: string, depth = 0): ResolvedFunction | null {
  if (depth > 3) return null;
  const text = read(repoPath, file);
  if (text === null) return null;
  const [head, member] = reference.split('.') as [string, string | undefined];

  if (!member) {
    const at = findDefinition(text, head);
    if (at !== -1) {
      const source = definitionText(text, at);
      if (source) return { file, name: head, startLine: lineAt(text, at), source: clip(source) };
    }
  }
  const binding = bindingSource(text, head);
  if (!binding) return null;
  const target = resolveModule(repoPath, file, binding.specifier);
  if (!target) return null;
  const exportName = member ?? (binding.exportName === '*' || binding.exportName === 'default' ? null : binding.exportName);
  if (!exportName) return null;
  const targetText = read(repoPath, target);
  if (targetText === null) return null;
  const at = findDefinition(targetText, exportName);
  if (at !== -1) {
    const source = definitionText(targetText, at);
    if (source) return { file: target, name: exportName, startLine: lineAt(targetText, at), source: clip(source) };
  }
  // Re-exported from further along (`module.exports = { x: require('./y').x }` is rare; `export { x } from './y'` is not).
  const reexport = new RegExp(String.raw`export\s*\{[^}]*\b${escape(exportName)}\b[^}]*\}\s*from\s*(['"])([^'"]+)\1`).exec(targetText);
  if (reexport) {
    const next = resolveModule(repoPath, target, reexport[2]!);
    if (next) return resolveReference(repoPath, next, exportName, depth + 1);
  }
  return null;
}

// The registration call's argument text for this route: the direct
// `x.get('/p', ...)` form or the chained `.route('/p') ... .get(...)` form.
function registrationArgs(text: string, route: RouteEntry): string[] | null {
  const method = (route.method ?? '').toLowerCase();
  const path = escape(route.sourcePath ?? route.path);
  const direct = new RegExp(String.raw`\b${IDENT}\s*\.\s*${method}\s*\(\s*(['"\x60])${path}\1`, 'g');
  const chained = new RegExp(String.raw`\.\s*route\s*\(\s*(['"\x60])${path}\1\s*\)(?:(?!\.\s*route\s*\()[\s\S])*?\.\s*${method}\s*\(`, 'g');
  for (const pattern of [direct, chained]) {
    for (const m of text.matchAll(pattern)) {
      const open = pattern === direct ? text.indexOf('(', m.index! + m[0].indexOf(method) + method.length) : m.index! + m[0].length - 1;
      const close = closing(text, open);
      if (close === -1) continue;
      const args = topLevelArgs(text.slice(open + 1, close));
      return pattern === direct ? args.slice(1) : args;
    }
  }
  return null;
}

const CALL = new RegExp(String.raw`(?<![\w$.])(${IDENT}(?:\.${IDENT})?)\s*\(`, 'g');
const NOT_CALLEES = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'await', 'typeof', 'require', 'new', 'super']);

export function resolveExpressHandler(repoPath: string, route: RouteEntry): ResolvedHandler | null {
  if (route.kind !== 'api') return null;
  const text = read(repoPath, route.file);
  if (text === null) return null;
  const args = registrationArgs(text, route);
  const last = args?.[args.length - 1];
  if (!last) return null;

  let handler: ResolvedFunction | null;
  if (/^(?:async\b|function\b|\(|[A-Za-z_$][\w$]*\s*=>)/.test(last)) {
    handler = { file: route.file, name: '(inline)', startLine: route.startLine ?? 1, source: clip(last) };
  } else if (new RegExp(String.raw`^${IDENT}(?:\.${IDENT})?$`).test(last)) {
    handler = resolveReference(repoPath, route.file, last);
  } else {
    return null;
  }
  if (!handler) return null;

  const callees: ResolvedFunction[] = [];
  const seen = new Set([`${handler.file}#${handler.name}`]);
  for (const m of handler.source.matchAll(CALL)) {
    const ref = m[1]!;
    if (NOT_CALLEES.has(ref.split('.')[0]!) || /^(?:res|req|next|console|JSON|Object|Array|Math|Promise|Number|String|Date|fs|path)\./.test(ref)) continue;
    const callee = resolveReference(repoPath, handler.file, ref);
    if (!callee) continue;
    const key = `${callee.file}#${callee.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    callees.push(callee);
    if (callees.length >= MAX_CALLEES) break;
  }
  return { ...handler, callees };
}

// A handler definition as a function expression, so it can sit inline in a
// synthesized registration: `const x = async (req, res) => {...}` and
// `exports.x = function (req, res) {...}` lose their binding; method
// shorthand (`async x(req, res) {...}`) becomes `async function x(...)`.
function asFunctionExpression(source: string): string | null {
  let s = source.trim().replace(/^export\s+(?:default\s+)?/, '');
  s = s.replace(new RegExp(String.raw`^(?:const|let|var)\s+${IDENT}\s*=\s*`), '');
  s = s.replace(new RegExp(String.raw`^(?:module\.)?exports\.${IDENT}\s*=\s*`), '');
  if (/^(?:async\s+)?function\b/.test(s) || /^(?:async\s*)?\(/.test(s) || new RegExp(String.raw`^(?:async\s+)?${IDENT}\s*=>`).test(s)) return s;
  const shorthand = new RegExp(String.raw`^(async\s+)?(${IDENT})\s*\(`).exec(s);
  return shorthand ? `${shorthand[1] ?? ''}function ${shorthand[2]}(${s.slice(shorthand[0].length)}` : null;
}

// What the source-reading extractors (request fields, success status,
// response fields, validation) should analyze for a route. For a handler
// registered by name, the route file has no body to read, so this returns a
// synthesized `app.<method>('<path as written>', <handler>)` followed by the
// handler file's own text (for helpers it references). Every other route gets
// its own file, unchanged.
export function routeSourceForAnalysis(repoPath: string, route: RouteEntry): string {
  const text = readFileSync(join(repoPath, route.file), 'utf-8');
  const handler = resolveExpressHandler(repoPath, route);
  if (!handler || handler.name === '(inline)') return text;
  const expression = asFunctionExpression(handler.source);
  if (!expression) return text;
  const literal = (route.sourcePath ?? route.path).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return `app.${(route.method ?? 'get').toLowerCase()}('${literal}', ${expression});\n\n${read(repoPath, handler.file) ?? ''}`;
}
