import type { RouteEntry } from '../ingest/evidenceSchema.js';
import { isolateHandlerBody } from './isolateHandlerSource.js';

// Shared, best-effort Zod schema parser behind both issue #9 (placeholder
// request bodies must satisfy the route's own required fields) and issue
// #11 (contracts must carry custom error messages). Regex plus brace
// balancing, never a real parser — matching this codebase's existing
// narrow-heuristic style. Documentation and placeholder bodies only; never
// asserted against.
//
// Scope, deliberately narrow:
// - Only `const <name> = z.object({ ... })` literals at file scope.
// - Only schemas actually applied to request data in this route's handler
//   (`<name>.parse(...)` / `.safeParse(...)` / `.asyncParse(...)` /
//   `.safeParseAsync(...)` whose argument mentions req.body, req.json,
//   request.json, or a bare `body` identifier). A schema that exists but is
//   never applied to this route's input is not this route's contract.
// - Only the literal `app`-style precision rule applies here too: a schema
//   field is trusted because the schema is applied to request data, not
//   because its name appeared somewhere.
//
// Known, named limitations (accepted, not oversights):
// 1. Schemas built programmatically (`.extend()`, spread, merged schemas,
//    `z.strictObject` — actually matched, see below — factory functions)
//    are not resolved; only object literals.
// 2. `.optional()` and `.default(...)` mark a field not-required;
//    `.nullable()`/`.nullish()` do not (nullish behaves as optional in Zod
//    4 for input purposes — treated as not-required here to avoid demanding
//    a field the handler legally accepts as absent).
// 3. Custom messages are read from a trailing string literal
//    (`.min(3, 'msg')`) or a `{ message: 'msg' }` / `{ error: 'msg' }`
//    options object. Zod 4's top-level `error:` param style on the schema
//    itself is not read.
// 4. Placeholder bodies are strings regardless of declared type — enough
//    for the dominant string-with-min-length case, insufficient for
//    `.email()`, `.uuid()`, or numeric schemas. Documented at the call
//    site, not solved here.
export interface ZodConstraint {
  method: string; // e.g. 'min', 'max', 'email', 'nonempty'
  rawArgs: string; // verbatim argument text, shown in contracts
  message?: string; // extracted custom error message, when present
}

export interface ZodField {
  name: string;
  required: boolean;
  baseType: string; // e.g. 'string', 'number' — the `z.<type>()` head
  constraints: ZodConstraint[];
  expression: string; // raw chain text, shown verbatim in contracts
}

export interface ZodSchema {
  name: string;
  fields: ZodField[];
}

const IDENTIFIER = '[A-Za-z_$][A-Za-z0-9_$]*';
const SCHEMA_DECL_PATTERN = new RegExp(`(?:const|let|var)\\s+(${IDENTIFIER})\\s*=\\s*z\\.(?:strictO|o)bject\\s*\\(`, 'g');
const PARSE_CALL_PATTERN = new RegExp(`(${IDENTIFIER})\\s*\\.\\s*(?:parse|safeParse|asyncParse|safeParseAsync)\\s*\\(`, 'g');
const REQUEST_DATA_PATTERN = /\breq\.body\b|\breq\.json\s*\(\)|\brequest\.json\s*\(\)|\bbody\b/;

function balanceFrom(source: string, openIndex: number, open: string, close: string): string | null {
  let depth = 0;
  let inStr: string | null = null;
  for (let i = openIndex; i < source.length; i++) {
    const ch = source[i]!;
    if (inStr) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inStr = ch;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return source.slice(openIndex, i + 1);
    }
  }
  return null;
}

