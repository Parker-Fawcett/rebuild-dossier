import { describe, expect, it } from 'vitest';
import { inferSuccessStatusCode } from '../../../src/spec/inferSuccessStatusCode.js';
import type { RouteEntry } from '../../../src/ingest/evidenceSchema.js';

function route(overrides: Partial<RouteEntry> = {}): RouteEntry {
  return { path: '/api/notes', method: 'POST', file: 'route.ts', kind: 'api', ...overrides };
}

describe('inferSuccessStatusCode', () => {
  it('identifies 201 as the confident success status in the real fieldnotes/notarybox shape (try/catch + if-guard + final unconditional return)', () => {
    const source = `
      export async function POST(request) {
        let body;
        try {
          body = await request.json();
        } catch {
          return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
        }
        const name = body?.name;
        const message = body?.message;
        if (!name || !message) {
          return NextResponse.json({ error: 'name and message are both required' }, { status: 400 });
        }
        return NextResponse.json({ id: 1, name, message }, { status: 201 });
      }
    `;
    expect(inferSuccessStatusCode(source, route())).toEqual({ status: 201, claim: 'returns 201 on success' });
  });

  it('infers an implicit 200 when the success return has no explicit status option', () => {
    const source = `
      export async function POST(request) {
        const { name } = await request.json();
        if (!name) {
          return NextResponse.json({ error: 'name required' }, { status: 400 });
        }
        return NextResponse.json({ id: 1, name });
      }
    `;
    expect(inferSuccessStatusCode(source, route())).toEqual({ status: 200, claim: 'returns 200 on success' });
  });

  it('returns null for an if/else where both branches are guarded (no unconditional candidate)', () => {
    const source = `
      export async function POST(request) {
        const { name } = await request.json();
        if (name) {
          return NextResponse.json({ id: 1, name }, { status: 201 });
        } else {
          return NextResponse.json({ error: 'name required' }, { status: 400 });
        }
      }
    `;
    expect(inferSuccessStatusCode(source, route())).toBeNull();
  });

  it('infers an implicit 200 for a trivial single-return GET route with no guards at all', () => {
    const source = `
      export async function GET() {
        return NextResponse.json(rows);
      }
    `;
    expect(inferSuccessStatusCode(source, route({ method: 'GET' }))).toEqual({ status: 200, claim: 'returns 200 on success' });
  });

  it('resolves the Express res.status(n).json() form for both the guard and the success path', () => {
    const source = `
      app.post('/api/notes', (req, res) => {
        const { name } = req.body;
        if (!name) {
          return res.status(400).json({ error: 'name required' });
        }
        return res.status(201).json({ id: 1, name });
      });
    `;
    expect(inferSuccessStatusCode(source, route())).toEqual({ status: 201, claim: 'returns 201 on success' });
  });

  it('returns null for two sequential unconditional returns (ambiguous, not a wrong guess)', () => {
    const source = `
      export async function POST(request) {
        return NextResponse.json({ a: 1 }, { status: 200 });
        return NextResponse.json({ b: 2 }, { status: 201 });
      }
    `;
    expect(inferSuccessStatusCode(source, route())).toBeNull();
  });

  it('returns null for a page route', () => {
    const source = `
      export default function Home() {
        return null;
      }
    `;
    expect(inferSuccessStatusCode(source, route({ kind: 'page', method: undefined }))).toBeNull();
  });

  it('returns null when the handler has no response-construction call at all', () => {
    const source = `
      export async function POST(request) {
        doSomething();
      }
    `;
    expect(inferSuccessStatusCode(source, route())).toBeNull();
  });
});
