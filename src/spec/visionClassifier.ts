import * as z from 'zod/v4';
import { dynamicShapeSchema, type DomTextNode } from './pageCaptureSchema.js';

// Optional, explicitly opt-in enhancement to classifyDomText.ts's regex-only
// classification (see the plan: "Groq vision-assisted DOM-text
// classification"). Real, live-triggered motivation: the regex classifier
// misread a static, hardcoded grading-scale legend as dynamic, and separately
// misread a live, comma-formatted database count as static — the second one
// actually caused a real page's mutation check to land in `unrunnable`. A
// vision-capable model given the page's own screenshot AND source code can
// see *where a value comes from* in a way a bare string never can.
//
// This module is never called unless BOTH `GROQ_API_KEY` and
// `REBUILD_DOSSIER_ENABLE_VISION_CLASSIFICATION=1` are set (see
// generatePageTests.ts) — deliberately not gated on bare API-key presence,
// since an ambient env var someone set for an unrelated tool must never
// silently start sending a target repo's source code and screenshots to a
// third party. When disabled (the default), nothing in this module ever
// runs and classifyDomText.ts's regex classifier is the entire story.
//
// Framed as "confirm or correct the regex's guess," not "classify from
// scratch" — a smaller/faster model is more reliable at a bounded review
// task than open-ended generation, and a confused model that just echoes
// the input back is a no-op (regex baseline preserved), not active
// misclassification.

export const MAX_SOURCE_CHARS_FOR_VISION = 60_000; // Groq's 131K-token context window leaves enormous headroom; this was 8,000 in an earlier draft and was needlessly conservative — see the plan.
export const DEFAULT_GROQ_VISION_MODEL = 'qwen/qwen3.6-27b'; // Groq's own docs note this catalog "changes frequently" — REBUILD_DOSSIER_GROQ_VISION_MODEL overrides this without a code change.
export const VISION_CLASSIFICATION_TIMEOUT_MS = 30_000; // matches page.goto's existing 30000ms convention elsewhere in this module's sibling, generatePageTests.ts
export const MAX_RETRIES_ON_RATE_LIMIT = 1; // one retry, honoring Retry-After, before falling back — Groq's free-tier rate limits are a real, expected condition, not a bug
const MAX_SCREENSHOT_BYTES_FOR_VISION = 15 * 1024 * 1024; // safety margin under Groq's 20MB request cap (base64 adds ~33% overhead on top of this)

// Best-effort, regex-based redaction of obvious hardcoded secrets before
// source code is sent to a third party. Real source files sometimes contain
// accidentally-committed API keys/tokens — a known, common real-world
// problem (this codebase already has a smell detector for one specific
// flavor of it, clientSideSecretGate.ts, for a different purpose: detecting
// a client-side auth bypass, not preventing third-party leakage). This is a
// net, not a guarantee — a regex pass will miss creative/unusual secret
// formats — but it meaningfully reduces the risk of leaking a real
// credential as a side effect of this feature.
const PREFIXED_SECRET_PATTERNS: RegExp[] = [
  /\bsk_[A-Za-z0-9]{10,}\b/g,
  /\bAKIA[A-Z0-9]{16}\b/g,
  /\bghp_[A-Za-z0-9]{30,}\b/g,
  /\bxox[bp]-[A-Za-z0-9-]{10,}\b/g
];