function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inStr: string | null = null;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inStr) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inStr = ch;
      continue;
    }
    if (ch === '{' || ch === '(' || ch === '[') depth++;
    else if (ch === '}' || ch === ')' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

function extractMessage(argsText: string): string | undefined {
  // Trailing string literal: .min(3, 'msg') — the last top-level arg, if a
  // quoted string.
  const args = splitTopLevel(argsText);
  const last = args[args.length - 1] ?? '';
  const strMatch = last.match(/^(['"])([\s\S]*)\1$/);
  if (strMatch && args.length > 1) return strMatch[2];
  // Options object: .min(3, { message: 'msg' }) or { error: 'msg' }.
  const objMatch = argsText.match(/\{\s*[^}]*\b(?:message|error)\s*:\s*(['"])([\s\S]*?)\1/);
  if (objMatch) return objMatch[2];
  return undefined;
}

function parseChain(chain: string): { baseType: string; required: boolean; constraints: ZodConstraint[] } {
  const head = chain.match(new RegExp(`^z\\.(${IDENTIFIER})\\s*\\(`));
  const baseType = head ? head[1]! : 'unknown';
  // .optional() / .nullish() / .default(...) mean the key may be absent on
  // input; .nullable() alone still requires presence, so it stays required.
  const required = !/\.(?:optional|nullish)\s*\(\s*\)/.test(chain) && !/\.default\s*\(/.test(chain);
  const constraints: ZodConstraint[] = [];
  const methodPattern = new RegExp(`\\.(${IDENTIFIER})\\s*\\(`, 'g');
  let m: RegExpExecArray | null;
  while ((m = methodPattern.exec(chain)) !== null) {
    const method = m[1]!;
    if (['optional', 'nullable', 'nullish', 'default'].includes(method)) continue;
    const openIndex = m.index + m[0].length - 1;
    const balanced = balanceFrom(chain, openIndex, '(', ')');
    const rawArgs = balanced ? balanced.slice(1, -1) : '';
    const constraint: ZodConstraint = { method, rawArgs };
    const message = extractMessage(rawArgs);
    if (message !== undefined) constraint.message = message;
    constraints.push(constraint);
  }
  return { baseType, required, constraints };
}

function parseFields(objectBody: string): ZodField[] {
  const fields: ZodField[] = [];
  for (const entry of splitTopLevel(objectBody)) {
    const kv = entry.match(new RegExp(`^(['"]?)(${IDENTIFIER})\\1\\s*:`));
    if (!kv) continue;
    const chain = entry.slice(kv[0].length).trim();
    if (!chain.startsWith('z.')) continue;
    const parsed = parseChain(chain);
    fields.push({ name: kv[2]!, required: parsed.required, baseType: parsed.baseType, constraints: parsed.constraints, expression: chain });
  }
  return fields;
}

// All `const X = z.object({...})` literals in the file, with balanced bodies.
function findObjectSchemas(sourceCode: string): ZodSchema[] {
  const schemas: ZodSchema[] = [];
  for (const m of sourceCode.matchAll(SCHEMA_DECL_PATTERN)) {
    const openIndex = m.index + m[0].length - 1;
    const balanced = balanceFrom(sourceCode, openIndex, '(', ')');
    if (!balanced) continue;
    const inner = balanced.slice(1, -1).trim();
    const bodyOpen = inner.indexOf('{');
    if (bodyOpen === -1) continue;
    const body = balanceFrom(inner, bodyOpen, '{', '}');
    if (!body) continue;
    schemas.push({ name: m[1]!, fields: parseFields(body.slice(1, -1)) });
  }
  return schemas;
}

// Schemas from this file that this route's handler actually applies to
// request data — the only ones that count as the route's input contract.
export function findZodSchemasForRoute(sourceCode: string, route: RouteEntry): ZodSchema[] {
  const handlerBody = isolateHandlerBody(sourceCode, route);
  if (!handlerBody) return [];
  const applied = new Set<string>();
  for (const m of handlerBody.matchAll(PARSE_CALL_PATTERN)) {
    const openIndex = m.index + m[0].length - 1;
    const balanced = balanceFrom(handlerBody, openIndex, '(', ')');
    if (!balanced) continue;
    if (REQUEST_DATA_PATTERN.test(balanced)) applied.add(m[1]!);
  }
  if (applied.size === 0) return [];
  return findObjectSchemas(sourceCode).filter((s) => applied.has(s.name));
}

// Names of required fields across this route's applied Zod schemas — the
// fallback body-field source for issue #9 when handler-source extraction
// finds nothing (Zod-validated handlers rarely destructure req.body).
export function inferZodRequiredFields(sourceCode: string, route: RouteEntry): string[] {
  const names: string[] = [];
  for (const schema of findZodSchemasForRoute(sourceCode, route)) {
    for (const field of schema.fields) {
      if (field.required && !names.includes(field.name)) names.push(field.name);
    }
  }
  return names;
}
