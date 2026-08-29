import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer as createHttpServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from '../../../src/server.js';

const here = dirname(fileURLToPath(import.meta.url));
const siteDir = join(here, '../../fixtures/sample-site');

const MIME: Record<string, string> = { '.html': 'text/html' };

let httpServer: Server;
let baseUrl: string;

beforeAll(async () => {
  httpServer = createHttpServer(async (req, res) => {
    const urlPath = (req.url ?? '/').split('?')[0]!;
    const filePath = join(siteDir, urlPath === '/' ? 'index.html' : urlPath);
    try {
      const content = await readFile(filePath);
      res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'text/plain' });
      res.end(content);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
    }
  });
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const address = httpServer.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
}, 30000);

afterAll(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

describe('crawl_site tool', () => {
  // A direct call to crawlSite() (exercised in crawl/crawler.spec.ts) never
  // goes through the SDK's real outputSchema validation — only a genuine
  // tools/call through a connected client does.
  it('returns structuredContent that satisfies the declared outputSchema over the real protocol', async () => {
    const server = createServer();
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-crawltool-structured-'));
    try {
      const result = await client.callTool({
        name: 'crawl_site',
        arguments: { url: baseUrl, repoPath: dir }
      });

      const structured = result.structuredContent as {
        routesVisited: number;
        routesWithConsoleErrors: number;
        openCases: number;
        savedTo: string;
      };
      expect(structured.routesVisited).toBeGreaterThan(0);
      expect(structured.savedTo).toContain(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);
});
