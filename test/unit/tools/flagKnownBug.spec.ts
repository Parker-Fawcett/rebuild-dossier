import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { flagKnownBugHandler } from '../../../src/tools/flagKnownBug.js';
import { loadKnownBugs } from '../../../src/state/knownBugs.js';
import { createServer } from '../../../src/server.js';

describe('flag_known_bug tool', () => {
  it('persists the bug verbatim and reports it back', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-flagtool-'));
    try {
      const result = await flagKnownBugHandler({
        repoPath: dir,
        description: 'The users endpoint silently drops the last page of results'
      });

      const bugs = loadKnownBugs(dir);
      expect(bugs).toHaveLength(1);
      expect(bugs[0]?.description).toBe('The users endpoint silently drops the last page of results');

      const text = result.content[0]?.text ?? '';
      expect(text).toContain('The users endpoint silently drops the last page of results');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // A handler-level call (above) never exercises the SDK's real outputSchema
  // validation — only a genuine tools/call through a connected client does.
  it('returns structuredContent that satisfies the declared outputSchema over the real protocol', async () => {
    const server = createServer();
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-flagtool-structured-'));
    try {
      const result = await client.callTool({
        name: 'flag_known_bug',
        arguments: { repoPath: dir, description: 'The export button silently no-ops on Safari' }
      });

      const structured = result.structuredContent as { bug: { description: string }; openCases: number };
      expect(structured.bug.description).toBe('The export button silently no-ops on Safari');
      expect(structured.openCases).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
