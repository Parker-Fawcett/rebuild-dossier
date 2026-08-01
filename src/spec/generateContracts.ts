import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RouteEntry } from '../ingest/evidenceSchema.js';
import type { AssetManifestEntry } from './assetManifestSchema.js';
import type { PageStylesheetAnimations, SkippedPage } from './generatePageTests.js';
import { inferRequestBodyFields } from './inferRequestBodyFields.js';
import { inferResponseBodyFields, inferResponseValueFormatHints } from './inferResponseBodyFields.js';
import { METHODS_WITH_BODY } from './routeTestAssertions.js';

export interface GeneratedFile {
  filename: string;
  content: string;
}

// Exported so other generators (spec-auditor, verify-against-spec) can
// cross-reference the exact contract filename a route maps to, instead of
// telling an agent to go rediscover the mapping itself.
export function contractFilename(method: string | undefined, path: string): string {
  const prefix = method ?? 'PAGE';
  const pathPart = path
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .join('-');
  return `${prefix}-${pathPart || 'root'}.md`;
}

// Unguarded, deliberately: writeSpecTree.ts relies on a route pointing at a
// nonexistent file throwing a real error partway through generation (see its
// "never leaves a partial output directory behind" test) — this function
// must keep propagating a real read failure, not swallow it.
function sourceLine(repoPath: string, route: RouteEntry): string {
  if (route.startLine === undefined) return '(source line unavailable)';
  const text = readFileSync(join(repoPath, route.file), 'utf-8');
  const line = text.split('\n')[route.startLine - 1];
  return line?.trim() ?? '(source line unavailable)';
}

// Best-effort documentation only — see inferRequestBodyFields.ts's own
// header for the full accepted-risk list. Never asserted against; a blind
// rebuild agent reads this section directly instead of guessing a field
// name, which is the real gap this closes (see docs/v0-findings.md's
// "Blind rebuild of a real backend" finding). Same unguarded-read
// philosophy as sourceLine above, for the same reason — a route whose file
// genuinely can't be read should surface as a real failure here, not a
// silently-empty section.
function inferredFieldsSection(repoPath: string, route: RouteEntry): string | undefined {
  if (!METHODS_WITH_BODY.has(route.method ?? '')) return undefined;
  const text = readFileSync(join(repoPath, route.file), 'utf-8');
  const fields = inferRequestBodyFields(text, route);
  if (fields.length === 0) return undefined;
  return [
    '## Inferred request body fields (best-effort, not verified)',
    '',
    'Static analysis of the handler found these field names read from the request body. This is',
    'a v1, regex-based heuristic — it can miss renamed destructuring, computed keys, and spread',
    'patterns, and is not a guarantee of the complete or exact shape.',
    '',
    fields.map((f) => `- \`${f}\``).join('\n'),
    ''
  ].join('\n');
}

// Companion to inferredFieldsSection above — see inferResponseBodyFields.ts's
// own header for the full accepted-risk list, most importantly: this only
// sees a response literal built directly in this file, not one produced by
// calling a separate (e.g. data-layer) function. Same unguarded-read
// philosophy as sourceLine/inferredFieldsSection for the same reason.
function inferredResponseFieldsSection(repoPath: string, route: RouteEntry): string | undefined {
  if (route.kind !== 'api') return undefined;
  const text = readFileSync(join(repoPath, route.file), 'utf-8');
  const fields = inferResponseBodyFields(text, route);
  if (fields.length === 0) return undefined;
  const formatHints = inferResponseValueFormatHints(text, route);
  return [
    '## Inferred response body fields (best-effort, not verified)',
    '',
    'Static analysis of the handler found these field names in a literal response object built',
    'directly in this file. This is a v1, regex-based heuristic scoped to same-file literal',
    'construction only — a response built by calling a separate function (e.g. a data-layer',
    'helper) is invisible to it, and fields from different return sites (e.g. an error response',
    'and a success response) are combined without distinguishing which belongs to which. Where a',
    'field\'s value traces to a real expression (not a plain literal), its source is shown',
    'verbatim, not paraphrased — this includes plain request passthroughs, not just',
    'server-computed values, since knowing a field is NOT transformed is real signal too.',
    '',
    fields
      .map((f) => (formatHints[f] ? `- \`${f}\` — computed as: \`${formatHints[f]}\`` : `- \`${f}\``))
      .join('\n'),
    ''
  ].join('\n');
}

