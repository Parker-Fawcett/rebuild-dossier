import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateTests, importClosure } from '../../../src/spec/generateTests.js';
import type { EvidenceBundle } from '../../../src/ingest/evidenceSchema.js';
import type { Case } from '../../../src/reconciliation/types.js';

const now = new Date(0).toISOString();

function minimalEvidence(overrides: Partial<EvidenceBundle> = {}): EvidenceBundle {
  return {
    repoPath: 'irrelevant',
    generatedAt: now,
    packageJson: { scripts: {}, dependencies: { express: '^4.19.0' }, devDependencies: {} },
    buildConfig: [],
    routes: [],
    existingTests: [],
    signals: [],
    ...overrides
  };
}

describe('generateTests', () => {
  // Cold-run regression: `const app = express(); ... app.listen(5500)` with no
  // export (the usual small-app shape) produced zero tests and said nothing.
  it('explains, instead of silently generating nothing, when the Express app is never exported', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-gentests-'));
    try {
      writeFileSync(join(dir, 'index.js'), "const express = require('express');\nconst app = express();\napp.get('/users', (req, res) => res.send([]));\napp.listen(5500);\n");
      const evidence = minimalEvidence({
        routes: [{ path: '/users', method: 'GET', file: 'index.js', kind: 'api', startLine: 3 }]
      });

      const { visible, heldOut, note } = generateTests(dir, evidence, []);

      expect([...visible, ...heldOut]).toHaveLength(0);
      expect(note).toContain('Found 1 Express API route(s) but no exported Express app instance');
      expect(note).toContain('module.exports = app;');
      expect(note).toContain('require.main === module');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('has no note when the app is exported', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-gentests-'));
    try {
      writeFileSync(join(dir, 'index.js'), "const express = require('express');\nconst app = express();\nmodule.exports = app;\n");
      const evidence = minimalEvidence({
        routes: [{ path: '/users', method: 'GET', file: 'index.js', kind: 'api', startLine: 3 }]
      });
      expect(generateTests(dir, evidence, []).note).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('generates an existence contract test for every API route, from-repo tagged', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-gentests-'));
    try {
      writeFileSync(join(dir, 'server.ts'), "import express from 'express';\nconst app = express();\nexport default app;\n");
      const evidence = minimalEvidence({
        routes: [{ path: '/api/users/:id', method: 'GET', file: 'server.ts', kind: 'api', startLine: 6 }]
      });

      const { visible, heldOut } = generateTests(dir, evidence, []);

      const all = [...visible, ...heldOut];
      expect(all).toHaveLength(1);
      expect(all[0]?.content).toContain("import app from '../../server.js'");
      expect(all[0]?.content).toContain('/api/users/:id');
      expect(all[0]?.content).toContain('res.status');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('adds a reconciliation-backed assertion when a resolved case states the expected status, for behavior confirmed intentional', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-gentests-'));
    try {
      writeFileSync(join(dir, 'server.ts'), "import express from 'express';\nconst app = express();\nexport default app;\n");
      const evidence = minimalEvidence({
        routes: [{ path: '/api/users/:id', method: 'GET', file: 'server.ts', kind: 'api', startLine: 6 }]
      });
      const cases: Case[] = [
        {
          id: 'case:route:GET:/api/users/:id',
          topicKey: 'route:GET:/api/users/:id',
          signals: [
            {
              id: 's1',
              source: 'ingest',
              locator: { file: 'server.ts', startLine: 6, endLine: 6 },
              topicKey: 'route:GET:/api/users/:id',
              claim: 'returns 404 when the user does not exist',
              evidenceText: 'e',
              detectedAt: now
            }
          ],
          matchedKnownBugs: [],
          status: 'auto_resolved',
          autoResolution: { decision: 'intentional', reason: 'r' }
        }
      ];

      const { visible, heldOut } = generateTests(dir, evidence, cases);
      const content = [...visible, ...heldOut].map((f) => f.content).join('\n');

      expect(content).toContain('404');
      expect(content).toContain('from-reconciliation');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not fabricate an assertion for a case resolved as a bug (correct fixed value unknown)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-gentests-'));
    try {
      writeFileSync(join(dir, 'server.ts'), "import express from 'express';\nconst app = express();\nexport default app;\n");
      const evidence = minimalEvidence({
        routes: [{ path: '/api/users/:id', method: 'GET', file: 'server.ts', kind: 'api', startLine: 6 }]
      });
      const cases: Case[] = [
        {
          id: 'case:route:GET:/api/users/:id',
          topicKey: 'route:GET:/api/users/:id',
          signals: [
            {
              id: 's1',
              source: 'ingest',
              locator: { file: 'server.ts', startLine: 6, endLine: 6 },
              topicKey: 'route:GET:/api/users/:id',
              claim: 'returns 404 when the user does not exist',
              evidenceText: 'e',
              detectedAt: now
            }
          ],
          matchedKnownBugs: ['bug-1'],
          status: 'auto_resolved',
          autoResolution: { decision: 'bug', reason: 'r' }
        }
      ];

      const { visible, heldOut } = generateTests(dir, evidence, cases);
      const content = [...visible, ...heldOut].map((f) => f.content).join('\n');

      expect(content).not.toContain('from-reconciliation');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('splits generated files deterministically between visible and held-out', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-gentests-'));
    try {
      writeFileSync(join(dir, 'server.ts'), "import express from 'express';\nconst app = express();\nexport default app;\n");
      const evidence = minimalEvidence({
        routes: [
          { path: '/a', method: 'GET', file: 'server.ts', kind: 'api', startLine: 1 },
          { path: '/b', method: 'GET', file: 'server.ts', kind: 'api', startLine: 2 },
          { path: '/c', method: 'GET', file: 'server.ts', kind: 'api', startLine: 3 }
        ]
      });

      const first = generateTests(dir, evidence, []);
      const second = generateTests(dir, evidence, []);

      expect(first.heldOut.length).toBeGreaterThan(0);
      expect(first.visible.length).toBeGreaterThan(0);
      // deterministic: same input always produces the same split
      expect(second.heldOut.map((f) => f.filename)).toEqual(first.heldOut.map((f) => f.filename));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('adds a from-source success-status assertion for a body-carrying route with no dynamic path segment (Express)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-gentests-'));
    try {
      writeFileSync(
        join(dir, 'server.ts'),
        [
          "import express from 'express';",
          'const app = express();',
          "app.post('/api/notes', (req, res) => {",
          '  const { name } = req.body;',
          '  if (!name) {',
          "    return res.status(400).json({ error: 'name required' });",
          '  }',
          '  return res.status(201).json({ id: 1, name });',
          '});',
          'export default app;'
        ].join('\n')
      );
      const evidence = minimalEvidence({
        routes: [{ path: '/api/notes', method: 'POST', file: 'server.ts', kind: 'api', startLine: 3 }]
      });

      const { visible, heldOut } = generateTests(dir, evidence, []);
      const content = [...visible, ...heldOut][0]?.content ?? '';

      expect(content).toContain('returns 201 on success (from-source)');
      expect(content).toContain('expect(res.status).toBe(201)');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not add a from-source success-status assertion for a route with a dynamic path segment (Express)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-gentests-'));
    try {
      writeFileSync(
        join(dir, 'server.ts'),
        [
          "import express from 'express';",
          'const app = express();',
          "app.get('/api/users/:id', (req, res) => {",
          '  const user = findUser(req.params.id);',
          '  if (!user) {',
          "    return res.status(404).json({ error: 'not found' });",
          '  }',
          '  return res.status(200).json(user);',
          '});',
          'export default app;'
        ].join('\n')
      );
      const evidence = minimalEvidence({
        routes: [{ path: '/api/users/:id', method: 'GET', file: 'server.ts', kind: 'api', startLine: 3 }]
      });

      const { visible, heldOut } = generateTests(dir, evidence, []);
      const content = [...visible, ...heldOut][0]?.content ?? '';

      expect(content).not.toContain('from-source');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('sends a JSON body for POST/PUT/PATCH using inferred field names, so a handler reading req.body does not crash', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-gentests-'));
    try {
      writeFileSync(
        join(dir, 'server.ts'),
        [
          "import express from 'express';",
          'const app = express();',
          "app.post('/api/notes', (req, res) => {",
          '  const { message } = req.body;',
          '  res.json({ id: 1, message });',
          '});',
          'export default app;'
        ].join('\n')
      );
      const evidence = minimalEvidence({
        routes: [{ path: '/api/notes', method: 'POST', file: 'server.ts', kind: 'api', startLine: 3 }]
      });

      const { visible, heldOut } = generateTests(dir, evidence, []);
      const content = [...visible, ...heldOut][0]?.content ?? '';

      expect(content).toContain("body: JSON.stringify({ message: 'test-value-123' })");
      expect(content).toContain("'Content-Type': 'application/json'");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not send a body for GET (Express)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-gentests-'));
    try {
      writeFileSync(
        join(dir, 'server.ts'),
        [
          "import express from 'express';",
          'const app = express();',
          "app.get('/api/notes/:id', (req, res) => { res.json({ id: req.params.id }); });",
          'export default app;'
        ].join('\n')
      );
      const evidence = minimalEvidence({
        routes: [{ path: '/api/notes/:id', method: 'GET', file: 'server.ts', kind: 'api', startLine: 3 }]
      });

      const { visible, heldOut } = generateTests(dir, evidence, []);
      const content = [...visible, ...heldOut][0]?.content ?? '';

      expect(content).not.toContain('body:');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('sends an empty JSON body for DELETE, so a handler reading the request body does not crash (Express, same real, live-triggered bug as the Next.js generator)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-gentests-'));
    try {
      writeFileSync(
        join(dir, 'server.ts'),
        [
          "import express from 'express';",
          'const app = express();',
          "app.delete('/api/notes', (req, res) => { const { id } = req.body; res.json({ id }); });",
          'export default app;'
        ].join('\n')
      );
      const evidence = minimalEvidence({
        routes: [{ path: '/api/notes', method: 'DELETE', file: 'server.ts', kind: 'api', startLine: 3 }]
      });

      const { visible, heldOut } = generateTests(dir, evidence, []);
      const content = [...visible, ...heldOut][0]?.content ?? '';

      expect(content).toContain("body: JSON.stringify({})");
      expect(content).toContain("'Content-Type': 'application/json'");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falls back to an empty-object body when extraction finds nothing (Express)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-gentests-'));
    try {
      writeFileSync(
        join(dir, 'server.ts'),
        [
          "import express from 'express';",
          'const app = express();',
          "app.post('/api/notes', (req, res) => { res.json({ ok: true }); });",
          'export default app;'
        ].join('\n')
      );
      const evidence = minimalEvidence({
        routes: [{ path: '/api/notes', method: 'POST', file: 'server.ts', kind: 'api', startLine: 3 }]
      });

      const { visible, heldOut } = generateTests(dir, evidence, []);
      const content = [...visible, ...heldOut][0]?.content ?? '';

      expect(content).toContain('body: JSON.stringify({})');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns no generated tests when express is not a dependency or no app export is found', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-gentests-'));
    try {
      const evidence = minimalEvidence({
        packageJson: { scripts: {}, dependencies: {}, devDependencies: {} },
        routes: [{ path: '/api/users/:id', method: 'GET', file: 'server.ts', kind: 'api', startLine: 6 }]
      });
      const { visible, heldOut } = generateTests(dir, evidence, []);
      expect(visible).toEqual([]);
      expect(heldOut).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Issue #7: named ESM app exports must generate tests, with a named import.
  it('generates tests for a named app export, using a named import', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-gentests-'));
    try {
      writeFileSync(join(dir, 'server.ts'), "import express from 'express';\nexport const app = express();\n");
      const evidence = minimalEvidence({
        routes: [{ path: '/api/users', method: 'GET', file: 'server.ts', kind: 'api', startLine: 1 }]
      });

      const { visible, heldOut } = generateTests(dir, evidence, []);

      const all = [...visible, ...heldOut];
      expect(all).toHaveLength(1);
      expect(all[0]?.content).toContain("import { app } from '../../server.js'");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('generates tests for an export-list app export (`export { app }`)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-gentests-'));
    try {
      writeFileSync(join(dir, 'server.ts'), "import express from 'express';\nconst app = express();\nexport { app };\n");
      const evidence = minimalEvidence({
        routes: [{ path: '/api/users', method: 'GET', file: 'server.ts', kind: 'api', startLine: 1 }]
      });

      const { visible, heldOut } = generateTests(dir, evidence, []);

      const all = [...visible, ...heldOut];
      expect(all).toHaveLength(1);
      expect(all[0]?.content).toContain("import { app } from '../../server.js'");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('generates tests for a CommonJS app export (`module.exports = app`)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-gentests-'));
    try {
      writeFileSync(join(dir, 'server.js'), "const express = require('express');\nconst app = express();\nmodule.exports = app;\n");
      const evidence = minimalEvidence({
        routes: [{ path: '/api/users', method: 'GET', file: 'server.js', kind: 'api', startLine: 1 }]
      });

      const { visible, heldOut } = generateTests(dir, evidence, []);

      const all = [...visible, ...heldOut];
      expect(all).toHaveLength(1);
      expect(all[0]?.content).toContain("import app from '../../server.js'");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Executes the generated import line instead of string-matching it: the
  // string-only version above once asserted `import { app }`, which binds
  // undefined for `module.exports = app` and hung every generated test.
  it('emits an import that actually binds the app for `module.exports = app`', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-gentests-'));
    try {
      writeFileSync(join(dir, 'server.js'), "const app = function handler(req, res) { res.end('ok'); };\nmodule.exports = app;\n");
      const evidence = minimalEvidence({
        routes: [{ path: '/api/users', method: 'GET', file: 'server.js', kind: 'api', startLine: 1 }]
      });
      const { visible, heldOut } = generateTests(dir, evidence, []);
      const importLine = [...visible, ...heldOut][0]!.content.split('\n').find((l) => l.includes("from '../../server.js'"))!;
      mkdirSync(join(dir, 'tests', 'visible'), { recursive: true });
      writeFileSync(join(dir, 'tests', 'visible', 'probe.mjs'), `${importLine}\nprocess.stdout.write(typeof app);\n`);
      const bound = execFileSync(process.execPath, [join(dir, 'tests', 'visible', 'probe.mjs')], { encoding: 'utf-8' });
      expect(bound).toBe('function');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Issue #7's exact shape: route files export only register functions while
  // the app instance lives in an entry file the route list never mentions.
  it('finds the app in an entry file when route files only export register functions', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-gentests-'));
    try {
      writeFileSync(join(dir, 'index.ts'), "import express from 'express';\nimport { registerTaskRoutes } from './routes/tasks.js';\nconst app = express();\nregisterTaskRoutes(app);\nexport default app;\n");
      const evidence = minimalEvidence({
        routes: [{ path: '/api/tasks', method: 'GET', file: 'routes/tasks.ts', kind: 'api', startLine: 1 }]
      });

      const { visible, heldOut } = generateTests(dir, evidence, []);

      const all = [...visible, ...heldOut];
      expect(all).toHaveLength(1);
      expect(all[0]?.content).toContain("import app from '../../index.js'");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('still returns no tests when neither route files nor entry files export an app', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-gentests-'));
    try {
      writeFileSync(join(dir, 'routes.ts'), 'export function registerRoutes(app: unknown) { void app; }\n');
      const evidence = minimalEvidence({
        routes: [{ path: '/api/users', method: 'GET', file: 'routes.ts', kind: 'api', startLine: 1 }]
      });

      const { visible, heldOut } = generateTests(dir, evidence, []);

      expect(visible).toEqual([]);
      expect(heldOut).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('posts the schema-required fields for a Zod-validated route that never destructures the body (issue #9)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-gentests-'));
    try {
      writeFileSync(
        join(dir, 'server.ts'),
        [
          "import express from 'express';",
          "import { z } from 'zod';",
          'const app = express();',
          'app.use(express.json());',
          'const taskSchema = z.object({ title: z.string().min(1) });',
          "app.post('/api/tasks', (req, res) => {",
          '  const parsed = taskSchema.parse(req.body);',
          '  res.status(201).json({ id: 1, title: parsed.title });',
          '});',
          'export default app;'
        ].join('\n')
      );
      const evidence = minimalEvidence({
        routes: [{ path: '/api/tasks', method: 'POST', file: 'server.ts', kind: 'api', startLine: 6 }]
      });

      const { visible, heldOut } = generateTests(dir, evidence, []);
      const content = [...visible, ...heldOut][0]?.content ?? '';

      expect(content).toContain("body: JSON.stringify({ title: 'test-value-123' })");
      expect(content).toContain('expect(res.status).toBe(201)');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Codex cold-run regression: the app-export file and a router it mounts
  // were blocklisted, so no visible test could ever import the app.
  describe('importClosure', () => {
    it('follows relative require/import chains, resolves index files and extensions, and survives cycles', () => {
      const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-closure-'));
      try {
        mkdirSync(join(dir, 'src', 'routers'), { recursive: true });
        mkdirSync(join(dir, 'src', 'lib'), { recursive: true });
        writeFileSync(join(dir, 'src', 'index.js'), "const express = require('express');\nconst users = require('./routers/users');\nconst lib = require('./lib');\nmodule.exports = express();\n");
        writeFileSync(join(dir, 'src', 'routers', 'users.js'), "const svc = require('../lib/svc.js');\nmodule.exports = 1;\n");
        writeFileSync(join(dir, 'src', 'lib', 'index.js'), "import helper from './helper.mjs';\nexport * from './svc.js';\n");
        writeFileSync(join(dir, 'src', 'lib', 'helper.mjs'), "import back from '../index.js';\nexport default 1;\n");
        writeFileSync(join(dir, 'src', 'lib', 'svc.js'), "module.exports = 2;\n");
        writeFileSync(join(dir, 'src', 'unrelated.js'), "module.exports = 3;\n");
        expect(importClosure(dir, 'src/index.js').sort()).toEqual([
          'src/index.js',
          'src/lib/helper.mjs',
          'src/lib/index.js',
          'src/lib/svc.js',
          'src/routers/users.js'
        ]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('is returned by generateTests for the exported app, so writeSpecTree can keep those files off the blocklist', () => {
      const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-closure-'));
      try {
        mkdirSync(join(dir, 'routers'), { recursive: true });
        writeFileSync(join(dir, 'index.js'), "const express = require('express');\nconst r = require('./routers/r');\nconst app = express();\napp.use('/r', r);\nmodule.exports = app;\n");
        writeFileSync(join(dir, 'routers', 'r.js'), "const router = require('express').Router();\nrouter.get('/x', h);\nmodule.exports = router;\n");
        const evidence = minimalEvidence({
          routes: [{ path: '/r/x', method: 'GET', file: 'routers/r.js', kind: 'api', startLine: 2 }]
        });
        expect(generateTests(dir, evidence, []).importClosure?.sort()).toEqual(['index.js', 'routers/r.js']);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});

