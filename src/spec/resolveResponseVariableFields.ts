import { IDENTIFIER_PATTERN, extractObjectLiteralEntries, findLocalDeclarationExpr } from './inferResponseBodyFields.js';

// Issue #8: a bare-variable response (`res.json(tasks)`) is invisible to
// literal-only extraction, yet it is the dominant shape in database-backed
// handlers (`const tasks = await db.all('SELECT ...'); res.json(tasks)`).
// This module resolves one variable hop: bare identifier → its most recent
// same-handler `const|let` declaration → fields from the initializer.
//
// Resolution order per variable (first hit wins, max 3 alias hops,
// cycle-guarded):
// 1. Object literal initializer → its keys (same honesty bar as literal
//    extraction: the keys are right there in source).
// 2. SQL string in the initializer (`db.all/get/query/execute(...)`,
//    including better-sqlite3's `db.prepare('SELECT ...').get()/.all()`):
//    explicit column lists yield their columns; `SELECT *` falls back to
//    a same-file `CREATE TABLE` scan for the queried table.
// 3. Another bare identifier → follow the alias.
//
// Best-effort, regex-based, documentation-only — never asserted against,
// matching every other inferred-* module. Bail-outs (returning []) rather
// than guesses, throughout.
//
// Known, named limitations (accepted, not oversights):
// 1. Aggregates and expressions (`COUNT(*)`, `MAX(x)`, `a + b`) yield no
//    field — a computed value is not a row field, and inventing one would
//    be fabrication.
// 2. `SELECT *` needs a same-file `CREATE TABLE`; schema defined in
//    another file (a `db.js` the route imports) stays invisible —
//    cross-file resolution is the documented future increment, same as
//    inferResponseBodyFields.ts limitation 1.
// 3. Joins resolve per-table columns independently and union them; name
//    collisions across tables are not disambiguated.
// 4. Only the most recent declaration is traced; reassignment and
//    conditional assignment are not flow-sensitive (same constraint as
//    findLocalDeclarationExpr, which this reuses deliberately).
// 5. Parameter-passed variables (middleware-injected rows) have no local
//    declaration and stay invisible.