// Documentation only — never asserted against, since captures and generated
// tests always settle animations to their end state before asserting (see
// generatePageTests.ts's ANIMATION_SETTLE_WAIT_MS / neutralizing override).
// The two subsections are gated independently — a page can have animations
// with no transitions, or vice versa. Each entry records its trigger
// condition (unconditional vs. a state pseudo-class like :hover) — real,
// live-triggered finding this exists to close: a blind rebuild reproduced a
// keyframe NAME correctly but wired it to :hover instead of the original's
// unconditional application, and nothing in the prior (name-only) version of
// this section could have told it otherwise.
function stylesheetAnimationsSection(animations: PageStylesheetAnimations): string {
  return [
    '## Declared CSS animations/transitions (documentation only — not asserted)',
    '',
    "Static analysis of this page's own stylesheets found these authored animation/transition",
    'declarations, including whether each is applied unconditionally or only under a state like',
    ':hover. Captures and generated tests always settle animations to their end state before',
    'asserting, so nothing here is behavior a generated test enforces — a rebuild agent choosing',
    'to reproduce this motion should treat this section as the source of truth for both what to',
    'build and when it should actually fire.',
    '',
    animations.keyframeUsages.length > 0
      ? [
          '### Animations',
          '',
          animations.keyframeUsages
            .map((u) => `- \`${u.selector}\` → \`${u.keyframeName}\` (${u.trigger})`)
            .join('\n'),
          ''
        ].join('\n')
      : undefined,
    animations.transitionUsages.length > 0
      ? [
          '### Transitions',
          '',
          animations.transitionUsages.map((u) => `- \`${u.selector}\` (${u.trigger})`).join('\n'),
          ''
        ].join('\n')
      : undefined
  ]
    .filter((line) => line !== undefined)
    .join('\n');
}

// Extracts the real interface shape verbatim from the source — never a
// paraphrase — so the rebuild agent's contract is the actual line, not our
// summary of it.
//
// assetManifest/skippedPages are both optional, default-empty — every
// existing caller/test that doesn't know about page screenshots keeps
// working unchanged. For a `kind: 'page'` route: a matching assetManifest
// entry gets a clearly-labeled reference-screenshot section (supplementary
// documentation only — never asserted pixel-by-pixel, per the plan's
// Decisions); a route present in skippedPages instead gets an explicit
// "capture failed" line, so a page that couldn't be captured is visibly
// absent from testing rather than silently indistinguishable from one that
// simply has no screenshot section.
export function generateContracts(
  repoPath: string,
  routes: RouteEntry[],
  assetManifest: AssetManifestEntry[] = [],
  skippedPages: SkippedPage[] = [],
  pageStylesheetAnimations: PageStylesheetAnimations[] = []
): GeneratedFile[] {
  return routes.map((route) => {
    const title = route.method ? `${route.method} ${route.path}` : route.path;
    const asset = assetManifest.find((a) => a.metadata.routeFile === route.file);
    const skipped = skippedPages.find((s) => s.routeFile === route.file);
    const animations = pageStylesheetAnimations.find((a) => a.routeFile === route.file);

    const content = [
      `# Contract: ${title}`,
      '',
      `- **File:** ${route.file}`,
      `- **Kind:** ${route.kind}`,
      route.startLine !== undefined ? `- **Line:** ${route.startLine}` : undefined,
      '',
      '## Signature (verbatim from source)',
      '',
      '```',
      sourceLine(repoPath, route),
      '```',
      '',
      inferredFieldsSection(repoPath, route),
      '',
      inferredResponseFieldsSection(repoPath, route),
      '',
      animations ? stylesheetAnimationsSection(animations) : undefined,
      '',
      asset
        ? [
            '## Reference screenshot (supplementary — not asserted pixel-by-pixel)',
            '',
            `The enforced, mutation-tested gate for this page is its DOM/content assertions in the generated test — this screenshot is reference documentation only.`,
            '',
            `![screenshot](../${asset.path})`,
            '',
            `- **Asset id:** ${asset.id}`,
            `- **Asset manifest:** spec/assets-manifest.json`,
            ''
          ].join('\n')
        : undefined,
      skipped
        ? `## Screenshot/DOM capture failed for this route (${skipped.reason}) — no page test was generated.\n`
        : undefined
    ]
      .filter((line) => line !== undefined)
      .join('\n');

    return { filename: contractFilename(route.method, route.path), content };
  });
}
