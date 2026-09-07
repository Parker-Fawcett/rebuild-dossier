import { describe, expect, it } from 'vitest';
import { inferResponseBodyFields } from '../../../src/spec/inferResponseBodyFields.js';
import { resolveBareResponseFields } from '../../../src/spec/resolveResponseVariableFields.js';
import type { RouteEntry } from '../../../src/ingest/evidenceSchema.js';

function route(overrides: Partial<RouteEntry> = {}): RouteEntry {
  return { path: '/api/tasks', method: 'GET', file: 'server.js', kind: 'api', ...overrides };
}

const HANDLER_OPEN = "app.get('/api/tasks', async (req, res) => {";
const HANDLER_CLOSE = '});';

function handler(body: string): string {
  return `${HANDLER_OPEN}\n${body}\n${HANDLER_CLOSE}`;
}

describe('resolveBareResponseFields', () => {
  it('resolves explicit SELECT columns through a db call (issue #8)', () => {
    const source = handler(
      "  const tasks = await db.all('SELECT id, title, dueDate FROM tasks WHERE user_id = ?', req.query.userId);\n  return res.status(200).json(tasks);"
    );
    expect(inferResponseBodyFields(source, route())).toEqual(
      expect.arrayContaining(['id', 'title', 'dueDate'])
    );
  });

  it('resolves SELECT * through a same-file CREATE TABLE', () => {
    const source = [
      "db.exec('CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT, dueDate TEXT, created_at TEXT)');",
      HANDLER_OPEN,
      "  const tasks = await db.all('SELECT * FROM tasks');",
      '  return res.json(tasks);',
      HANDLER_CLOSE
    ].join('\n');
    expect(inferResponseBodyFields(source, route())).toEqual(
      expect.arrayContaining(['id', 'title', 'dueDate', 'created_at'])
    );
  });

  it('resolves better-sqlite3 prepare().get() chains', () => {
    const source = handler(
      "  const row = db.prepare('SELECT id, title FROM tasks WHERE id = ?').get(req.params.id);\n  return res.json(row);"
    );
    expect(inferResponseBodyFields(source, route())).toEqual(expect.arrayContaining(['id', 'title']));
  });

  it('resolves column aliases to their alias names', () => {
    const source = handler(
      "  const rows = await db.all('SELECT created_at AS createdAt FROM tasks');\n  return res.json(rows);"
    );
    const fields = inferResponseBodyFields(source, route());
    expect(fields).toContain('createdAt');
    expect(fields).not.toContain('created_at');
  });

  it('follows one alias hop', () => {
    const source = handler(
      "  const rows = await db.all('SELECT id FROM tasks');\n  const out = rows;\n  return res.json(out);"
    );
    expect(inferResponseBodyFields(source, route())).toContain('id');
  });

  it('resolves object-literal initializers by key', () => {
    const source = handler(
      '  const out = { id: 1, title: t };\n  return res.json(out);'
    );
    expect(inferResponseBodyFields(source, route())).toEqual(expect.arrayContaining(['id', 'title']));
  });

  it('bails on aggregates rather than inventing a field', () => {
    const source = handler(
      "  const n = await db.get('SELECT COUNT(*) AS c FROM tasks');\n  return res.json(n);"
    );
    expect(inferResponseBodyFields(source, route())).toEqual([]);
  });

  it('bails on SELECT * with no discoverable table schema', () => {
    const source = handler(
      "  const tasks = await db.all('SELECT * FROM tasks');\n  return res.json(tasks);"
    );
    expect(inferResponseBodyFields(source, route())).toEqual([]);
  });

  it('bails on parameter-passed variables with no local declaration', () => {
    const source = handler('  return res.json(req.user);');
    expect(resolveBareResponseFields(source, source, 'req')).toEqual([]);
  });

  it('bails on cyclic aliases instead of looping', () => {
    const source = handler('  const a = b;\n  const b = a;\n  return res.json(a);');
    expect(inferResponseBodyFields(source, route())).toEqual([]);
  });
});