// Matches `apiKey: "..."`, `SECRET = '...'`, etc. — redacts only the quoted
// value, keeping the surrounding declaration readable in the prompt.
const NAMED_SECRET_PATTERN = /((?:api[_-]?key|secret|token|password|passwd)\s*[:=]\s*)(['"`])([^'"`\n]{8,})\2/gi;

export function redactObviousSecrets(sourceCode: string): string {
  let result = sourceCode;
  for (const pattern of PREFIXED_SECRET_PATTERNS) {
    result = result.replace(pattern, '[REDACTED]');
  }
  result = result.replace(NAMED_SECRET_PATTERN, (_match, prefix: string, quote: string) => `${prefix}${quote}[REDACTED]${quote}`);
  return result;
}

// Keeps the *last* MAX_SOURCE_CHARS_FOR_VISION characters, not the first, when
// truncation is needed. In a typical React function component, imports and
// hook/handler declarations sit at the top; the actual JSX `return (...)` —
// where rendered text and its data bindings actually live — sits at the
// bottom. Naive prefix-truncation on a large file would reliably cut off the
// exact section needed to classify anything. A heuristic, not a guarantee
// (a file with render logic before a huge trailing constant table would
// still lose out) — stated as a named limitation, not oversold.
function truncateSourceCode(sourceCode: string): string {
  if (sourceCode.length <= MAX_SOURCE_CHARS_FOR_VISION) return sourceCode;
  const omitted = sourceCode.length - MAX_SOURCE_CHARS_FOR_VISION;
  return `...[${omitted} earlier characters truncated]...\n${sourceCode.slice(-MAX_SOURCE_CHARS_FOR_VISION)}`;
}

function buildPrompt(domOutline: DomTextNode[], sourceCode: string): string {
  const snippetLines = domOutline
    .map((node, i) => {
      const guess = node.kind === 'dynamic' ? `dynamic (${node.dynamicShape})` : 'static';
      return `${i}: ${guess}: ${JSON.stringify(node.text)}`;
    })
    .join('\n');

  return `You are reviewing one page of a real web app to help write an automated content test. You'll see: a screenshot of the rendered page, the page's own source code, and a list of text snippets extracted from the rendered page — each with a first-pass guess from a simple regex, which is often wrong.

For each snippet, decide STATIC or DYNAMIC:
- STATIC: a hardcoded value in the source (a heading, button label, a fixed legend/scale, marketing copy) that reads exactly the same on every load.
- DYNAMIC: computed at runtime, fetched from an API/database, or derived from something like Date.now()/Math.random() — could show a different value on a future load even with nothing in the source changed.

Two calibration examples:
- \`const GRADE_VALUES = [10, 9.5, 9, ...]\` rendered as dropdown options is STATIC — a fixed legend, not live data — even though every value looks like "just a number."
- \`{totalCards.toLocaleString()}\` where totalCards comes from useState/fetch is DYNAMIC — even though it's comma-formatted and doesn't look "computed" from the string alone.

Use the source code to see WHERE each snippet actually comes from: a literal string/array is a strong static signal; a variable set via useState, useEffect, fetch, props, or an API response is a strong dynamic signal. Use the screenshot to confirm you're looking at the right thing in context.

Each snippet's regex guess is given below — trust it unless the source gives you a clear, specific reason to override it.

Snippets (index: regex guess: text):
${snippetLines}

--- PAGE SOURCE ---
${truncateSourceCode(redactObviousSecrets(sourceCode))}

Respond with a JSON object (required — this API call uses JSON mode):
{"classifications": [{"index": 0, "kind": "static"}, {"index": 1, "kind": "dynamic", "dynamicShape": "number"}, ...]}
One entry per snippet, any order (re-sorted by index server-side). dynamicShape is one of: uuid, iso-date, currency, relative-time, number — required when kind is "dynamic", omitted when "static".`;
}

export function buildVisionClassificationRequest(
  screenshotBase64: string,
  domOutline: DomTextNode[],
  sourceCode: string,
  model: string
): Record<string, unknown> {
  return {
    model,
    temperature: 0, // best-effort determinism — reduces, doesn't fully eliminate, run-to-run variance
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: buildPrompt(domOutline, sourceCode) },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${screenshotBase64}` } }
        ]
      }
    ]
  };
}

const groqEnvelopeSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string() })
      })
    )
    .min(1)
});

const classificationEntrySchema = z.object({
  index: z.number().int(),
  kind: z.enum(['static', 'dynamic']),
  dynamicShape: dynamicShapeSchema.optional()
});

const classificationResponseSchema = z.object({
  classifications: z.array(classificationEntrySchema)
});

// Two layers, both validated, both collapsing to null (never throw): the
// outer OpenAI-compatible envelope, then the model's own content string,
// which must itself be JSON. Rejects (returns null) unless every index
// 0..n-1 is present exactly once (protects against a silently dropped or
// reordered entry a length-only check wouldn't catch) and dynamicShape is
// present if and only if kind is 'dynamic'.
export function parseVisionClassificationResponse(
  rawApiResponseJson: unknown,
  domOutline: DomTextNode[]
): Pick<DomTextNode, 'kind' | 'dynamicShape'>[] | null {
  const envelope = groqEnvelopeSchema.safeParse(rawApiResponseJson);
  if (!envelope.success) return null;

  let innerJson: unknown;
  try {
    innerJson = JSON.parse(envelope.data.choices[0]!.message.content);
  } catch {
    return null;
  }

  const parsed = classificationResponseSchema.safeParse(innerJson);
  if (!parsed.success) return null;

  const { classifications } = parsed.data;
  if (classifications.length !== domOutline.length) return null;

  const seenIndices = new Set<number>();
  for (const entry of classifications) {
    if (entry.index < 0 || entry.index >= domOutline.length) return null;
    if (seenIndices.has(entry.index)) return null;
    seenIndices.add(entry.index);
    if (entry.kind === 'static' && entry.dynamicShape !== undefined) return null;
    if (entry.kind === 'dynamic' && entry.dynamicShape === undefined) return null;
  }
  if (seenIndices.size !== domOutline.length) return null;

  const result: Pick<DomTextNode, 'kind' | 'dynamicShape'>[] = new Array(domOutline.length);
  for (const entry of classifications) {
    result[entry.index] = entry.kind === 'dynamic' ? { kind: 'dynamic', dynamicShape: entry.dynamicShape } : { kind: 'static' };
  }
  return result;
}

// The real fetch() call — left untested at the unit level (matching
// generatePageTests.ts's own capturePage precedent for real I/O), except for
// the request/response wiring itself, which is exercised via a mocked
// global.fetch (see visionClassifier.spec.ts).
export async function classifyPageWithVision(
  screenshotBuffer: Buffer,
  domOutline: DomTextNode[],
  sourceCode: string,
  apiKey: string,
  model: string
): Promise<Pick<DomTextNode, 'kind' | 'dynamicShape'>[] | null> {
  if (screenshotBuffer.length > MAX_SCREENSHOT_BYTES_FOR_VISION) return null;

  const screenshotBase64 = screenshotBuffer.toString('base64');
  const body = buildVisionClassificationRequest(screenshotBase64, domOutline, sourceCode, model);

  for (let attempt = 0; attempt <= MAX_RETRIES_ON_RATE_LIMIT; attempt++) {
    let response: Response;
    try {
      response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(VISION_CLASSIFICATION_TIMEOUT_MS)
      });
    } catch {
      return null;
    }

    if (response.status === 429 && attempt < MAX_RETRIES_ON_RATE_LIMIT) {
      const retryAfterHeader = response.headers.get('retry-after');
      const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : 1000;
      await new Promise((resolve) => setTimeout(resolve, Number.isFinite(retryAfterMs) ? retryAfterMs : 1000));
      continue;
    }

    if (!response.ok) return null;

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      return null;
    }

    return parseVisionClassificationResponse(json, domOutline);
  }

  return null;
}
