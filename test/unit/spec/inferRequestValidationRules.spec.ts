import { describe, expect, it } from 'vitest';
import { inferRequestValidationRules } from '../../../src/spec/inferRequestValidationRules.js';
import type { RouteEntry } from '../../../src/ingest/evidenceSchema.js';

function route(overrides: Partial<RouteEntry> = {}): RouteEntry {
  return { path: '/api/notes', method: 'POST', file: 'route.ts', kind: 'api', ...overrides };
}

describe('inferRequestValidationRules', () => {
  it('flags both fields in an OR-of-two-negations guard (the real fieldnotes idiom)', () => {
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
    expect(inferRequestValidationRules(source, route())).toEqual({
      name: { expression: '!name', kind: 'required' },
      message: { expression: '!message', kind: 'required' }
    });
  });

  it('flags a single-field guard', () => {
    const source = `
      export async function POST(request) {
        const { name } = await request.json();
        if (!name) {
          return NextResponse.json({ error: 'name required' }, { status: 400 });
        }
        return NextResponse.json({ id: 1, name });
      }
    `;
    expect(inferRequestValidationRules(source, route())).toEqual({ name: { expression: '!name', kind: 'required' } });
  });

  it('excludes an &&-joined condition as ambiguous (at-least-one-of-N, not "each required")', () => {
    const source = `
      export async function POST(request) {
        const { name, message } = await request.json();
        if (!name && !message) {
          return NextResponse.json({ error: 'at least one required' }, { status: 400 });
        }
        return NextResponse.json({ id: 1 });
      }
    `;
    expect(inferRequestValidationRules(source, route())).toEqual({});
  });

  it('excludes a brace-less one-liner guard (named v1 limitation)', () => {
    const source = `
      app.post('/api/notes', (req, res) => {
        const { name } = req.body;
        if (!name) return res.status(400).json({ error: 'name required' });
        res.status(201).json({ id: 1, name });
      });
    `;
    expect(inferRequestValidationRules(source, route())).toEqual({});
  });

  it('excludes a guard on an identifier never read from the request body', () => {
    const source = `
      export async function POST(request) {
        const { name } = await request.json();
        if (!isAdmin) {
          return NextResponse.json({ error: 'forbidden' }, { status: 403 });
        }
        return NextResponse.json({ id: 1, name });
      }
    `;
    expect(inferRequestValidationRules(source, route())).toEqual({});
  });

  it('excludes a guard whose block is not actually an error response (no 4xx status)', () => {
    const source = `
      export async function POST(request) {
        const { name } = await request.json();
        if (!name) {
          return NextResponse.json({ id: 0, name: 'anonymous' }, { status: 200 });
        }
        return NextResponse.json({ id: 1, name });
      }
    `;
    expect(inferRequestValidationRules(source, route())).toEqual({});
  });

  it('resolves the base identifier from an optionally-chained negation, shown verbatim', () => {
    const source = `
      export async function POST(request) {
        const { name } = await request.json();
        if (!name?.trim()) {
          return NextResponse.json({ error: 'name required' }, { status: 400 });
        }
        return NextResponse.json({ id: 1, name });
      }
    `;
    expect(inferRequestValidationRules(source, route())).toEqual({
      name: { expression: '!name?.trim()', kind: 'required' }
    });
  });

  it('flags two separate single-field guards independently', () => {
    const source = `
      export async function POST(request) {
        const { name, message } = await request.json();
        if (!name) {
          return NextResponse.json({ error: 'name required' }, { status: 400 });
        }
        if (!message) {
          return NextResponse.json({ error: 'message required' }, { status: 400 });
        }
        return NextResponse.json({ id: 1, name, message }, { status: 201 });
      }
    `;
    expect(inferRequestValidationRules(source, route())).toEqual({
      name: { expression: '!name', kind: 'required' },
      message: { expression: '!message', kind: 'required' }
    });
  });

  it('resolves both branches correctly when a nested call inside the condition contains parens', () => {
    const source = `
      export async function POST(request) {
        const { name, message } = await request.json();
        if (!name || !message.trim()) {
          return NextResponse.json({ error: 'invalid' }, { status: 400 });
        }
        return NextResponse.json({ id: 1, name, message });
      }
    `;
    expect(inferRequestValidationRules(source, route())).toEqual({
      name: { expression: '!name', kind: 'required' },
      message: { expression: '!message.trim()', kind: 'required' }
    });
  });

  it('returns an empty object for a GET route with no request body', () => {
    const source = `
      export async function GET() {
        if (!something) {
          return NextResponse.json({ error: 'x' }, { status: 400 });
        }
        return NextResponse.json({ ok: true });
      }
    `;
    expect(inferRequestValidationRules(source, route({ method: 'GET' }))).toEqual({});
  });

  it('flags a typeof-check guard, capturing the checked type verbatim', () => {
    const source = `
      export async function POST(request) {
        const { name } = await request.json();
        if (typeof name !== 'string') {
          return NextResponse.json({ error: 'invalid name' }, { status: 400 });
        }
        return NextResponse.json({ id: 1, name });
      }
    `;
    expect(inferRequestValidationRules(source, route())).toEqual({
      name: { expression: "typeof name !== 'string'", kind: 'type', expectedType: 'string' }
    });
  });

  it('flags a typeof-check guard using loose inequality (!=)', () => {
    const source = `
      export async function POST(request) {
        const { name } = await request.json();
        if (typeof name != 'string') {
          return NextResponse.json({ error: 'invalid name' }, { status: 400 });
        }
        return NextResponse.json({ id: 1, name });
      }
    `;
    expect(inferRequestValidationRules(source, route())).toEqual({
      name: { expression: "typeof name != 'string'", kind: 'type', expectedType: 'string' }
    });
  });

  it('excludes a positive typeof equality check (inverted/unusual rejection logic, not recognized)', () => {
    const source = `
      export async function POST(request) {
        const { name } = await request.json();
        if (typeof name === 'string') {
          return NextResponse.json({ error: 'invalid name' }, { status: 400 });
        }
        return NextResponse.json({ id: 1, name });
      }
    `;
    expect(inferRequestValidationRules(source, route())).toEqual({});
  });

  it('flags an explicit non-empty-length guard (=== 0 form)', () => {
    const source = `
      export async function POST(request) {
        const { tags } = await request.json();
        if (tags.length === 0) {
          return NextResponse.json({ error: 'tags required' }, { status: 400 });
        }
        return NextResponse.json({ id: 1, tags });
      }
    `;
    expect(inferRequestValidationRules(source, route())).toEqual({
      tags: { expression: 'tags.length === 0', kind: 'non-empty' }
    });
  });

  it('flags an explicit non-empty-length guard (< 1 form)', () => {
    const source = `
      export async function POST(request) {
        const { tags } = await request.json();
        if (tags.length < 1) {
          return NextResponse.json({ error: 'tags required' }, { status: 400 });
        }
        return NextResponse.json({ id: 1, tags });
      }
    `;
    expect(inferRequestValidationRules(source, route())).toEqual({
      tags: { expression: 'tags.length < 1', kind: 'non-empty' }
    });
  });

  it('flags all three guard kinds combined in one condition (the exact stage-2 motivating shape)', () => {
    const source = `
      export async function POST(request) {
        const { name, message, tags } = await request.json();
        if (!name || typeof message !== 'string' || tags.length === 0) {
          return NextResponse.json({ error: 'invalid' }, { status: 400 });
        }
        return NextResponse.json({ id: 1, name, message, tags }, { status: 201 });
      }
    `;
    expect(inferRequestValidationRules(source, route())).toEqual({
      name: { expression: '!name', kind: 'required' },
      message: { expression: "typeof message !== 'string'", kind: 'type', expectedType: 'string' },
      tags: { expression: 'tags.length === 0', kind: 'non-empty' }
    });
  });

  it('excludes a typeof guard and a non-empty guard on identifiers never read from the request body', () => {
    const source = `
      export async function POST(request) {
        const { name } = await request.json();
        if (typeof isAdmin !== 'string' || sessionTokens.length === 0) {
          return NextResponse.json({ error: 'forbidden' }, { status: 403 });
        }
        return NextResponse.json({ id: 1, name });
      }
    `;
    expect(inferRequestValidationRules(source, route())).toEqual({});
  });
});
