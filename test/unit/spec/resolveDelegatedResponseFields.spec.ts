import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveDelegatedResponseFields } from '../../../src/spec/resolveDelegatedResponseFields.js';
import type { RouteEntry } from '../../../src/ingest/evidenceSchema.js';

function route(overrides: Partial<RouteEntry> = {}): RouteEntry {
  return { path: '/api/notes', method: 'POST', file: 'app/api/notes/route.ts', kind: 'api', ...overrides };
}

function withFixture(routeSource: string, libSource: string | null, fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-delegated-'));
  try {
    mkdirSync(join(dir, 'app', 'api', 'notes'), { recursive: true });
    writeFileSync(join(dir, 'app', 'api', 'notes', 'route.ts'), routeSource);
    if (libSource !== null) {
      mkdirSync(join(dir, 'lib'), { recursive: true });
      writeFileSync(join(dir, 'lib', 'db.ts'), libSource);
    }
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('resolveDelegatedResponseFields', () => {
  it('resolves the real createNote shape, unioning fields across two return sites', () => {
    const routeSource = `
      import { NextResponse } from 'next/server';
      import { createNote } from '../../../lib/db';
      export async function POST(request) {
        const { name, message } = await request.json();
        return NextResponse.json(createNote(name, message), { status: 201 });
      }
    `;
    const libSource = `
      export function createNote(name, message) {
        if (!name) {
          return { error: 'name required' };
        }
        const created_at = new Date().toISOString();
        const info = db.prepare('INSERT INTO notes (name, message, created_at) VALUES (?, ?, ?)').run(name, message, created_at);
        return { id: info.lastInsertRowid, name, message, created_at };
      }
    `;
    withFixture(routeSource, libSource, (dir) => {
      const result = resolveDelegatedResponseFields(dir, routeSource, route());
      expect(result?.fields).toEqual(expect.arrayContaining(['error', 'id', 'name', 'message', 'created_at']));
      // `id` also gets a hint (`info.lastInsertRowid`) — a real, non-trivial expression,
      // shown verbatim just like created_at, matching this codebase's established
      // "verbatim for any real expression, not just server-generated values" behavior.
      expect(result?.formatHints).toEqual({
        id: 'info.lastInsertRowid',
        created_at: 'new Date().toISOString()'
      });
      expect(result?.resolvedFrom).toEqual({ file: join('lib', 'db.ts'), functionName: 'createNote' });
    });
  });

  it('traces a bare return identifier back to its local declaration when it is an object literal (build-then-return shape)', () => {
    const routeSource = `
      import { NextResponse } from 'next/server';
      import { createNote } from '../../../lib/db';
      export async function POST(request) {
        const { name, message } = await request.json();
        return NextResponse.json(createNote(name, message), { status: 201 });
      }
    `;
    const libSource = `
      export function createNote(name, message) {
        const created_at = new Date().toISOString();
        const note = { id: 1, name, message, created_at };
        notes.push(note);
        return note;
      }
    `;
    withFixture(routeSource, libSource, (dir) => {
      const result = resolveDelegatedResponseFields(dir, routeSource, route());
      expect(result?.fields).toEqual(expect.arrayContaining(['id', 'name', 'message', 'created_at']));
      expect(result?.formatHints).toEqual({ created_at: 'new Date().toISOString()' });
    });
  });

  it('does not follow a bare return identifier beyond one level of tracing (chained alias)', () => {
    const routeSource = `
      import { NextResponse } from 'next/server';
      import { createNote } from '../../../lib/db';
      export async function POST(request) {
        const { name, message } = await request.json();
        return NextResponse.json(createNote(name, message));
      }
    `;
    const libSource = `
      export function createNote(name, message) {
        const note = { id: 1, name, message };
        const result = note;
        return result;
      }
    `;
    withFixture(routeSource, libSource, (dir) => {
      const result = resolveDelegatedResponseFields(dir, routeSource, route());
      expect(result).toBeNull();
    });
  });

  it('resolves an arrow-function callee with a block body identically', () => {
    const routeSource = `
      import { NextResponse } from 'next/server';
      import { createNote } from '../../../lib/db';
      export async function POST(request) {
        const { name, message } = await request.json();
        return NextResponse.json(createNote(name, message));
      }
    `;
    const libSource = `
      export const createNote = (name, message) => {
        const created_at = new Date().toISOString();
        return { id: 1, name, message, created_at };
      };
    `;
    withFixture(routeSource, libSource, (dir) => {
      const result = resolveDelegatedResponseFields(dir, routeSource, route());
      expect(result?.fields).toEqual(expect.arrayContaining(['id', 'name', 'message', 'created_at']));
      expect(result?.formatHints).toEqual({ created_at: 'new Date().toISOString()' });
    });
  });

  it('maps an aliased import back to the real exported name', () => {
    const routeSource = `
      import { NextResponse } from 'next/server';
      import { createNote as cn } from '../../../lib/db';
      export async function POST(request) {
        const { name, message } = await request.json();
        return NextResponse.json(cn(name, message));
      }
    `;
    const libSource = `
      export function createNote(name, message) {
        return { id: 1, name, message };
      }
    `;
    withFixture(routeSource, libSource, (dir) => {
      const result = resolveDelegatedResponseFields(dir, routeSource, route());
      expect(result?.fields).toEqual(expect.arrayContaining(['id', 'name', 'message']));
      expect(result?.resolvedFrom.functionName).toBe('createNote');
    });
  });

  it('returns null for a callee returning a bare value, not an object literal (the listNotes GET-list shape)', () => {
    const routeSource = `
      import { NextResponse } from 'next/server';
      import { listNotes } from '../../../lib/db';
      export async function GET() {
        return NextResponse.json(listNotes());
      }
    `;
    const libSource = `
      export function listNotes() {
        return db.prepare('SELECT * FROM notes').all();
      }
    `;
    withFixture(routeSource, libSource, (dir) => {
      const result = resolveDelegatedResponseFields(dir, routeSource, route({ method: 'GET' }));
      expect(result).toBeNull();
    });
  });

  it('returns null for a non-relative (bare package) import', () => {
    const routeSource = `
      import { NextResponse } from 'next/server';
      import { v4 } from 'uuid';
      export async function POST(request) {
        return NextResponse.json(v4());
      }
    `;
    withFixture(routeSource, null, (dir) => {
      const result = resolveDelegatedResponseFields(dir, routeSource, route());
      expect(result).toBeNull();
    });
  });

  it('returns null for a path-alias import (tsconfig paths resolution is deferred)', () => {
    const routeSource = `
      import { NextResponse } from 'next/server';
      import { createNote } from '@/lib/db';
      export async function POST(request) {
        const { name, message } = await request.json();
        return NextResponse.json(createNote(name, message));
      }
    `;
    withFixture(routeSource, null, (dir) => {
      const result = resolveDelegatedResponseFields(dir, routeSource, route());
      expect(result).toBeNull();
    });
  });

  it('returns null for a literal (non-delegated) response — never enters the resolution path', () => {
    const routeSource = `
      import { NextResponse } from 'next/server';
      export async function POST(request) {
        return NextResponse.json({ id: 1, name: 'x' });
      }
    `;
    withFixture(routeSource, null, (dir) => {
      const result = resolveDelegatedResponseFields(dir, routeSource, route());
      expect(result).toBeNull();
    });
  });

  it('returns null when the import statement names a different function than the one called', () => {
    const routeSource = `
      import { NextResponse } from 'next/server';
      import { otherHelper } from '../../../lib/db';
      export async function POST(request) {
        return NextResponse.json(createNote(name, message));
      }
    `;
    const libSource = `
      export function otherHelper() {
        return { ok: true };
      }
    `;
    withFixture(routeSource, libSource, (dir) => {
      const result = resolveDelegatedResponseFields(dir, routeSource, route());
      expect(result).toBeNull();
    });
  });

  it('returns null when the resolved module file does not exist on disk (broken import), without throwing', () => {
    const routeSource = `
      import { NextResponse } from 'next/server';
      import { createNote } from '../../../lib/nonexistent';
      export async function POST(request) {
        return NextResponse.json(createNote(name, message));
      }
    `;
    withFixture(routeSource, null, (dir) => {
      expect(() => resolveDelegatedResponseFields(dir, routeSource, route())).not.toThrow();
      expect(resolveDelegatedResponseFields(dir, routeSource, route())).toBeNull();
    });
  });

  it('returns null for a page route, same guard as inferResponseBodyFields', () => {
    const routeSource = `
      import { NextResponse } from 'next/server';
      import { createNote } from '../../../lib/db';
      export async function GET() {
        return NextResponse.json(createNote());
      }
    `;
    const libSource = `
      export function createNote() {
        return { id: 1 };
      }
    `;
    withFixture(routeSource, libSource, (dir) => {
      const result = resolveDelegatedResponseFields(dir, routeSource, route({ kind: 'page', method: undefined }));
      expect(result).toBeNull();
    });
  });
});
