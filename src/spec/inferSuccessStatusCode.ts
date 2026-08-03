import type { RouteEntry } from '../ingest/evidenceSchema.js';
import { isolateHandlerBody } from './isolateHandlerSource.js';

// Best-effort extraction of the status code a route handler returns on its
// success path — closes the gap named by the notarybox blind-rebuild
// experiment: nothing in this pipeline captured "this route should return
// 201," so a rebuild that silently defaults to 200 passed the only
// generated assertion (`res.status < 500`). Unlike the field/format/
// validation extractors, a wrong guess here is directly test-facing (see
// generateNextApiTests.ts/generateTests.ts), so this only ever produces a
// signal when there is exactly ONE unconditional (non-guarded) response
// call in the handler — any ambiguity bails to `null`, never a guess.
//
// A response call is "guarded" (excluded as a candidate success path) when
// it's nested inside an `if`, `else`, or `catch` block — the real,
// motivating shape (`try { ... } catch { return ...400...; } if (!x) {
// return ...400...; } return ...201...;`) needs both recognized: the catch
// block is the JSON-parse-failure path, the if-guard is the validation
// path, and the final, unnested return is the real success path.
//
// Known, named limitations (accepted, not oversights):
// 1. Same-file only — no cross-file resolution (matches how response-field
//    extraction itself started; cross-file success-status resolution is
//    real, separate follow-up work, not built here).
// 2. Only `if`/`else`/`catch` are recognized as guards — a return inside a
//    `for`/`while`/`switch` is not excluded, so a handler using one of
//    those shapes for its returns is more likely to look "ambiguous" (2+
//    candidates) than to produce a wrong answer — safe, just less useful.
// 3. No explicit status option (`NextResponse.json(body)`, `res.json(...)`
//    with no `.status()`) is treated as an implicit `200` — genuinely how
//    both frameworks behave, not a guess.
// 4. Same accepted risk as reconciliationAssertion's existing status
//    assertion: the generated smoke test's placeholder body may not
//    satisfy every validation rule a real handler enforces (e.g. a
//    length/format check this pipeline doesn't detect), which could in
//    rare cases make this assertion fail against a genuinely correct
//    rebuild. Not a new risk category — already accepted for reconciliation
//    today, and this only fires under a strictly narrower, higher-
//    confidence condition (exactly one unconditional candidate).

export interface SuccessStatusSignal {
  status: number;
  claim: string;
}

const RESPONSE_CALL_PATTERN = /\b(?:NextResponse|Response|res)\.(?:status\((\d+)\)\.)?json\s*\(/g;
const GUARD_KEYWORD_PATTERN = /\b(?:if|catch)\s*(\()?/g;
const ELSE_BLOCK_PATTERN = /\}\s*else\s*\{/g;

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

// Every `if (...) { ... }`, `catch (e) { ... }`/`catch { ... }`, and
// `} else { ... }` block's brace range — a response call whose index falls
// inside any of these is a guarded, non-candidate return.
function findGuardedRanges(body: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];

  for (const m of body.matchAll(GUARD_KEYWORD_PATTERN)) {
    let searchFrom = m.index! + m[0].length;
    if (m[1]) {
      const openParen = m.index! + m[0].length - 1;
      const closeParen = isolateBalanced(body, openParen, '(', ')');
      if (closeParen === -1) continue;
      searchFrom = closeParen + 1;
    }
    const braceOpen = body.indexOf('{', searchFrom);
    if (braceOpen === -1 || !/^\s*$/.test(body.slice(searchFrom, braceOpen))) continue;
    const braceClose = isolateBalanced(body, braceOpen, '{', '}');
    if (braceClose !== -1) ranges.push([braceOpen, braceClose]);
  }

  for (const m of body.matchAll(ELSE_BLOCK_PATTERN)) {
    const braceOpen = m.index! + m[0].length - 1;
    const braceClose = isolateBalanced(body, braceOpen, '{', '}');
    if (braceClose !== -1) ranges.push([braceOpen, braceClose]);
  }

  return ranges;
}

function isInsideAnyRange(index: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([start, end]) => index > start && index < end);
}

// `m[1]` is set for the `res.status(N).json(` form. Otherwise, parses the
// call's second top-level argument (`{ status: N }`) — defaulting to 200
// when there's no second argument at all, matching real framework behavior.
function statusForMatch(body: string, m: RegExpMatchArray): number {
  if (m[1]) return Number(m[1]);

  const callOpenIndex = m.index! + m[0].length - 1;
  let depth = 0;
  let argStart = callOpenIndex + 1;
  const args: string[] = [];
  for (let i = callOpenIndex; i < body.length; i++) {
    const c = body[i];
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') {
      depth--;
      if (depth === 0) {
        args.push(body.slice(argStart, i).trim());
        break;
      }
    } else if (c === ',' && depth === 1) {
      args.push(body.slice(argStart, i).trim());
      argStart = i + 1;
    }
  }
  if (args.length < 2) return 200;
  const statusMatch = /status\s*:\s*(\d+)/.exec(args[1]!);
  return statusMatch ? Number(statusMatch[1]) : 200;
}

export function inferSuccessStatusCode(sourceCode: string, route: RouteEntry): SuccessStatusSignal | null {
  if (route.kind !== 'api') return null;
  const handlerBody = isolateHandlerBody(sourceCode, route);
  if (!handlerBody) return null;

  const guardedRanges = findGuardedRanges(handlerBody);
  const candidates: number[] = [];
  for (const m of handlerBody.matchAll(RESPONSE_CALL_PATTERN)) {
    if (isInsideAnyRange(m.index!, guardedRanges)) continue;
    candidates.push(statusForMatch(handlerBody, m));
  }
  if (candidates.length !== 1) return null;

  const status = candidates[0]!;
  return { status, claim: `returns ${status} on success` };
}
