import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { resolveCaseHandler } from '../../../src/tools/resolveCase.js';
import { saveCases } from '../../../src/state/caseStore.js';
import type { Case } from '../../../src/reconciliation/types.js';
import { createServer } from '../../../src/server.js';

function openCase(id: string): Case {
  return { id, topicKey: id, signals: [], matchedKnownBugs: [], status: 'open' };
}

describe('resolve_case tool', () => {
  it('resolves an open case and reports the updated status', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-resolvetool-'));
    try {
      saveCases(dir, [openCase('case:1')]);

      const result = await resolveCaseHandler({ repoPath: dir, id: 'case:1', decision: 'intentional' });

      const text = result.content[0]?.text ?? '';
      expect(text).toContain('resolved_by_human');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports an error for an unknown case id rather than throwing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-resolvetool-'));
    try {
      saveCases(dir, []);
      const result = await resolveCaseHandler({ repoPath: dir, id: 'case:missing', decision: 'bug' });
      expect(result.isError).toBe(true);
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

    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-resolvetool-structured-'));
    try {
      saveCases(dir, [openCase('case:1')]);

      const result = await client.callTool({
        name: 'resolve_case',
        arguments: { repoPath: dir, id: 'case:1', decision: 'intentional' }
      });

      const structured = result.structuredContent as Case;
      expect(structured.status).toBe('resolved_by_human');
      expect(structured.humanDecision?.decision).toBe('intentional');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
