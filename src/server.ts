import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/server';
import { ingestRepoConfig, ingestRepoHandler } from './tools/ingestRepo.js';
import { crawlSiteConfig, crawlSiteHandler } from './tools/crawlSite.js';
import { flagKnownBugConfig, flagKnownBugHandler } from './tools/flagKnownBug.js';
import { getCaseQueueConfig, getCaseQueueHandler } from './tools/getCaseQueue.js';
import { resolveCaseConfig, resolveCaseHandler } from './tools/resolveCase.js';
import { generateSpecConfig, generateSpecHandler } from './tools/generateSpec.js';

// Read rather than hardcoded — a literal version string here silently drifts
// from package.json's real one (found already at 0.1.0 vs. 0.2.4) and every
// MCP client reports the stale value back as this server's identity.
const { version } = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf-8')
) as { version: string };

export function createServer(): McpServer {
  const server = new McpServer(
    { name: 'rebuild-dossier', version },
    { capabilities: { logging: {} } }
  );

  server.registerTool('ingest_repo', ingestRepoConfig, ingestRepoHandler);
  server.registerTool('crawl_site', crawlSiteConfig, crawlSiteHandler);
  server.registerTool('flag_known_bug', flagKnownBugConfig, flagKnownBugHandler);
  server.registerTool('get_case_queue', getCaseQueueConfig, getCaseQueueHandler);
  server.registerTool('resolve_case', resolveCaseConfig, resolveCaseHandler);
  server.registerTool('generate_spec', generateSpecConfig, generateSpecHandler);

  return server;
}