const SELECT_PATTERN = /select\s+([\s\S]+?)\s+from\s+/i;
const TABLE_PATTERN = /from\s+["'`\[]?([A-Za-z_$][\w$]*)["'`\]]?/i;
const CREATE_TABLE_PATTERN = /create\s+table\s+(?:if\s+not\s+exists\s+)?["'`\[]?([A-Za-z_$][\w$]*)["'`\]]?\s*\(/gi;
const CONSTRAINT_LEAD = /^(?:constraint|primary\s+key|foreign\s+key)\b|^(?:unique|check|key|index)\s*\(/i;

function stripIdentifier(raw: string): string {
  return raw.trim().replace(/^["'`\[]/, '').replace(/["'`\]]$/, '');
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
    if (ch === '(' || ch === '{' || ch === '[') depth++;
    else if (ch === ')' || ch === '}' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

// First string literal in an expression — the SQL text in
// `db.all('SELECT ...', ...)` and `db.prepare('SELECT ...')` alike.
function firstStringLiteral(expr: string): string | null {
  const m = expr.match(/(['"`])((?:\\\1|(?!\1)[\s\S])*)\1/);
  return m ? m[2]! : null;
}

function columnsFromSelectList(selectList: string): string[] | null {
  const fields: string[] = [];
  for (const item of splitTopLevel(selectList)) {
    const trimmed = item.trim();
    if (trimmed === '*') return null; // caller handles star via CREATE TABLE
    if (/^[A-Za-z_$][\w$]*\.\*$/.test(trimmed)) return null; // t.* — same star problem
    if (trimmed.includes('(')) return null; // aggregate or function call — limitation 1
    const aliased = trimmed.match(/^(.*?)\s+as\s+([A-Za-z_$][\w$]*)$/i);
    if (aliased) {
      fields.push(aliased[2]!);
      continue;
    }
    const qualified = trimmed.match(/^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/);
    if (qualified) {
      fields.push(qualified[2]!);
      continue;
    }
    const bare = trimmed.match(/^([A-Za-z_$][\w$]*)$/);
    if (bare) {
      fields.push(bare[1]!);
      continue;
    }
    return null; // anything exotic poisons the list — bail, don't guess
  }
  return fields;
}

function balanceFrom(source: string, openIndex: number): number {
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
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function columnsFromCreateTable(sourceCode: string, table: string): string[] | null {
  const pattern = new RegExp(
    `create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?["'\`\\[]?${table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'\`\\]]?\\s*\\(`,
    'gi'
  );
  for (const m of sourceCode.matchAll(pattern)) {
    const openIndex = m.index + m[0].length - 1;
    const closeIndex = balanceFrom(sourceCode, openIndex);
    if (closeIndex === -1) continue;
    const fields: string[] = [];
    let valid = true;
    for (const def of splitTopLevel(sourceCode.slice(openIndex + 1, closeIndex))) {
      const trimmed = def.trim();
      if (!trimmed || CONSTRAINT_LEAD.test(trimmed)) continue;
      const name = trimmed.match(/^["'`\[]?([A-Za-z_$][\w$]*)["'`\]]?/);
      if (!name) {
        valid = false;
        break;
      }
      fields.push(stripIdentifier(name[1]!));
    }
    if (valid && fields.length > 0) return fields;
  }
  return null;
}

function fieldsFromSql(sql: string, sourceCode: string): string[] | null {
  if (!/^\s*select\b/i.test(sql)) return null; // INSERT/UPDATE/DELETE results aren't row shapes
  const selectMatch = sql.match(SELECT_PATTERN);
  const tableMatch = sql.match(TABLE_PATTERN);
  if (!selectMatch || !tableMatch) return null;
  const explicit = columnsFromSelectList(selectMatch[1]!);
  if (explicit) return explicit;
  return columnsFromCreateTable(sourceCode, tableMatch[1]!);
}

// Resolve one variable one hop: object literal keys, SQL-derived columns,
// or the next alias in the chain (returned as { alias } for the caller to
// follow, cycle-guarded there).
function resolveOneHop(
  handlerBody: string,
  sourceCode: string,
  varName: string
): { fields: string[] } | { alias: string } | null {
  const init = findLocalDeclarationExpr(handlerBody, varName);
  if (!init) return null;
  const trimmed = init.trim();
  if (trimmed.startsWith('{')) {
    // findLocalDeclarationExpr stops at the first `;`, so an object
    // containing function values truncates — only extract from balanced
    // text, never a partial slice.
    if (!trimmed.endsWith('}')) return null;
    let depth = 0;
    let balanced = true;
    for (const ch of trimmed) {
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth < 0) {
          balanced = false;
          break;
        }
      }
    }
    if (!balanced || depth !== 0) return null;
    const names = extractObjectLiteralEntries(trimmed).map((e) => e.key);
    return names.length > 0 ? { fields: names } : null;
  }
  if (IDENTIFIER_PATTERN.test(trimmed)) return { alias: trimmed };
  const sql = firstStringLiteral(trimmed);
  if (sql) {
    const fields = fieldsFromSql(sql, sourceCode);
    if (fields && fields.length > 0) return { fields };
  }
  return null;
}

export function resolveBareResponseFields(sourceCode: string, handlerBody: string, varName: string): string[] {
  const seen = new Set<string>([varName]);
  let current: string | null = varName;
  for (let hop = 0; hop < 3 && current; hop++) {
    const resolved = resolveOneHop(handlerBody, sourceCode, current);
    if (!resolved) return [];
    if ('fields' in resolved) return resolved.fields;
    if (seen.has(resolved.alias)) return [];
    seen.add(resolved.alias);
    current = resolved.alias;
  }
  return [];
}
