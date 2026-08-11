import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nextAppRouterDetector } from '../../../../src/ingest/routeDetectors/nextAppRouter.js';

function writeFile(dir: string, relPath: string, content: string) {
  const full = join(dir, relPath);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content);
  return full;
}

describe('nextAppRouterDetector', () => {
  it('applies only when next is a dependency', () => {
    expect(nextAppRouterDetector.applies({ scripts: {}, dependencies: { next: '^15.0.0' }, devDependencies: {} })).toBe(true);
    expect(nextAppRouterDetector.applies({ scripts: {}, dependencies: {}, devDependencies: {} })).toBe(false);
  });

  it('detects exported HTTP method handlers in a nested api route.ts, with dynamic segments', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-next-'));
    try {
      const file = writeFile(
        dir,
        'app/api/users/[id]/route.ts',
        ['export async function GET(req: Request) {}', 'export async function DELETE(req: Request) {}'].join('\n')
      );

      const routes = nextAppRouterDetector.detect(dir, [file]);

      expect(routes).toContainEqual({
        path: '/api/users/:id',
        method: 'GET',
        file: expect.stringContaining('route.ts'),
        kind: 'api',
        startLine: 1
      });
      expect(routes).toContainEqual({
        path: '/api/users/:id',
        method: 'DELETE',
        file: expect.stringContaining('route.ts'),
        kind: 'api',
        startLine: 2
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('detects exported HTTP method handlers written as const arrow functions, not just function declarations', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-next-'));
    try {
      const file = writeFile(
        dir,
        'src/app/api/todos/route.ts',
        [
          'export const GET = (req: NextRequest) => {};',
          'export const POST = async (req: NextRequest) => {};'
        ].join('\n')
      );

      const routes = nextAppRouterDetector.detect(dir, [file]);

      expect(routes).toContainEqual({
        path: '/api/todos',
        method: 'GET',
        file: expect.stringContaining('route.ts'),
        kind: 'api',
        startLine: 1
      });
      expect(routes).toContainEqual({
        path: '/api/todos',
        method: 'POST',
        file: expect.stringContaining('route.ts'),
        kind: 'api',
        startLine: 2
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('detects a page route and strips route groups from the path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-next-'));
    try {
      const file = writeFile(dir, 'app/(marketing)/about/page.tsx', 'export default function About() { return null; }');

      const routes = nextAppRouterDetector.detect(dir, [file]);

      expect(routes).toEqual([{ path: '/about', file: expect.stringContaining('page.tsx'), kind: 'page', startLine: 1 }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('maps the app root route.ts to "/"', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-next-'));
    try {
      const file = writeFile(dir, 'app/route.ts', 'export async function GET() {}');

      const routes = nextAppRouterDetector.detect(dir, [file]);

      expect(routes).toEqual([{ path: '/', method: 'GET', file: expect.stringContaining('route.ts'), kind: 'api', startLine: 1 }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('points a page route at its actual default-export line, not always line 1', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-next-'));
    try {
      const file = writeFile(
        dir,
        'app/home/page.tsx',
        ['"use client";', '', "import { useState } from 'react';", '', 'export default function Home() {', '  return null;', '}'].join(
          '\n'
        )
      );

      const routes = nextAppRouterDetector.detect(dir, [file]);

      expect(routes).toEqual([{ path: '/home', file: expect.stringContaining('page.tsx'), kind: 'page', startLine: 5 }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('detects routes under the common src/app/ layout, not just app/ at the repo root', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-next-'));
    try {
      const file = writeFile(dir, 'src/app/home/page.tsx', 'export default function Home() { return null; }');

      const routes = nextAppRouterDetector.detect(dir, [file]);

      expect(routes).toEqual([{ path: '/home', file: expect.stringContaining('page.tsx'), kind: 'page', startLine: 1 }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
