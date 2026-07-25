import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateContracts } from '../../../src/spec/generateContracts.js';
import type { RouteEntry } from '../../../src/ingest/evidenceSchema.js';

describe('generateContracts', () => {
  it('produces one contract file per route with the verbatim source line, not a paraphrase', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-contracts-'));
    try {
      writeFileSync(
        join(dir, 'server.ts'),
        ["import express from 'express';", '', "app.get('/api/users/:id', (req, res) => {});"].join('\n')
      );
      const routes: RouteEntry[] = [{ path: '/api/users/:id', method: 'GET', file: 'server.ts', kind: 'api', startLine: 3 }];

      const files = generateContracts(dir, routes);

      expect(files).toHaveLength(1);
      expect(files[0]?.filename).toBe('GET-api-users-id.md');
      expect(files[0]?.content).toContain('/api/users/:id');
      expect(files[0]?.content).toContain("app.get('/api/users/:id', (req, res) => {});");
      expect(files[0]?.content).toContain('server.ts');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('sanitizes page routes with no method into a distinct filename', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-contracts-'));
    try {
      writeFileSync(join(dir, 'page.tsx'), 'export default function About() { return null; }');
      const routes: RouteEntry[] = [{ path: '/about', file: 'page.tsx', kind: 'page', startLine: 1 }];

      const files = generateContracts(dir, routes);

      expect(files[0]?.filename).toBe('PAGE-about.md');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns an empty array for no routes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-contracts-'));
    try {
      expect(generateContracts(dir, [])).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('embeds a labeled, supplementary reference-screenshot section when a manifest entry exists for the route', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-contracts-'));
    try {
      writeFileSync(join(dir, 'page.tsx'), 'export default function Home() { return null; }');
      const routes: RouteEntry[] = [{ path: '/', file: 'page.tsx', kind: 'page', startLine: 1 }];

      const files = generateContracts(dir, routes, [
        {
          id: 'PAGE-root-screenshot',
          path: 'spec/assets/screenshots/PAGE-root.png',
          hash: 'a'.repeat(64),
          kind: 'screenshot',
          metadata: { routeFile: 'page.tsx', path: '/' }
        }
      ]);

      expect(files[0]?.content).toContain('Reference screenshot (supplementary — not asserted pixel-by-pixel)');
      expect(files[0]?.content).toContain('spec/assets/screenshots/PAGE-root.png');
      expect(files[0]?.content).toContain('PAGE-root-screenshot');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('omits the screenshot section entirely when no manifest is passed (default-empty-array backward compat)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-contracts-'));
    try {
      writeFileSync(join(dir, 'page.tsx'), 'export default function Home() { return null; }');
      const routes: RouteEntry[] = [{ path: '/', file: 'page.tsx', kind: 'page', startLine: 1 }];

      const files = generateContracts(dir, routes);

      expect(files[0]?.content).not.toContain('Reference screenshot');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('states a capture-failed route explicitly instead of silently omitting its screenshot section', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-contracts-'));
    try {
      writeFileSync(join(dir, 'page.tsx'), 'export default function Home() { return null; }');
      const routes: RouteEntry[] = [{ path: '/', file: 'page.tsx', kind: 'page', startLine: 1 }];

      const files = generateContracts(dir, routes, [], [{ routeFile: 'page.tsx', reason: 'next dev did not become ready in time' }]);

      expect(files[0]?.content).toContain('Screenshot/DOM capture failed for this route');
      expect(files[0]?.content).toContain('next dev did not become ready in time');
      expect(files[0]?.content).toContain('no page test was generated');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
