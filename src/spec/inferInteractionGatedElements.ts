// Best-effort, regex/brace-balancing detection of content that only renders
// after a click this pipeline's page capture never performs — companion to
// inferRequestValidationRules.ts/inferSuccessStatusCode.ts, but for page
// component source (JSX/React state), a genuinely different domain, so it
// lives in its own file. Documentation only, like every other inferred-*
// section in this codebase — never asserted against, and deliberately never
// interacts with the target page itself.
//
// Real motivating shape (see docs/v0-findings.md's stage-4 diagnosis): a
// button whose click sets React state that some other part of the same
// file conditionally renders on:
//
//   const [showResults, setShowResults] = useState(false);
//   <button onClick={() => setShowResults(true)}>Calculate ROI</button>
//   {showResults && (<div>...results...</div>)}
//
// A page's static, no-interaction capture never triggers this click, so a
// mutation to whatever logic determines the gated content has zero effect
// on the generated test — this section exists to tell a rebuild agent that
// plainly, not to fix the underlying capture gap (a real, deliberate design
// decision: interacting with an arbitrary, unknown target app crosses into
// the same risk category this environment's own safety rules gate behind
// explicit human permission — submitting forms, clicking action controls —
// incompatible with a fully-automated tool with no human in the loop at
// click-time).
//
// Known, named limitations (accepted, not oversights):
// 1. Only an inline arrow directly inside `onClick={() => ...}` is
//    recognized — a handler defined separately and referenced by name
//    (`onClick={handleClick}`, a `useCallback`) is a real, common shape,
//    not traced into.
// 2. Only `<button>` elements are recognized — `<input type="submit">`,
//    `role="button"` elements, and `onClick` on other elements are not.
// 3. The cross-reference (does some other part of the file conditionally
//    render on this same state variable?) can over-flag a conditional that
//    already shows real content by default (e.g. `{loading ? <Spinner/> :
//    <RealContent/>}`) — a false positive, low-risk since this is
//    documentation only, never asserted against.
// 4. Naive brace-depth counting doesn't parse string/template literals — a
//    stray brace inside a string constant could in principle throw off
//    isolation. Low-probability, low-consequence (worst case: a
//    missing/extra doc line, never a test failure).

const IDENTIFIER_SOURCE = '[A-Za-z_$][A-Za-z0-9_$]*';
const USE_STATE_PATTERN = new RegExp(
  `const\\s*\\[\\s*(${IDENTIFIER_SOURCE})\\s*,\\s*(${IDENTIFIER_SOURCE})\\s*\\]\\s*=\\s*useState\\(`,
  'g'
);
const BUTTON_OPEN_PATTERN = /<button\b/g;
const ONCLICK_ARROW_PATTERN = /onClick=\{\s*\(\)\s*=>\s*/;

export interface InteractionGatedElement {
  buttonText: string | null;
  gatedStateVars: string[];
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

// Isolates a JSX opening tag's full text, ending at the first unescaped `>`
// at brace-depth 0 — a naive `[^>]+` regex breaks the moment an attribute
// expression contains its own `>` (e.g. a ternary comparison inside
// `style={{...}}`), traced and confirmed necessary before writing this.
function isolateOpeningTag(source: string, tagStartIndex: number): { tagText: string; endIndex: number } | null {
  let depth = 0;
  for (let i = tagStartIndex; i < source.length; i++) {
    const c = source[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return { tagText: source.slice(tagStartIndex, i + 1), endIndex: i };
  }
  return null;
}

function findUseStateMap(source: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of source.matchAll(USE_STATE_PATTERN)) {
    map.set(m[2]!, m[1]!);
  }
  return map;
}

function findOnClickGatedStateVars(tagText: string, setterMap: Map<string, string>): string[] {
  const arrowMatch = ONCLICK_ARROW_PATTERN.exec(tagText);
  if (!arrowMatch) return [];
  const onClickKeywordIndex = tagText.indexOf('onClick=');
  const onClickBraceStart = tagText.indexOf('{', onClickKeywordIndex);
  const onClickBraceEnd = isolateBalanced(tagText, onClickBraceStart, '{', '}');
  if (onClickBraceEnd === -1) return [];
  const body = tagText.slice(onClickBraceStart + 1, onClickBraceEnd);

  const found: string[] = [];
  for (const [setter, stateVar] of setterMap) {
    if (new RegExp(`\\b${setter}\\s*\\(`).test(body)) found.push(stateVar);
  }
  return found;
}

function isGatedElsewhere(source: string, stateVar: string): boolean {
  const andPattern = new RegExp(`\\{\\s*${stateVar}\\s*&&`);
  const ternaryPattern = new RegExp(`\\{\\s*${stateVar}\\s*\\?`);
  return andPattern.test(source) || ternaryPattern.test(source);
}

// Best-effort text extraction between a button's opening and closing tag —
// strips nested JSX tags and `{...}` expressions, matching this codebase's
// existing regex-heuristic text-extraction style (not a real parser).
function extractButtonText(source: string, contentStartIndex: number): string | null {
  const closeTagIndex = source.indexOf('</button>', contentStartIndex);
  if (closeTagIndex === -1) return null;
  const raw = source.slice(contentStartIndex, closeTagIndex);
  const text = raw.replace(/<[^>]+>/g, '').replace(/\{[^}]*\}/g, '').trim();
  return text.length > 0 ? text : null;
}

export function inferInteractionGatedElements(sourceCode: string): InteractionGatedElement[] {
  const setterMap = findUseStateMap(sourceCode);
  if (setterMap.size === 0) return [];

  const results: InteractionGatedElement[] = [];
  for (const m of sourceCode.matchAll(BUTTON_OPEN_PATTERN)) {
    const tag = isolateOpeningTag(sourceCode, m.index);
    if (!tag) continue;

    const gatedStateVars = findOnClickGatedStateVars(tag.tagText, setterMap).filter((v) => isGatedElsewhere(sourceCode, v));
    if (gatedStateVars.length === 0) continue;

    const isSelfClosing = sourceCode[tag.endIndex - 1] === '/';
    const buttonText = isSelfClosing ? null : extractButtonText(sourceCode, tag.endIndex + 1);
    results.push({ buttonText, gatedStateVars });
  }
  return results;
}
