import { describe, expect, it } from 'vitest';
import { isolateHandlerBody } from '../../../src/spec/isolateHandlerSource.js';
import type { RouteEntry } from '../../../src/ingest/evidenceSchema.js';

function route(overrides: Partial<RouteEntry> = {}): RouteEntry {
  return { path: '/api/notes', method: 'POST', file: 'route.ts', kind: 'api', ...overrides };
}

describe('isolateHandlerBody', () => {
  it('isolates a simple Next.js handler body', () => {
    const source = `
      export async function POST(request) {
        return NextResponse.json({ id: 1 });
      }
    `;
    expect(isolateHandlerBody(source, route())).toBe('{\n        return NextResponse.json({ id: 1 });\n      }');
  });

  it('isolates the real body, not a destructured second-parameter fragment, when a Next.js handler destructures its params argument inline (real, live-triggered bug)', () => {
    // export async function GET(request, { params }) { ... } — a standard
    // Next.js App Router idiom for dynamic routes. The naive "first { after
    // the handler name's own (" search finds `{ params }`'s own brace
    // first, since a destructuring parameter also begins with `{` —
    // isolating a 2-token fragment instead of the real body. Every consumer
    // of isolateHandlerBody (inferRequestBodyFields, inferResponseBodyFields,
    // inferRequestValidationRules, resolveDelegatedResponseFields,
    // inferSuccessStatusCode) depends on this being correct.
    const source = `
      export async function GET(request, { params }) {
        const user = users[params.id];
        if (!user) {
          return NextResponse.json({ error: 'not found' }, { status: 404 });
        }
        return NextResponse.json(user, { status: 200 });
      }
    `;
    const body = isolateHandlerBody(source, route({ method: 'GET', path: '/api/users/:id' }));
    expect(body).toContain('not found');
    expect(body).toContain('status: 200');
    expect(body).not.toBe('{ params }');
  });

  it('isolates the real body when a Next.js handler destructures params with an inline type annotation', () => {
    const source = `
      export async function GET(request: Request, { params }: { params: { id: string } }) {
        return NextResponse.json({ id: params.id });
      }
    `;
    const body = isolateHandlerBody(source, route({ method: 'GET', path: '/api/users/:id' }));
    expect(body).toContain('params.id');
    expect(body).not.toContain('{ params: { id: string } }');
  });

  it('isolates a simple Express handler body', () => {
    const source = `
      app.post('/api/notes', (req, res) => {
        res.json({ id: 1 });
      });
    `;
    const body = isolateHandlerBody(source, route());
    expect(body).toContain("res.json({ id: 1 });");
  });

  it('isolates the real Express handler body when the callback destructures req', () => {
    const source = `
      app.post('/api/notes', ({ body }, res) => {
        res.json({ message: body.message });
      });
    `;
    const body = isolateHandlerBody(source, route());
    expect(body).toContain('body.message');
  });

  it('returns null when no matching handler is found', () => {
    const source = `export async function GET() { return null; }`;
    expect(isolateHandlerBody(source, route({ method: 'POST' }))).toBeNull();
  });
});
