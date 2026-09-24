import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expressRouterDetector } from '../../../../src/ingest/routeDetectors/expressRouter.js';

describe('expressRouterDetector', () => {
  it('applies only when express is a dependency', () => {
    expect(expressRouterDetector.applies({ scripts: {}, dependencies: { express: '^4.19.0' }, devDependencies: {} })).toBe(true);
    expect(expressRouterDetector.applies({ scripts: {}, dependencies: {}, devDependencies: {} })).toBe(false);
  });

  it('detects app.get/post/put/delete route registrations with their methods and paths', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-express-'));
    try {
      const file = join(dir, 'server.ts');
      writeFileSync(
        file,
        [
          "app.get('/api/users/:id', (req, res) => {});",
          "app.post('/api/users', (req, res) => {});",
          "router.delete('/api/users/:id', (req, res) => {});"
        ].join('\n')
      );

      const routes = expressRouterDetector.detect(dir, [file]);

      expect(routes).toContainEqual({ path: '/api/users/:id', method: 'GET', file: 'server.ts', kind: 'api', startLine: 1 });
      expect(routes).toContainEqual({ path: '/api/users', method: 'POST', file: 'server.ts', kind: 'api', startLine: 2 });
      expect(routes).toContainEqual({ path: '/api/users/:id', method: 'DELETE', file: 'server.ts', kind: 'api', startLine: 3 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // The shapes below come from a cold run on an unfamiliar Express app, where
  // the old single regex found 3 of 8 routes.
  function project(files: Record<string, string>): { dir: string; paths: string[] } {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-express-'));
    const paths: string[] = [];
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), text);
      paths.push(join(dir, rel));
    }
    return { dir, paths };
  }
  const summary = (routes: { method?: string; path: string }[]) => routes.map((r) => `${r.method} ${r.path}`).sort();

  it('detects chained router.route(path).get().post() registrations, one route per method', () => {
    const { dir, paths } = project({
      'routes.js': [
        "const router = express.Router();",
        "router.route('/').get(list).post(auth.authenticate(), create);",
        "router",
        "  .route('/:id')",
        "  .get(show)",
        "  .put(auth.authenticate(), update)",
        "  .delete(remove);"
      ].join('\n')
    });
    try {
      const routes = expressRouterDetector.detect(dir, paths);
      expect(summary(routes)).toEqual(['DELETE /:id', 'GET /', 'GET /:id', 'POST /', 'PUT /:id']);
      expect(routes.find((r) => r.method === 'PUT')?.startLine).toBe(6);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('applies app.use mount prefixes to a required router file, through middleware arguments', () => {
    const { dir, paths } = project({
      'src/index.js': [
        "const express = require('express');",
        "const usersRouter = require('./routers/usersRouter');",
        "const app = express();",
        "app.get('/', (req, res) => res.redirect('/api/v1/recipes'));",
        "app.use('/api/v1/users', cors(), usersRouter);",
        "app.use('/api/v1/recipes', require('./routers/recipes.js'));"
      ].join('\n'),
      'src/routers/usersRouter.js': "const router = express.Router();\nrouter.post('/signup', h);\nrouter.post('/login', h);\n",
      'src/routers/recipes.js': "const r = express.Router();\nr.route('/').get(list);\nr.get('/:id', show);\n"
    });
    try {
      expect(summary(expressRouterDetector.detect(dir, paths))).toEqual([
        'GET /',
        'GET /api/v1/recipes',
        'GET /api/v1/recipes/:id',
        'POST /api/v1/users/login',
        'POST /api/v1/users/signup'
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('follows nested mounts and ESM default imports', () => {
    const { dir, paths } = project({
      'app.mjs': "import express from 'express';\nimport api from './api/index.mjs';\nconst app = express();\napp.use('/api', api);\n",
      'api/index.mjs': "import { Router } from 'express';\nimport v1 from './v1.mjs';\nconst api = Router();\napi.use('/v1/', v1);\n",
      'api/v1.mjs': "import { Router } from 'express';\nconst v1 = Router();\nv1.get('/health', h);\nexport default v1;\n"
    });
    try {
      expect(summary(expressRouterDetector.detect(dir, paths))).toEqual(['GET /api/v1/health']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not mistake HTTP clients or maps for routes', () => {
    const { dir, paths } = project({
      'client.js': "const res = await axios.get('/api/users');\ncache.delete('/tmp');\nconst v = map.get('/key');\napp.get('/real', h);\n"
    });
    try {
      expect(summary(expressRouterDetector.detect(dir, paths))).toEqual(['GET /real']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

