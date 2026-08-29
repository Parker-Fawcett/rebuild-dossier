import * as z from 'zod/v4';
import type { ServerContext } from '@modelcontextprotocol/server';
import { crawlSite } from '../crawl/crawler.js';
import { createProgressReporter } from '../crawl/progressHeartbeat.js';
import { crawlEvidencePath } from '../state/dossierPaths.js';
import { atomicWriteFile } from '../state/atomicWrite.js';
import { buildCases } from '../reconciliation/buildCases.js';
import { enforcePathAllowlist } from '../security/pathAllowlist.js';
import { enforceUrlAllowlist } from '../security/urlAllowlist.js';

export const crawlSiteInputSchema = z.object({
  url: z.string().describe('Base URL to crawl'),
  maxPages: z.number().int().positive().optional().describe('Optional cap on how many reachable pages to visit. Unset means no limit.'),
  repoPath: z.string().describe('Repo path whose .dossier/ this crawl evidence should be saved under')
});

export const crawlSiteConfig = {
  title: 'Crawl site',
  description: 'Playwright headless crawl of reachable routes. Emits periodic progress notifications.',
  inputSchema: crawlSiteInputSchema,
  annotations: {
    title: 'Crawl site',
    // Writes crawl evidence to .dossier/, so not read-only. Doesn't destroy
    // anything the target site or repo owns. Not idempotent — it's a live,
    // external site; console errors and reachable routes can genuinely change
    // between two crawls of the same URL. openWorldHint is true because this
    // is the textbook case: an uncontrolled, unpredictable external system
    // reached over the network, not this server's own state.
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true
  }
};

export async function crawlSiteHandler(args: z.infer<typeof crawlSiteInputSchema>, ctx: ServerContext) {
  enforcePathAllowlist(args.repoPath);
  await enforceUrlAllowlist(args.url);
  const evidence = await crawlSite(args.url, {
    maxPages: args.maxPages,
    onProgress: createProgressReporter(ctx),
    signal: ctx.mcpReq.signal
  });

  atomicWriteFile(crawlEvidencePath(args.repoPath), JSON.stringify(evidence, null, 2));
  const cases = buildCases(args.repoPath);

  const summary = {
    routesVisited: evidence.routesVisited.length,
    routesWithConsoleErrors: evidence.routesVisited.filter((r) => r.consoleErrors.length > 0).length,
    openCases: cases.filter((c) => c.status === 'open').length,
    savedTo: crawlEvidencePath(args.repoPath)
  };

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(summary, null, 2) }]
  };
}
