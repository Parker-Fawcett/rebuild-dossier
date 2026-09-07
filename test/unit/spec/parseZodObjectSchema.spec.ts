import { describe, expect, it } from 'vitest';
import { findZodSchemasForRoute, inferZodRequiredFields } from '../../../src/spec/parseZodObjectSchema.js';
import type { RouteEntry } from '../../../src/ingest/evidenceSchema.js';

function route(overrides: Partial<RouteEntry> = {}): RouteEntry {
  return { path: '/api/tasks', method: 'POST', file: 'server.ts', kind: 'api', ...overrides };
}

describe('parseZodObjectSchema', () => {
  it('finds a schema applied via .parse on req.body, with required flags and messages', () => {
    const source = [
      "import { z } from 'zod';",
      'const taskSchema = z.object({',
      "  title: z.string().min(1, 'Title is required'),",
      '  count: z.number().optional(),',
      '});',
      'app.post(\'/api/tasks\', (req, res) => {',
      '  const parsed = taskSchema.parse(req.body);',
      '  res.status(201).json(parsed);',
      '});'
    ].join('\n');

    const schemas = findZodSchemasForRoute(source, route());
    expect(schemas).toHaveLength(1);
    expect(schemas[0]?.name).toBe('taskSchema');
    expect(schemas[0]?.fields).toEqual([
      {
        name: 'title',
        required: true,
        baseType: 'string',
        constraints: [
          { method: 'string', rawArgs: '' },
          { method: 'min', rawArgs: "1, 'Title is required'", message: 'Title is required' }
        ],
        expression: "z.string().min(1, 'Title is required')"
      },
      {
        name: 'count',
        required: false,
        baseType: 'number',
        constraints: [{ method: 'number', rawArgs: '' }],
        expression: 'z.number().optional()'
      }
    ]);
  });

  it('ignores schemas never applied to request data', () => {
    const source = [
      "import { z } from 'zod';",
      'const configSchema = z.object({ port: z.number() });',
      'const port = configSchema.parse(process.env);',
      'app.post(\'/api/tasks\', (req, res) => {',
      '  res.status(201).json({});',
      '});'
    ].join('\n');

    expect(findZodSchemasForRoute(source, route())).toEqual([]);
  });

  it('reads messages from { message } and { error } options objects', () => {
    const source = [
      "import { z } from 'zod';",
      'const s = z.object({',
      "  a: z.string().min(3, { message: 'too short' }),",
      "  b: z.string().max(5, { error: 'too long' }),",
      '});',
      'app.post(\'/api/tasks\', (req, res) => {',
      '  s.parse(req.body);',
      '  res.status(201).json({});',
      '});'
    ].join('\n');

    const schemas = findZodSchemasForRoute(source, route());
    expect(schemas[0]?.fields.map((f) => f.constraints.map((c) => c.message))).toEqual([
      [undefined, 'too short'],
      [undefined, 'too long']
    ]);
  });

  it('treats .default() as not-required and .nullable() as required', () => {
    const source = [
      "import { z } from 'zod';",
      'const s = z.object({',
      "  a: z.string().default('x'),",
      '  b: z.string().nullable(),',
      '});',
      'app.post(\'/api/tasks\', (req, res) => {',
      '  s.parse(req.body);',
      '  res.status(201).json({});',
      '});'
    ].join('\n');

    expect(inferZodRequiredFields(source, route())).toEqual(['b']);
  });

  it('returns no names when no schema is applied', () => {
    const source = "app.post('/api/tasks', (req, res) => { res.status(201).json({}); });";
    expect(inferZodRequiredFields(source, route())).toEqual([]);
  });
});
