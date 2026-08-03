import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
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

  it('adds an inferred-request-body-fields section for a POST route whose handler reads the body', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-contracts-'));
    try {
      writeFileSync(
        join(dir, 'server.ts'),
        [
          "import express from 'express';",
          '',
          "app.post('/api/notes', (req, res) => {",
          '  const { message } = req.body;',
          '  res.json({ message });',
          '});'
        ].join('\n')
      );
      const routes: RouteEntry[] = [{ path: '/api/notes', method: 'POST', file: 'server.ts', kind: 'api', startLine: 3 }];

      const files = generateContracts(dir, routes);

      expect(files[0]?.content).toContain('Inferred request body fields');
      expect(files[0]?.content).toContain('`message`');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('omits the inferred-request-body-fields section for a GET route', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-contracts-'));
    try {
      writeFileSync(
        join(dir, 'server.ts'),
        ["import express from 'express';", '', "app.get('/api/users/:id', (req, res) => {});"].join('\n')
      );
      const routes: RouteEntry[] = [{ path: '/api/users/:id', method: 'GET', file: 'server.ts', kind: 'api', startLine: 3 }];

      const files = generateContracts(dir, routes);

      expect(files[0]?.content).not.toContain('Inferred request body fields');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('omits the inferred-request-body-fields section for a POST route whose handler never touches the body', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-contracts-'));
    try {
      writeFileSync(
        join(dir, 'server.ts'),
        [
          "import express from 'express';",
          '',
          "app.post('/api/notes', (req, res) => {",
          '  res.json({ ok: true });',
          '});'
        ].join('\n')
      );
      const routes: RouteEntry[] = [{ path: '/api/notes', method: 'POST', file: 'server.ts', kind: 'api', startLine: 3 }];

      const files = generateContracts(dir, routes);

      expect(files[0]?.content).not.toContain('Inferred request body fields');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('adds a "required" clause when the handler rejects a missing field with a 4xx response', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-contracts-'));
    try {
      writeFileSync(
        join(dir, 'route.ts'),
        [
          'export async function POST(request) {',
          '  const { name, message } = await request.json();',
          '  if (!name || !message) {',
          "    return NextResponse.json({ error: 'name and message are both required' }, { status: 400 });",
          '  }',
          '  return NextResponse.json({ id: 1, name, message }, { status: 201 });',
          '}'
        ].join('\n')
      );
      const routes: RouteEntry[] = [{ path: '/api/notes', method: 'POST', file: 'route.ts', kind: 'api', startLine: 1 }];

      const files = generateContracts(dir, routes);

      expect(files[0]?.content).toContain('`name` — required (checked via: `!name`)');
      expect(files[0]?.content).toContain('`message` — required (checked via: `!message`)');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('adds a "must be a `string`" clause for a typeof-check guard', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-contracts-'));
    try {
      writeFileSync(
        join(dir, 'route.ts'),
        [
          'export async function POST(request) {',
          '  const { message } = await request.json();',
          "  if (typeof message !== 'string') {",
          "    return NextResponse.json({ error: 'invalid message' }, { status: 400 });",
          '  }',
          '  return NextResponse.json({ id: 1, message }, { status: 201 });',
          '}'
        ].join('\n')
      );
      const routes: RouteEntry[] = [{ path: '/api/notes', method: 'POST', file: 'route.ts', kind: 'api', startLine: 1 }];

      const files = generateContracts(dir, routes);

      expect(files[0]?.content).toContain("`message` — must be a `string` (checked via: `typeof message !== 'string'`)");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('adds a "must be non-empty" clause for an explicit non-empty-length guard', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-contracts-'));
    try {
      writeFileSync(
        join(dir, 'route.ts'),
        [
          'export async function POST(request) {',
          '  const { tags } = await request.json();',
          '  if (tags.length === 0) {',
          "    return NextResponse.json({ error: 'tags required' }, { status: 400 });",
          '  }',
          '  return NextResponse.json({ id: 1, tags }, { status: 201 });',
          '}'
        ].join('\n')
      );
      const routes: RouteEntry[] = [{ path: '/api/notes', method: 'POST', file: 'route.ts', kind: 'api', startLine: 1 }];

      const files = generateContracts(dir, routes);

      expect(files[0]?.content).toContain('`tags` — must be non-empty (checked via: `tags.length === 0`)');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('renders the request-fields section exactly as before when no validation guard is present', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-contracts-'));
    try {
      writeFileSync(
        join(dir, 'server.ts'),
        [
          "import express from 'express';",
          '',
          "app.post('/api/notes', (req, res) => {",
          '  const { message } = req.body;',
          '  res.json({ message });',
          '});'
        ].join('\n')
      );
      const routes: RouteEntry[] = [{ path: '/api/notes', method: 'POST', file: 'server.ts', kind: 'api', startLine: 3 }];

      const files = generateContracts(dir, routes);

      expect(files[0]?.content).toContain('- `message`\n');
      expect(files[0]?.content).not.toContain('required');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('adds an inferred-response-body-fields section for an API route with a literal response', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-contracts-'));
    try {
      writeFileSync(
        join(dir, 'server.ts'),
        [
          "import express from 'express';",
          '',
          "app.post('/api/notes', (req, res) => {",
          '  res.status(201).json({ id: 1, name, message });',
          '});'
        ].join('\n')
      );
      const routes: RouteEntry[] = [{ path: '/api/notes', method: 'POST', file: 'server.ts', kind: 'api', startLine: 3 }];

      const files = generateContracts(dir, routes);

      expect(files[0]?.content).toContain('Inferred response body fields');
      expect(files[0]?.content).toContain('`message`');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('adds a "computed as" clause when a response field traces to a real value expression', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-contracts-'));
    try {
      writeFileSync(
        join(dir, 'route.ts'),
        [
          "export async function POST(request) {",
          '  const created_at = new Date().toISOString();',
          '  return NextResponse.json({ id: 1, created_at }, { status: 201 });',
          '}'
        ].join('\n')
      );
      const routes: RouteEntry[] = [{ path: '/api/notes', method: 'POST', file: 'route.ts', kind: 'api', startLine: 1 }];

      const files = generateContracts(dir, routes);

      expect(files[0]?.content).toContain('`created_at` — computed as: `new Date().toISOString()`');
      // `id` has no traceable expression (a plain literal) — rendered plainly, no clause.
      expect(files[0]?.content).toContain('- `id`\n');
      expect(files[0]?.content).not.toContain('`id` — computed as');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('renders the response-fields section exactly as before when no field has a traceable value expression', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-contracts-'));
    try {
      writeFileSync(
        join(dir, 'server.ts'),
        [
          "import express from 'express';",
          '',
          "app.post('/api/notes', (req, res) => {",
          '  res.status(201).json({ id: 1, name, message });',
          '});'
        ].join('\n')
      );
      const routes: RouteEntry[] = [{ path: '/api/notes', method: 'POST', file: 'server.ts', kind: 'api', startLine: 3 }];

      const files = generateContracts(dir, routes);

      expect(files[0]?.content).not.toContain('computed as');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('renders no field bullets, but still documents a confident success status, when the response is built by calling a separate function with no resolvable import', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-contracts-'));
    try {
      writeFileSync(
        join(dir, 'server.ts'),
        [
          "import express from 'express';",
          '',
          "app.post('/api/notes', (req, res) => {",
          '  res.status(201).json(createNote(req.body.name, req.body.message));',
          '});'
        ].join('\n')
      );
      const routes: RouteEntry[] = [{ path: '/api/notes', method: 'POST', file: 'server.ts', kind: 'api', startLine: 3 }];

      const files = generateContracts(dir, routes);

      // Fields are still unresolved (no import statement to follow at all) —
      // additive-only: the section now renders because a confident success
      // status exists independently, not because fields were found.
      const content = files[0]?.content ?? '';
      const responseSection = content.slice(content.indexOf('## Inferred response body fields'));
      expect(responseSection).toContain('**Success status:** `201`');
      expect(responseSection).not.toMatch(/^- `/m);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('resolves cross-file response fields via one level of relative import when same-file extraction finds nothing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-contracts-'));
    try {
      mkdirSync(join(dir, 'app', 'api', 'notes'), { recursive: true });
      mkdirSync(join(dir, 'lib'), { recursive: true });
      writeFileSync(
        join(dir, 'app', 'api', 'notes', 'route.ts'),
        [
          "import { NextResponse } from 'next/server';",
          "import { createNote } from '../../../lib/db';",
          'export async function POST(request) {',
          '  const { name, message } = await request.json();',
          '  return NextResponse.json(createNote(name, message), { status: 201 });',
          '}'
        ].join('\n')
      );
      writeFileSync(
        join(dir, 'lib', 'db.ts'),
        [
          'export function createNote(name, message) {',
          '  const created_at = new Date().toISOString();',
          '  return { id: 1, name, message, created_at };',
          '}'
        ].join('\n')
      );
      const routes: RouteEntry[] = [{ path: '/api/notes', method: 'POST', file: 'app/api/notes/route.ts', kind: 'api', startLine: 3 }];

      const files = generateContracts(dir, routes);

      expect(files[0]?.content).toContain('Inferred response body fields');
      expect(files[0]?.content).toContain('`created_at` — computed as: `new Date().toISOString()`');
      expect(files[0]?.content).toContain("resolved from that function's own return statement");
      expect(files[0]?.content).toContain('`createNote()`');
      expect(files[0]?.content).toContain('lib/db.ts');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('renders no field bullets, but still documents an implicit 200, when cross-file field resolution finds nothing (a bare-array GET-list callee)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-contracts-'));
    try {
      mkdirSync(join(dir, 'app', 'api', 'notes'), { recursive: true });
      mkdirSync(join(dir, 'lib'), { recursive: true });
      writeFileSync(
        join(dir, 'app', 'api', 'notes', 'route.ts'),
        [
          "import { NextResponse } from 'next/server';",
          "import { listNotes } from '../../../lib/db';",
          'export async function GET() {',
          '  return NextResponse.json(listNotes());',
          '}'
        ].join('\n')
      );
      writeFileSync(
        join(dir, 'lib', 'db.ts'),
        ["export function listNotes() {", "  return db.prepare('SELECT * FROM notes').all();", '}'].join('\n')
      );
      const routes: RouteEntry[] = [{ path: '/api/notes', method: 'GET', file: 'app/api/notes/route.ts', kind: 'api', startLine: 3 }];

      const files = generateContracts(dir, routes);

      expect(files[0]?.content).toContain('Inferred response body fields');
      expect(files[0]?.content).toContain('**Success status:** `200`');
      expect(files[0]?.content).not.toMatch(/^- `/m);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('omits the section entirely when neither fields nor a confident success status can be found', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-contracts-'));
    try {
      writeFileSync(
        join(dir, 'route.ts'),
        [
          'export async function POST(request) {',
          '  const { name } = await request.json();',
          '  if (name) {',
          '    return NextResponse.json(createNote(name), { status: 201 });',
          '  } else {',
          '    return NextResponse.json(buildError(), { status: 400 });',
          '  }',
          '}'
        ].join('\n')
      );
      const routes: RouteEntry[] = [{ path: '/api/notes', method: 'POST', file: 'route.ts', kind: 'api', startLine: 1 }];

      const files = generateContracts(dir, routes);

      // Both branches delegate to bare, unresolvable calls (no import at
      // all) — no fields found on either side, and both returns are guarded
      // by the if/else, so no confident success status either.
      expect(files[0]?.content).not.toContain('Inferred response body fields');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('omits the inferred-response-body-fields section for a page route', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-contracts-'));
    try {
      writeFileSync(join(dir, 'page.tsx'), 'export default function Home() { return null; }');
      const routes: RouteEntry[] = [{ path: '/', file: 'page.tsx', kind: 'page', startLine: 1 }];

      const files = generateContracts(dir, routes);

      expect(files[0]?.content).not.toContain('Inferred response body fields');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('adds a declared-CSS-animations section listing both keyframes and transitions when both are detected', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-contracts-'));
    try {
      writeFileSync(join(dir, 'page.tsx'), 'export default function Home() { return null; }');
      const routes: RouteEntry[] = [{ path: '/', file: 'page.tsx', kind: 'page', startLine: 1 }];

      const files = generateContracts(dir, routes, [], [], [
        {
          routeFile: 'page.tsx',
          keyframeUsages: [
            { selector: '.hero', keyframeName: 'hero-rise', trigger: 'unconditional' },
            { selector: '.cta', keyframeName: 'glow-pulse', trigger: 'unconditional' }
          ],
          transitionUsages: [{ selector: '.card', trigger: 'unconditional' }]
        }
      ]);

      expect(files[0]?.content).toContain('Declared CSS animations/transitions');
      expect(files[0]?.content).toContain('### Animations');
      expect(files[0]?.content).toContain('`.hero` → `hero-rise` (unconditional)');
      expect(files[0]?.content).toContain('`.cta` → `glow-pulse` (unconditional)');
      expect(files[0]?.content).toContain('### Transitions');
      expect(files[0]?.content).toContain('`.card` (unconditional)');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('renders only the animations subsection when no transitions were detected', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-contracts-'));
    try {
      writeFileSync(join(dir, 'page.tsx'), 'export default function Home() { return null; }');
      const routes: RouteEntry[] = [{ path: '/', file: 'page.tsx', kind: 'page', startLine: 1 }];

      const files = generateContracts(dir, routes, [], [], [
        {
          routeFile: 'page.tsx',
          keyframeUsages: [{ selector: '.hero', keyframeName: 'hero-rise', trigger: 'unconditional' }],
          transitionUsages: []
        }
      ]);

      expect(files[0]?.content).toContain('### Animations');
      expect(files[0]?.content).not.toContain('### Transitions');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('renders only the transitions subsection when no animations were detected', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-contracts-'));
    try {
      writeFileSync(join(dir, 'page.tsx'), 'export default function Home() { return null; }');
      const routes: RouteEntry[] = [{ path: '/', file: 'page.tsx', kind: 'page', startLine: 1 }];

      const files = generateContracts(dir, routes, [], [], [
        { routeFile: 'page.tsx', keyframeUsages: [], transitionUsages: [{ selector: '.card', trigger: 'unconditional' }] }
      ]);

      expect(files[0]?.content).not.toContain('### Animations');
      expect(files[0]?.content).toContain('### Transitions');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('omits the section for a route with no matching entry, even when other routes in the same call have one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-contracts-'));
    try {
      writeFileSync(join(dir, 'animated.tsx'), 'export default function Animated() { return null; }');
      writeFileSync(join(dir, 'plain.tsx'), 'export default function Plain() { return null; }');
      const routes: RouteEntry[] = [
        { path: '/animated', file: 'animated.tsx', kind: 'page', startLine: 1 },
        { path: '/plain', file: 'plain.tsx', kind: 'page', startLine: 1 }
      ];

      const files = generateContracts(dir, routes, [], [], [
        {
          routeFile: 'animated.tsx',
          keyframeUsages: [{ selector: '.hero', keyframeName: 'hero-rise', trigger: 'unconditional' }],
          transitionUsages: []
        }
      ]);

      const plainFile = files.find((f) => f.filename === 'PAGE-plain.md');
      expect(plainFile?.content).not.toContain('Declared CSS animations/transitions');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('labels a state-gated animation with its trigger, not "unconditional"', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-contracts-'));
    try {
      writeFileSync(join(dir, 'page.tsx'), 'export default function Home() { return null; }');
      const routes: RouteEntry[] = [{ path: '/', file: 'page.tsx', kind: 'page', startLine: 1 }];

      const files = generateContracts(dir, routes, [], [], [
        {
          routeFile: 'page.tsx',
          keyframeUsages: [{ selector: '.button', keyframeName: 'glow-pulse', trigger: ':hover' }],
          transitionUsages: []
        }
      ]);

      expect(files[0]?.content).toContain('`.button` → `glow-pulse` (:hover)');
      expect(files[0]?.content).not.toContain('`.button` → `glow-pulse` (unconditional)');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('lists each selector separately when two different selectors use the same keyframe', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-contracts-'));
    try {
      writeFileSync(join(dir, 'page.tsx'), 'export default function Home() { return null; }');
      const routes: RouteEntry[] = [{ path: '/', file: 'page.tsx', kind: 'page', startLine: 1 }];

      const files = generateContracts(dir, routes, [], [], [
        {
          routeFile: 'page.tsx',
          keyframeUsages: [
            { selector: '.hero', keyframeName: 'hero-rise', trigger: 'unconditional' },
            { selector: '.card', keyframeName: 'hero-rise', trigger: 'unconditional' }
          ],
          transitionUsages: []
        }
      ]);

      expect(files[0]?.content).toContain('`.hero` → `hero-rise` (unconditional)');
      expect(files[0]?.content).toContain('`.card` → `hero-rise` (unconditional)');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('omits the section entirely when no pageStylesheetAnimations argument is passed (default-empty-array backward compat)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-contracts-'));
    try {
      writeFileSync(join(dir, 'page.tsx'), 'export default function Home() { return null; }');
      const routes: RouteEntry[] = [{ path: '/', file: 'page.tsx', kind: 'page', startLine: 1 }];

      const files = generateContracts(dir, routes);

      expect(files[0]?.content).not.toContain('Declared CSS animations/transitions');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
