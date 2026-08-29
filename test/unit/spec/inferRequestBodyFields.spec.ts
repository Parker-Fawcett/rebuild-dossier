import { describe, expect, it } from 'vitest';
import { inferRequestBodyFields } from '../../../src/spec/inferRequestBodyFields.js';
import type { RouteEntry } from '../../../src/ingest/evidenceSchema.js';

function route(overrides: Partial<RouteEntry> = {}): RouteEntry {
  return { path: '/api/notes', method: 'POST', file: 'route.ts', kind: 'api', ...overrides };
}

describe('inferRequestBodyFields', () => {
  it('extracts field names from destructuring await request.json()', () => {
    const source = `
      export async function POST(request) {
        const { message, name } = await request.json();
        return NextResponse.json({ message, name });
      }
    `;
    expect(inferRequestBodyFields(source, route())).toEqual(expect.arrayContaining(['message', 'name']));
  });

  it('extracts field names from destructuring req.body (Express)', () => {
    const source = `
      app.post('/api/notes', (req, res) => {
        const { message } = req.body;
        res.json({ message });
      });
    `;
    expect(inferRequestBodyFields(source, route())).toEqual(['message']);
  });

  it('extracts field names from plain property access (body.message)', () => {
    const source = `
      export async function POST(request) {
        const body = await request.json();
        return NextResponse.json({ ok: body.message });
      }
    `;
    expect(inferRequestBodyFields(source, route())).toEqual(['message']);
  });

  it('extracts field names from optional-chained property access (body?.message)', () => {
    const source = `
      export async function POST(request) {
        const body = await request.json();
        return NextResponse.json({ ok: body?.message });
      }
    `;
    expect(inferRequestBodyFields(source, route())).toEqual(['message']);
  });

  it('extracts field names from direct req.body.message access (Express, no intermediate variable)', () => {
    const source = `
      app.post('/api/notes', (req, res) => {
        res.json({ ok: req.body.message });
      });
    `;
    expect(inferRequestBodyFields(source, route())).toEqual(['message']);
  });

  it('does not capture renamed destructuring bindings', () => {
    const source = `
      export async function POST(request) {
        const { message: msg } = await request.json();
        return NextResponse.json({ msg });
      }
    `;
    expect(inferRequestBodyFields(source, route())).toEqual([]);
  });

  it('does not capture spread patterns', () => {
    const source = `
      export async function POST(request) {
        const { ...rest } = await request.json();
        return NextResponse.json(rest);
      }
    `;
    expect(inferRequestBodyFields(source, route())).toEqual([]);
  });

  it('returns an empty list when the handler never touches the body', () => {
    const source = `
      export async function POST(request) {
        return NextResponse.json({ ok: true });
      }
    `;
    expect(inferRequestBodyFields(source, route())).toEqual([]);
  });

  it('never runs extraction for a GET route, even if body.message-shaped code exists elsewhere in the file', () => {
    const source = `
      export async function GET() {
        return NextResponse.json({ ok: true });
      }
      export async function POST(request) {
        const body = await request.json();
        return NextResponse.json({ ok: body.message });
      }
    `;
    expect(inferRequestBodyFields(source, route({ method: 'GET' }))).toEqual([]);
  });

  it('never runs extraction for a DELETE route', () => {
    const source = `
      export async function DELETE(request) {
        const body = await request.json();
        return NextResponse.json({ ok: body.message });
      }
    `;
    expect(inferRequestBodyFields(source, route({ method: 'DELETE' }))).toEqual([]);
  });

  it('isolates only the requested handler when a file has multiple exports', () => {
    const source = `
      export async function GET() {
        return NextResponse.json({ ok: body.unrelated });
      }
      export async function POST(request) {
        const { message } = await request.json();
        return NextResponse.json({ message });
      }
    `;
    expect(inferRequestBodyFields(source, route({ method: 'POST' }))).toEqual(['message']);
  });

  it('disambiguates between multiple Express registrations by path', () => {
    const source = `
      app.post('/api/notes', (req, res) => {
        const { message } = req.body;
        res.json({ message });
      });
      app.post('/api/other', (req, res) => {
        const { title } = req.body;
        res.json({ title });
      });
    `;
    expect(inferRequestBodyFields(source, route({ path: '/api/notes' }))).toEqual(['message']);
  });

  it('returns an empty list for an unisolable handler (no inline body)', () => {
    const source = `
      import { notesHandler } from './handlers.js';
      app.post('/api/notes', notesHandler);
    `;
    expect(inferRequestBodyFields(source, route())).toEqual([]);
  });

  it('extracts field names from the real fieldnotes-shape type-asserted access idiom', () => {
    // The load-bearing regression case for this whole module: a first design
    // using only destructuring + plain property-access patterns got ZERO
    // matches against this exact real-world source (traced directly, not
    // assumed) — `body` here is never immediately followed by `.`/`?.`,
    // only by ` as Record<...>` first. This must keep passing.
    const source = `
      export async function POST(request) {
        let body;
        try {
          body = await request.json();
        } catch {
          return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
        }

        const name =
          typeof (body as Record<string, unknown> | null)?.name === 'string'
            ? ((body as Record<string, unknown>).name as string).trim()
            : '';
        const message =
          typeof (body as Record<string, unknown> | null)?.message === 'string'
            ? ((body as Record<string, unknown>).message as string).trim()
            : '';

        if (!name || !message) {
          return NextResponse.json({ error: 'name and message are both required' }, { status: 400 });
        }
      }
    `;
    expect(inferRequestBodyFields(source, route())).toEqual(expect.arrayContaining(['name', 'message']));
  });

  it('extracts field names from the same fieldnotes-shape idiom under a differently-named variable', () => {
    // A real regression found live: the exact shape above but naming the
    // parsed-JSON variable `raw` instead of `body` (an equally reasonable
    // choice — arguably more descriptive, since it's the payload before
    // validation) got ZERO fields and no validation rules at all, because
    // every property-access pattern was hardcoded to the literal name
    // `body`. Must keep passing.
    const source = `
      export async function POST(request) {
        let raw;
        try {
          raw = await request.json();
        } catch {
          return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
        }

        const subject = (raw as Record<string, unknown> | null)?.subject;
        const body = (raw as Record<string, unknown> | null)?.body;

        if (!subject || !body) {
          return NextResponse.json({ error: 'subject and body are both required' }, { status: 400 });
        }
      }
    `;
    expect(inferRequestBodyFields(source, route())).toEqual(expect.arrayContaining(['subject', 'body']));
  });

  it('extracts field names from type-asserted access with a non-null assertion', () => {
    const source = `
      export async function POST(request) {
        const body = await request.json();
        return NextResponse.json({ ok: (body as Record<string, unknown>)!.name });
      }
    `;
    expect(inferRequestBodyFields(source, route())).toEqual(['name']);
  });

  it('extracts field names from type-asserted access directly on req.body (Express, no intermediate variable)', () => {
    // Found while verifying the fix against a live Express fixture: this
    // idiom is a real, distinct case from the plain `body as X` case above
    // (there's no intermediate `body` variable to anchor on) — not assumed
    // in advance.
    const source = `
      app.post('/api/notes', (req, res) => {
        const name = (req.body as Record<string, unknown> | null)?.name;
        res.json({ name });
      });
    `;
    expect(inferRequestBodyFields(source, route())).toEqual(['name']);
  });
});
