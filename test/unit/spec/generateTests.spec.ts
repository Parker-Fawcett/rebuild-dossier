import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateTests } from '../../../src/spec/generateTests.js';
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
      expect(all[0]?.content).toContain("import { app } from '../../server.js'");
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
});
