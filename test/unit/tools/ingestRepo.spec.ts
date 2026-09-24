import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { rmSync } from 'node:fs';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from '../../../src/server.js';
import { ingestRepoHandler } from '../../../src/tools/ingestRepo.js';
import { evidencePath } from '../../../src/state/dossierPaths.js';
import { PathNotAllowedError } from '../../../src/security/pathAllowlist.js';

const here = dirname(fileURLToPath(import.meta.url));
const sampleRepoPath = join(here, '../../fixtures/sample-repo');

async function connect(capabilities: Record<string, unknown> = {}) {
  const server = createServer();
  const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

function makeMonorepoFixture(dir: string): void {
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'temp', private: true }));
  mkdirSync(join(dir, 'apps', 'web'), { recursive: true });
  writeFileSync(join(dir, 'apps', 'web', 'package.json'), JSON.stringify({ name: '@app/web', dependencies: { express: '^4.19.0' } }));
  writeFileSync(join(dir, 'apps', 'web', 'server.ts'), "import express from 'express';\nconst app = express();\napp.get('/api/health', (req, res) => res.status(200).json({ ok: true }));\nexport default app;\n");
}

describe('ingest_repo tool', () => {
  it('ingests the sample repo and persists evidence.json under .dossier/', async () => {
    try {
      const result = await ingestRepoHandler({ path: sampleRepoPath });

      expect(existsSync(evidencePath(sampleRepoPath))).toBe(true);
      const saved = JSON.parse(readFileSync(evidencePath(sampleRepoPath), 'utf-8'));
      expect(saved.packageJson.name).toBe('sample-repo');

      const text = result.content[0]?.text ?? '';
      expect(text).toContain('routes');
    } finally {
      rmSync(join(sampleRepoPath, '.dossier'), { recursive: true, force: true });
    }
  });

  it('still succeeds for a path genuinely inside the configured allowlist (hosted mode)', async () => {
    const original = process.env.REBUILD_DOSSIER_ALLOWED_PATHS;
    process.env.REBUILD_DOSSIER_ALLOWED_PATHS = join(here, '../../fixtures');
    try {
      const result = await ingestRepoHandler({ path: sampleRepoPath });
      expect(result.content[0]?.text).toContain('routes');
    } finally {
      rmSync(join(sampleRepoPath, '.dossier'), { recursive: true, force: true });
      if (original === undefined) delete process.env.REBUILD_DOSSIER_ALLOWED_PATHS;
      else process.env.REBUILD_DOSSIER_ALLOWED_PATHS = original;
    }
  });

  it('rejects a path genuinely outside the allowlist', async () => {
    const original = process.env.REBUILD_DOSSIER_ALLOWED_PATHS;
    process.env.REBUILD_DOSSIER_ALLOWED_PATHS = join(here, '../../fixtures', 'sample-site'); // an unrelated sibling fixture dir
    try {
      await expect(ingestRepoHandler({ path: sampleRepoPath })).rejects.toThrow(PathNotAllowedError);
    } finally {
      if (original === undefined) delete process.env.REBUILD_DOSSIER_ALLOWED_PATHS;
      else process.env.REBUILD_DOSSIER_ALLOWED_PATHS = original;
    }
  });

  it('surfaces a monorepo hint when 0 routes are found at a workspace-root-shaped path', async () => {
    // Real, observed shape: pointing ingest_repo at a monorepo root (a thin
    // wrapper package.json with no routes of its own, no "workspaces" field,
    // no pnpm-workspace.yaml, only apps/*) silently returned 0 routes with
    // no indication the real app was one level down — someone using the
    // tool for real burned time debugging "why 0 routes" before finding it.
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-ingest-monorepo-'));
    try {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'temp', private: true }));
      mkdirSync(join(dir, 'apps', 'web'), { recursive: true });
      writeFileSync(join(dir, 'apps', 'web', 'package.json'), JSON.stringify({ name: '@app/web', dependencies: { next: '^14.0.0' } }));

      const result = await ingestRepoHandler({ path: dir });
      const summary = JSON.parse(result.content[0]!.text);

      expect(summary.routes).toBe(0);
      expect(summary.monorepoHint).toBeDefined();
      expect(summary.monorepoHint.candidates).toEqual(['apps/web']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not surface a monorepo hint when routes are actually found', async () => {
    const result = await ingestRepoHandler({ path: sampleRepoPath });
    const summary = JSON.parse(result.content[0]!.text);
    expect(summary.routes).toBeGreaterThan(0);
    expect(summary.monorepoHint).toBeUndefined();
    rmSync(join(sampleRepoPath, '.dossier'), { recursive: true, force: true });
  });

  // Real, live-triggered shape: pointing this at a Python project silently
  // returned 0 routes with no indication the stack itself is unsupported —
  // distinct from the monorepo case above, which is "wrong directory," not
  // "wrong stack."
  it('surfaces an unsupported-stack note for a Python project, not a monorepo hint', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-ingest-python-'));
    try {
      writeFileSync(join(dir, 'requirements.txt'), 'fastapi\n');
      writeFileSync(join(dir, 'main.py'), 'from fastapi import FastAPI\napp = FastAPI()\n');

      const result = await ingestRepoHandler({ path: dir });
      const summary = JSON.parse(result.content[0]!.text);

      expect(summary.routes).toBe(0);
      expect(summary.monorepoHint).toBeUndefined();
      expect(summary.unsupportedStackNote).toContain('Python');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not surface an unsupported-stack note when a monorepo hint already applies', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-ingest-monorepo-'));
    try {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'temp', private: true }));
      mkdirSync(join(dir, 'apps', 'web'), { recursive: true });
      writeFileSync(join(dir, 'apps', 'web', 'package.json'), JSON.stringify({ name: '@app/web', dependencies: { next: '^14.0.0' } }));

      const result = await ingestRepoHandler({ path: dir });
      const summary = JSON.parse(result.content[0]!.text);

      expect(summary.monorepoHint).toBeDefined();
      expect(summary.unsupportedStackNote).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('with interactive:true and elicitation supported, asks which candidate is the real app and ingests it', async () => {
    // Deliberately does NOT silently auto-redirect (that would be the same
    // class of silent-resolution violation as reconciliation auto-resolving
    // silent agreement) -- a human explicitly picks, mirroring
    // get_case_queue's own interactive/scripted-fallback split rather than
    // introducing a new pattern.
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-ingest-monorepo-'));
    try {
      makeMonorepoFixture(dir);
      const client = await connect({ elicitation: {} });

      let capturedMessage = '';
      client.setRequestHandler('elicitation/create', async (request) => {
        capturedMessage = (request.params as { message: string }).message;
        return { action: 'accept' as const, content: { path: 'apps/web' } };
      });

      const result = await client.callTool({ name: 'ingest_repo', arguments: { path: dir, interactive: true } });
      const summary = JSON.parse((result.content as Array<{ text: string }>)[0]!.text);

      expect(capturedMessage).toContain('apps/web');
      expect(summary.routes).toBeGreaterThan(0);
      expect(summary.monorepoHint).toBeUndefined();
      expect(summary.resolvedMonorepoChoice).toBe('apps/web');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falls back to the hint when elicitation is declined', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-ingest-monorepo-'));
    try {
      makeMonorepoFixture(dir);
      const client = await connect({ elicitation: {} });
      client.setRequestHandler('elicitation/create', async () => ({ action: 'decline' as const }));

      const result = await client.callTool({ name: 'ingest_repo', arguments: { path: dir, interactive: true } });
      const summary = JSON.parse((result.content as Array<{ text: string }>)[0]!.text);

      expect(summary.routes).toBe(0);
      expect(summary.monorepoHint.candidates).toEqual(['apps/web']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falls back to the hint when elicitation is not supported by the client at all', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-ingest-monorepo-'));
    try {
      makeMonorepoFixture(dir);
      const client = await connect(); // no elicitation capability declared

      const result = await client.callTool({ name: 'ingest_repo', arguments: { path: dir, interactive: true } });
      const summary = JSON.parse((result.content as Array<{ text: string }>)[0]!.text);

      expect(summary.routes).toBe(0);
      expect(summary.monorepoHint.candidates).toEqual(['apps/web']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falls back to the hint if the elicited answer is not one of the real candidates', async () => {
    // Doesn't blindly trust free-text input -- only acts on an exact match
    // to a real candidate directory.
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-ingest-monorepo-'));
    try {
      makeMonorepoFixture(dir);
      const client = await connect({ elicitation: {} });
      client.setRequestHandler('elicitation/create', async () => ({
        action: 'accept' as const,
        content: { path: 'apps/nonexistent' }
      }));

      const result = await client.callTool({ name: 'ingest_repo', arguments: { path: dir, interactive: true } });
      const summary = JSON.parse((result.content as Array<{ text: string }>)[0]!.text);

      expect(summary.routes).toBe(0);
      expect(summary.monorepoHint.candidates).toEqual(['apps/web']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not attempt elicitation when interactive is not set, even if the client supports it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-ingest-monorepo-'));
    try {
      makeMonorepoFixture(dir);
      const client = await connect({ elicitation: {} });
      let elicitationCalled = false;
      client.setRequestHandler('elicitation/create', async () => {
        elicitationCalled = true;
        return { action: 'decline' as const };
      });

      const result = await client.callTool({ name: 'ingest_repo', arguments: { path: dir } });
      const summary = JSON.parse((result.content as Array<{ text: string }>)[0]!.text);

      expect(elicitationCalled).toBe(false);
      expect(summary.monorepoHint.candidates).toEqual(['apps/web']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
