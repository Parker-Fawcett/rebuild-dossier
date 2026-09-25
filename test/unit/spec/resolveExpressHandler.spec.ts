import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveExpressHandler } from '../../../src/spec/resolveExpressHandler.js';
import type { RouteEntry } from '../../../src/ingest/evidenceSchema.js';

// From a Codex cold run: an Express app registering handlers by name
// (`router.route('/:id').put(auth.authenticate(), updateRecipe)`) got
// contracts containing only that line, and the rebuild agent refused to build
// from contracts with "no handler behavior". The resolver follows the name.
describe('resolveExpressHandler', () => {
  let dir = '';
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const project = (files: Record<string, string>) => {
    dir = mkdtempSync(join(tmpdir(), 'resolve-handler-'));
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), text);
    }
  };
  const route = (over: Partial<RouteEntry>): RouteEntry => ({ path: '/x', method: 'GET', file: 'routes.js', kind: 'api', startLine: 1, ...over });

  it('follows a destructured require through chained registration, past middleware, into the controller and its service call', () => {
    project({
      'src/routers/recipes.js': [
        "const { getRecipe, updateRecipe } = require('../controllers/recipes');",
        "router.route('/:id').get(getRecipe).put(auth.authenticate(), updateRecipe);"
      ].join('\n'),
      'src/controllers/recipes.js': [
        "const recipesServices = require('../services/recipes');",
        'const getRecipe = async (req, res, next) => {',
        '  res.json(await recipesServices.getOne(req.params.id));',
        '};',
        'const updateRecipe = async (req, res, next) => {',
        '  const updated = await recipesServices.update(req.params.id, req.body);',
        '  res.status(200).json(updated);',
        '};',
        'module.exports = { getRecipe, updateRecipe };'
      ].join('\n'),
      'src/services/recipes.js': [
        "const fs = require('fs');",
        'exports.getOne = async (id) => JSON.parse(fs.readFileSync(\'db.json\'))[id];',
        'exports.update = async (id, body) => {',
        "  fs.writeFileSync('db.json', JSON.stringify(body));",
        '  return body;',
        '};'
      ].join('\n')
    });
    const h = resolveExpressHandler(dir, route({ method: 'PUT', path: '/api/v1/recipes/:id', sourcePath: '/:id', file: 'src/routers/recipes.js', startLine: 2 }));
    expect(h).toMatchObject({ file: 'src/controllers/recipes.js', name: 'updateRecipe', startLine: 5 });
    expect(h!.source).toContain('res.status(200).json(updated)');
    expect(h!.callees.map((c) => `${c.file}#${c.name}`)).toEqual(['src/services/recipes.js#update']);
    expect(h!.callees[0]!.source).toContain("fs.writeFileSync('db.json'");
  });

  it('follows a module member reference (ctrl.fn) and an ESM named import', () => {
    project({
      'routes.js': "const ctrl = require('./ctrl');\nrouter.get('/x', ctrl.list);\n",
      'ctrl.js': 'module.exports.list = function (req, res) {\n  res.send(req.query.page);\n};\n',
      'esm.mjs': "import { show } from './show.mjs';\nrouter.post('/y', show);\n",
      'show.mjs': 'export async function show(req, res) {\n  res.status(201).json(req.body);\n}\n'
    });
    expect(resolveExpressHandler(dir, route({ file: 'routes.js', startLine: 2 }))).toMatchObject({ file: 'ctrl.js', name: 'list' });
    const esm = resolveExpressHandler(dir, route({ method: 'POST', path: '/y', file: 'esm.mjs', startLine: 2 }));
    expect(esm).toMatchObject({ file: 'show.mjs', name: 'show' });
    expect(esm!.source).toContain('res.status(201)');
  });

  it('returns an inline handler as written, with the local helpers it calls', () => {
    project({
      'index.js': [
        'const saveUserData = (data) => {',
        "  fs.writeFileSync('users.json', JSON.stringify(data));",
        '};',
        "app.post('/users', (req, res) => {",
        '  const name = req.query.name;',
        '  saveUserData([name]);',
        "  res.send('user added');",
        '});'
      ].join('\n')
    });
    const h = resolveExpressHandler(dir, route({ method: 'POST', path: '/users', file: 'index.js', startLine: 4 }));
    expect(h!.name).toBe('(inline)');
    expect(h!.source).toContain('req.query.name');
    expect(h!.callees.map((c) => c.name)).toEqual(['saveUserData']);
  });

  // Minimal reproducer for the production case (paper §V-C): the bracket
  // matcher skipped string literals but not comments, so a lone apostrophe in
  // "they're" opened a phantom string that ran past the handler's closing
  // paren, and the contract got no handler source at all.
  it("resolves a handler whose body has an apostrophe in a // comment", () => {
    project({
      'server.js': [
        "app.get('/api/kpis', async (req, res) => {",
        "  // Goals are deliberately absent: they're tracked elsewhere.",
        '  const filters = readFilters(req);',
        '  res.json(await loadKpis(filters));',
        '});',
        'function readFilters(req) {',
        '  return { division: req.query.division };',
        '}',
        'async function loadKpis(filters) {',
        '  return { filters };',
        '}'
      ].join('\n')
    });
    const h = resolveExpressHandler(dir, route({ path: '/api/kpis', file: 'server.js', startLine: 1 }));
    expect(h).not.toBeNull();
    expect(h!.source).toContain('loadKpis(filters)');
    expect(h!.callees.map((c) => c.name)).toEqual(['readFilters', 'loadKpis']);
  });

  it("keeps a direct helper whose definition has a lone quote in a line or block comment", () => {
    project({
      'server.js': [
        "app.get('/api/trend', async (req, res) => {",
        "  if (!req.query.channel) return res.status(400).json({ error: 'channel is required' });",
        '  res.json(await loadTrend(req.query.channel));',
        '});',
        'async function loadTrend(channel) {',
        "  // keyed the same way the table's own rows are",
        '  /* sized for 5" panels */',
        '  return { channel };',
        '}'
      ].join('\n')
    });
    const h = resolveExpressHandler(dir, route({ path: '/api/trend', file: 'server.js', startLine: 1 }));
    expect(h!.callees.map((c) => c.name)).toEqual(['loadTrend']);
    expect(h!.callees[0]!.source).toContain('return { channel }');
  });

  // Documents a scope limit, not a bug: callees are captured one level deep,
  // so a helper that only a callee calls is left out. This is the other half
  // of the production case, where the rebuild left such a helper undefined
  // and its visible test, stopping at the input guard, still passed.
  it('captures helpers one level deep, not the helpers they call', () => {
    project({
      'server.js': [
        "app.get('/api/parts', async (req, res) => {",
        "  if (!req.query.channel) return res.status(400).json({ error: 'A channel is required.' });",
        '  res.json(partsSql(req.query.channel));',
        '});',
        'function partsSql(channel) {',
        '  return { sql: `select * where ${divisionFilter(channel)}` };',
        '}',
        'function divisionFilter(channel) {',
        '  return `channel = ${channel}`;',
        '}'
      ].join('\n')
    });
    const h = resolveExpressHandler(dir, route({ path: '/api/parts', file: 'server.js', startLine: 1 }));
    expect(h!.callees.map((c) => c.name)).toEqual(['partsSql']);
  });

  it('returns null rather than guessing when the handler comes from a package', () => {
    project({ 'routes.js': "const { handler } = require('some-package');\nrouter.get('/x', handler);\n" });
    expect(resolveExpressHandler(dir, route({ file: 'routes.js', startLine: 2 }))).toBeNull();
  });
});
