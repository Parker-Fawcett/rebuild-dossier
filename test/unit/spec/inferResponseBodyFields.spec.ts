import { describe, expect, it } from 'vitest';
import { inferResponseBodyFields } from '../../../src/spec/inferResponseBodyFields.js';
import type { RouteEntry } from '../../../src/ingest/evidenceSchema.js';

function route(overrides: Partial<RouteEntry> = {}): RouteEntry {
  return { path: '/api/notes', method: 'POST', file: 'route.ts', kind: 'api', ...overrides };
}

describe('inferResponseBodyFields', () => {
  it('extracts all keys from a flat literal with shorthand properties', () => {
    const source = `
      export async function POST(request) {
        return NextResponse.json({ id, name, message, created_at }, { status: 201 });
      }
    `;
    expect(inferResponseBodyFields(source, route())).toEqual(
      expect.arrayContaining(['id', 'name', 'message', 'created_at'])
    );
  });

  it('extracts keys correctly when a value has nested parens (new Date().toISOString())', () => {
    const source = `
      export async function POST(request) {
        return NextResponse.json({ id, name, message, created_at: new Date().toISOString() });
      }
    `;
    const fields = inferResponseBodyFields(source, route());
    expect(fields).toEqual(expect.arrayContaining(['id', 'name', 'message', 'created_at']));
  });

  it('extracts only the top-level key when a value is a nested object', () => {
    const source = `
      export async function GET() {
        return NextResponse.json({ meta: { total: rows.length }, items: rows });
      }
    `;
    const fields = inferResponseBodyFields(source, route({ method: 'GET' }));
    expect(fields).toEqual(expect.arrayContaining(['meta', 'items']));
    expect(fields).not.toContain('total');
  });

  it('returns an empty list when the response is built by calling a separate function', () => {
    const source = `
      export async function POST(request) {
        return NextResponse.json(createNote(name, message), { status: 201 });
      }
    `;
    expect(inferResponseBodyFields(source, route())).toEqual([]);
  });

  it('returns an empty list for a bare-variable response (GET-list case)', () => {
    const source = `
      export async function GET() {
        const rows = listNotes();
        return NextResponse.json(rows);
      }
    `;
    expect(inferResponseBodyFields(source, route({ method: 'GET' }))).toEqual([]);
  });

  it('drops a spread entry but keeps a keyed property alongside it', () => {
    const source = `
      export async function POST(request) {
        return NextResponse.json({ ...note, extra: true });
      }
    `;
    expect(inferResponseBodyFields(source, route())).toEqual(['extra']);
  });

  it('extracts keys from an Express res.status(n).json({...}) call', () => {
    const source = `
      app.post('/api/notes', (req, res) => {
        res.status(201).json({ id: 1, name, message });
      });
    `;
    const fields = inferResponseBodyFields(source, route());
    expect(fields).toEqual(expect.arrayContaining(['id', 'name', 'message']));
  });

  it('unions fields across multiple return sites (an error response and a success response)', () => {
    const source = `
      export async function POST(request) {
        let body;
        try {
          body = await request.json();
        } catch {
          return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
        }
        const name = (body as Record<string, unknown> | null)?.name;
        const message = (body as Record<string, unknown> | null)?.message;
        if (!name || !message) {
          return NextResponse.json({ error: 'name and message are both required' }, { status: 400 });
        }
        return NextResponse.json({ id: 1, name, message, created_at: new Date().toISOString() }, { status: 201 });
      }
    `;
    const fields = inferResponseBodyFields(source, route());
    expect(fields).toEqual(expect.arrayContaining(['error', 'id', 'name', 'message', 'created_at']));
  });

  it('never runs extraction for a page route, even if res.json-shaped code exists in the file', () => {
    const source = `
      export default function Home() {
        useEffect(() => {
          fetch('/api/notes').then((res) => res.json());
        }, []);
        return null;
      }
    `;
    expect(inferResponseBodyFields(source, route({ kind: 'page', method: undefined }))).toEqual([]);
  });

  it('returns an empty list when the handler has no response-construction call at all', () => {
    const source = `
      export async function POST(request) {
        doSomething();
      }
    `;
    expect(inferResponseBodyFields(source, route())).toEqual([]);
  });
});
