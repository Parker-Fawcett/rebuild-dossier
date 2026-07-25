import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RouteEntry } from '../ingest/evidenceSchema.js';
import type { AssetManifestEntry } from './assetManifestSchema.js';
import type { SkippedPage } from './generatePageTests.js';

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

function sourceLine(repoPath: string, route: RouteEntry): string {
  if (route.startLine === undefined) return '(source line unavailable)';
  const text = readFileSync(join(repoPath, route.file), 'utf-8');
  const line = text.split('\n')[route.startLine - 1];
  return line?.trim() ?? '(source line unavailable)';
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
  skippedPages: SkippedPage[] = []
): GeneratedFile[] {
  return routes.map((route) => {
    const title = route.method ? `${route.method} ${route.path}` : route.path;
    const asset = assetManifest.find((a) => a.metadata.routeFile === route.file);
    const skipped = skippedPages.find((s) => s.routeFile === route.file);

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
