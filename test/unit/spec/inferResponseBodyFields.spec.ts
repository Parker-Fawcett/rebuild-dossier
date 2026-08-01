import { describe, expect, it } from 'vitest';
import { inferResponseBodyFields, inferResponseValueFormatHints } from '../../../src/spec/inferResponseBodyFields.js';
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

describe('inferResponseValueFormatHints', () => {
  it('shows an expression written inline directly in the response literal', () => {
    const source = `
      export async function POST(request) {
        return NextResponse.json({ created_at: new Date().toISOString() });
      }
    `;
    expect(inferResponseValueFormatHints(source, route())).toEqual({ created_at: 'new Date().toISOString()' });
  });

  it('traces a shorthand property back to its local declaration in the same handler', () => {
    const source = `
      export async function POST(request) {
        const created_at = new Date().toISOString();
        return NextResponse.json({ id: 1, created_at });
      }
    `;
    expect(inferResponseValueFormatHints(source, route())).toEqual({ created_at: 'new Date().toISOString()' });
  });

  it('shows a hint for a keyed property whose inline value is a real (non-trivial) expression, including a simple request-body passthrough', () => {
    // Not just server-generated values — any real expression is shown
    // verbatim, matching the "verbatim from source, never a paraphrase"
    // philosophy. A plain passthrough like `body.name` is still genuine,
    // accurate information (it tells a rebuild agent this field is NOT
    // transformed, just forwarded) — no special-casing to suppress it.
    const source = `
      export async function POST(request) {
        const body = await request.json();
        return NextResponse.json({ name: body.name });
      }
    `;
    expect(inferResponseValueFormatHints(source, route())).toEqual({ name: 'body.name' });
  });

  it('suppresses a shorthand property traced to a trivial literal', () => {
    const source = `
      export async function POST(request) {
        const id = 1;
        return NextResponse.json({ id });
      }
    `;
    expect(inferResponseValueFormatHints(source, route())).toEqual({});
  });

  it('suppresses an inline trivial literal', () => {
    const source = `
      export async function POST(request) {
        return NextResponse.json({ id: 1, label: 'fixed' });
      }
    `;
    expect(inferResponseValueFormatHints(source, route())).toEqual({});
  });

  it('suppresses a shorthand property with no local const/let declaration (e.g. destructured from the request)', () => {
    const source = `
      export async function POST(request) {
        const { name } = await request.json();
        return NextResponse.json({ name });
      }
    `;
    expect(inferResponseValueFormatHints(source, route())).toEqual({});
  });

  it('suppresses a chained alias — only one level of aliasing is resolved, and a bare alias is not informative', () => {
    const source = `
      export async function POST(request) {
        const x = new Date().toISOString();
        const created_at = x;
        return NextResponse.json({ created_at });
      }
    `;
    expect(inferResponseValueFormatHints(source, route())).toEqual({});
  });

  it('only attaches hints to fields that actually have a traceable expression, leaving other fields out entirely', () => {
    const source = `
      export async function POST(request) {
        const created_at = new Date().toISOString();
        return NextResponse.json({ id: 1, created_at });
      }
    `;
    const hints = inferResponseValueFormatHints(source, route());
    expect(hints).toEqual({ created_at: 'new Date().toISOString()' });
    expect(hints).not.toHaveProperty('id');
  });

  it('extracts hints from the real fieldnotes-shape idiom (type-asserted body reads, plus a same-file local declaration) for every field with a real expression', () => {
    // Not just the server-generated created_at field — name/message trace
    // back to genuine, non-trivial expressions too (the defensive
    // type-narrowing casts), and showing them is accurate, not noise: it
    // tells a rebuild agent those two fields are plain request passthroughs,
    // which is real signal, distinct from created_at's actual computation.
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
        const created_at = new Date().toISOString();
        return NextResponse.json({ id: 1, name, message, created_at }, { status: 201 });
      }
    `;
    expect(inferResponseValueFormatHints(source, route())).toEqual({
      name: '(body as Record<string, unknown> | null)?.name',
      message: '(body as Record<string, unknown> | null)?.message',
      created_at: 'new Date().toISOString()'
    });
  });
});
