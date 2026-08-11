import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { writeSpecTree } from '../../../src/spec/writeSpecTree.js';
import { KICKOFF_PROMPT } from '../../../src/spec/generateKickoffPrompt.js';
import type { EvidenceBundle } from '../../../src/ingest/evidenceSchema.js';
import type { Case } from '../../../src/reconciliation/types.js';

const ownProjectRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const vitestEntry = join(ownProjectRoot, 'node_modules/vitest/vitest.mjs');

const now = new Date(0).toISOString();

describe('writeSpecTree', () => {
  it('writes the full spec/.claude/tests structure and runs the mutation check', async () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-writetree-repo-'));
    const outputDir = join(tmpdir(), `rebuild-dossier-writetree-out-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    try {
      writeFileSync(
        join(repoDir, 'server.ts'),
        [
          "import express from 'express';",
          'const app = express();',
          "app.get('/api/users/:id', (req, res) => {",
          '  const user = null;',
          '  if (!user) {',
          "    return res.status(404).json({ error: 'not found' });",
          '  }',
          '  return res.status(200).json(user);',
          '});',
          'export default app;'
        ].join('\n')
      );

      const evidence: EvidenceBundle = {
        repoPath: repoDir,
        generatedAt: now,
        packageJson: { name: 'sample-app', scripts: { test: 'npm test' }, dependencies: { express: '^4.19.0' }, devDependencies: {} },
        buildConfig: [],
        routes: [{ path: '/api/users/:id', method: 'GET', file: 'server.ts', kind: 'api', startLine: 3 }],
        existingTests: [],
        signals: []
      };
      const cases: Case[] = [
        {
          id: 'case:route:GET:/api/users/:id',
          topicKey: 'route:GET:/api/users/:id',
          signals: [
            {
              id: 's1',
              source: 'ingest',
              locator: { file: 'server.ts', startLine: 5, endLine: 5 },
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

      const report = await writeSpecTree({ repoPath: repoDir, outputDir, evidence, cases });

      expect(existsSync(join(outputDir, 'CLAUDE.md'))).toBe(true);
      expect(readFileSync(join(outputDir, 'CLAUDE.md'), 'utf-8')).toContain('sample-app');

      expect(existsSync(join(outputDir, '.claude', 'rules', 'testing.md'))).toBe(true);
      expect(existsSync(join(outputDir, '.claude', 'settings.json'))).toBe(true);

      // spec-auditor and the skill only need routes/contracts to exist — both do here.
      expect(existsSync(join(outputDir, '.claude', 'agents', 'spec-auditor.md'))).toBe(true);
      expect(readFileSync(join(outputDir, '.claude', 'agents', 'spec-auditor.md'), 'utf-8')).toContain(
        'GET /api/users/:id'
      );
      expect(existsSync(join(outputDir, '.claude', 'skills', 'verify-against-spec', 'SKILL.md'))).toBe(true);

      // This fixture has exactly one test total — no held-out split, no second
      // cluster to parallelize against — so both get correctly skipped rather
      // than generating dead-weight artifacts.
      expect(existsSync(join(outputDir, '.claude', 'agents', 'test-verifier.md'))).toBe(false);
      expect(existsSync(join(outputDir, '.claude', 'workflows', 'parallel-test-fix.js'))).toBe(false);
      const settings = JSON.parse(readFileSync(join(outputDir, '.claude', 'settings.json'), 'utf-8'));
      // The real test command runs chained after a heartbeat write, not in
      // place of it — see generateSettingsJson.spec.ts for the heartbeat
      // mechanism's own behavioral tests.
      expect(settings.hooks.PostToolUse[0].hooks[0].command).toContain('npm test');
      expect(settings.hooks.PostToolUse[0].hooks[0].command).toContain('.hook-heartbeat.json');

      const contractFiles = readdirSync(join(outputDir, 'spec', 'contracts'));
      expect(contractFiles.length).toBeGreaterThan(0);

      const decisionFiles = readdirSync(join(outputDir, 'spec')).filter((f) => f.endsWith('.md'));
      expect(decisionFiles.length).toBeGreaterThan(0);

      expect(readFileSync(join(outputDir, 'kickoff-prompt.txt'), 'utf-8')).toBe(KICKOFF_PROMPT);

      expect(existsSync(join(outputDir, 'package.json'))).toBe(true);
      const pkg = JSON.parse(readFileSync(join(outputDir, 'package.json'), 'utf-8'));
      expect(pkg.devDependencies.vitest).toBeDefined();
      // No node_modules/express in this fixture — falls back to the declared range unchanged.
      expect(pkg.dependencies).toEqual({ express: '^4.19.0' });
      // Regression: scripts.test must be a concrete, directly-runnable command
      // (the generated tests are always vitest), never a copy of whatever
      // "npm test" string is used elsewhere — that would make `npm test`
      // recurse into itself.
      expect(pkg.scripts.test).toBe('vitest run tests/visible --passWithNoTests');

      const visibleFiles = readdirSync(join(outputDir, 'tests', 'visible'));
      const heldOutFiles = readdirSync(join(outputDir, 'tests', 'held-out'));
      expect(visibleFiles.length + heldOutFiles.length).toBeGreaterThan(0);

      expect(report.mutationReport.results.length).toBeGreaterThan(0);

      // The one route in this fixture is fully covered by a generated test.
      expect(JSON.parse(readFileSync(join(outputDir, 'spec', 'untested-contracts.json'), 'utf-8'))).toEqual([]);

      const testDeps = JSON.parse(readFileSync(join(outputDir, 'spec', 'test-dependencies.json'), 'utf-8'));
      const [depKey, depFiles] = Object.entries(testDeps)[0] as [string, string[]];
      expect(depKey).toMatch(/^tests\/(visible|weak)\//);
      expect(depFiles).toEqual(['server.ts']);
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(outputDir, { recursive: true, force: true });
    }
  }, 60000);

  it('pins the exact installed dependency version into the generated package.json, not the original range', async () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-writetree-repo-'));
    const outputDir = join(tmpdir(), `rebuild-dossier-writetree-out-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    try {
      writeFileSync(
        join(repoDir, 'server.ts'),
        "import express from 'express';\nconst app = express();\nexport default app;\n"
      );
      mkdirSync(join(repoDir, 'node_modules', 'express'), { recursive: true });
      writeFileSync(join(repoDir, 'node_modules', 'express', 'package.json'), JSON.stringify({ name: 'express', version: '4.19.2' }));

      const evidence: EvidenceBundle = {
        repoPath: repoDir,
        generatedAt: now,
        packageJson: { name: 'sample-app', scripts: {}, dependencies: { express: '^4.19.0' }, devDependencies: {} },
        buildConfig: [],
        routes: [],
        existingTests: [],
        signals: []
      };

      await writeSpecTree({ repoPath: repoDir, outputDir, evidence, cases: [] });

      const pkg = JSON.parse(readFileSync(join(outputDir, 'package.json'), 'utf-8'));
      expect(pkg.dependencies).toEqual({ express: '4.19.2' });
      expect(readFileSync(join(outputDir, 'CLAUDE.md'), 'utf-8')).toContain('dependency versions already pinned in package.json are locked');
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(outputDir, { recursive: true, force: true });
    }
  }, 60000);

  it('the generated npm test script only ever runs tests/visible, never tests/held-out or tests/weak', async () => {
    // Caught by a real fresh-agent handoff: the generator's own default
    // ("vitest run", no path) picks up every test under tests/ — visible,
    // held-out, and weak all live in the same tree vitest scans by default.
    // That mechanically undermines "run held-out once, at the end" — the
    // PostToolUse hook would show held-out failures on every single edit.
    // This runs the ACTUAL generated command against a real vitest process,
    // not just a string-equality check on package.json.
    const repoDir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-writetree-repo-'));
    const outputDir = join(tmpdir(), `rebuild-dossier-writetree-out-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    try {
      writeFileSync(
        join(repoDir, 'server.ts'),
        [
          "import express from 'express';",
          'const app = express();',
          "app.get('/api/a', (req, res) => res.status(200).json({ ok: true }));",
          "app.get('/api/b', (req, res) => res.status(200).json({ ok: true }));",
          "app.get('/api/c', (req, res) => res.status(200).json({ ok: true }));",
          'export default app;'
        ].join('\n')
      );

      const evidence: EvidenceBundle = {
        repoPath: repoDir,
        generatedAt: now,
        packageJson: { name: 'sample-app', scripts: {}, dependencies: { express: '^4.19.0' }, devDependencies: {} },
        buildConfig: [],
        routes: [
          { path: '/api/a', method: 'GET', file: 'server.ts', kind: 'api', startLine: 3 },
          { path: '/api/b', method: 'GET', file: 'server.ts', kind: 'api', startLine: 4 },
          { path: '/api/c', method: 'GET', file: 'server.ts', kind: 'api', startLine: 5 }
        ],
        existingTests: [],
        signals: []
      };

      await writeSpecTree({ repoPath: repoDir, outputDir, evidence, cases: [] });

      const heldOutFiles = readdirSync(join(outputDir, 'tests', 'held-out'));
      expect(heldOutFiles.length).toBeGreaterThan(0); // this fixture must actually exercise the split

      // The generated tests import the app from the rebuild's own root — a
      // real rebuild agent would have already written this by the time it
      // runs `npm test`; simulate that here so the tests actually execute
      // (whether they pass or fail isn't what this test is checking — only
      // which files get selected to run at all).
      writeFileSync(
        join(outputDir, 'server.ts'),
        [
          "import express from 'express';",
          'const app = express();',
          "app.get('/api/a', (req, res) => res.status(200).json({ ok: true }));",
          "app.get('/api/b', (req, res) => res.status(200).json({ ok: true }));",
          "app.get('/api/c', (req, res) => res.status(200).json({ ok: true }));",
          'export default app;'
        ].join('\n')
      );
      symlinkSync(join(ownProjectRoot, 'node_modules'), join(outputDir, 'node_modules'), 'junction');
      const pkg = JSON.parse(readFileSync(join(outputDir, 'package.json'), 'utf-8'));
      const scriptArgs = pkg.scripts.test.split(' ').slice(1); // drop the leading "vitest"

      let output: string;
      try {
        output = execFileSync('node', [vitestEntry, ...scriptArgs, '--root', outputDir, '--reporter=json', '--no-color'], {
          encoding: 'utf-8',
          timeout: 30000
        });
      } catch (e) {
        // A real failure inside the run still exits non-zero; stdout still
        // has the JSON report either way — only an outright crash has none.
        output = (e as { stdout?: string }).stdout ?? '';
      }
      const parsed = JSON.parse(output.slice(output.indexOf('{')));
      const testFilesRun: string[] = parsed.testResults.map((r: { name: string }) => r.name);

      expect(testFilesRun.length).toBeGreaterThan(0);
      expect(testFilesRun.some((f) => f.includes('tests/visible') || f.includes('tests\\visible'))).toBe(true);
      expect(testFilesRun.some((f) => f.includes('tests/held-out') || f.includes('tests\\held-out'))).toBe(false);
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(outputDir, { recursive: true, force: true });
    }
  }, 60000);

  it('generates a Next.js API route test (no Express app anywhere) and wires it into contract coverage', async () => {
    // Deliberately does not assert on real mutation-check execution here — a
    // generated test importing 'next/server' needs a real `next` install to
    // run at all, which this fast fixture doesn't have (same reason the gate-
    // test integration test below only checks static content, not a live
    // `next dev` run). Real execution against a genuinely running Next.js app
    // is covered by the actual validation run against a real target repo.
    const repoDir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-writetree-repo-'));
    const outputDir = join(tmpdir(), `rebuild-dossier-writetree-out-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    try {
      mkdirSync(join(repoDir, 'src', 'app', 'api', 'health'), { recursive: true });
      writeFileSync(
        join(repoDir, 'src', 'app', 'api', 'health', 'route.ts'),
        [
          "import { NextResponse } from 'next/server';",
          '',
          'export async function GET() {',
          "  return NextResponse.json({ status: 'ok' });",
          '}'
        ].join('\n')
      );

      const evidence: EvidenceBundle = {
        repoPath: repoDir,
        generatedAt: now,
        packageJson: { name: 'next-app', scripts: {}, dependencies: { next: '^14.2.35' }, devDependencies: {} },
        buildConfig: [],
        routes: [{ path: '/api/health', method: 'GET', file: 'src/app/api/health/route.ts', kind: 'api', startLine: 3 }],
        existingTests: [],
        signals: []
      };

      await writeSpecTree({ repoPath: repoDir, outputDir, evidence, cases: [] });

      const visibleFiles = readdirSync(join(outputDir, 'tests', 'visible'));
      const heldOutFiles = existsSync(join(outputDir, 'tests', 'held-out')) ? readdirSync(join(outputDir, 'tests', 'held-out')) : [];
      const weakFiles = existsSync(join(outputDir, 'tests', 'weak')) ? readdirSync(join(outputDir, 'tests', 'weak')) : [];
      const allGenerated = [...visibleFiles, ...heldOutFiles, ...weakFiles];
      expect(allGenerated).toHaveLength(1);

      const generatedTestPath = join(
        outputDir,
        'tests',
        visibleFiles[0] ? 'visible' : heldOutFiles[0] ? 'held-out' : 'weak',
        allGenerated[0]!
      );
      expect(readFileSync(generatedTestPath, 'utf-8')).toContain("from 'next/server'");

      // The generated test — wherever it landed (visible/held-out/weak) —
      // still counts as coverage for the untested-contracts hook.
      expect(JSON.parse(readFileSync(join(outputDir, 'spec', 'untested-contracts.json'), 'utf-8'))).toEqual([]);
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(outputDir, { recursive: true, force: true });
    }
  }, 60000);

  it('writes a vitest.config.ts disabling file parallelism when gate tests are generated (each spawns its own next dev against the same app dir)', async () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-writetree-repo-'));
    const outputDir = join(tmpdir(), `rebuild-dossier-writetree-out-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    try {
      writeFileSync(
        join(repoDir, 'app-shell.tsx'),
        ['useEffect(() => {', '  if (!getUnlocked()) {', '    router.replace("/");', '  }', '}, []);'].join('\n')
      );
      writeFileSync(join(repoDir, 'page.tsx'), 'export default function LoginPage() { return null; }');
      mkdirSync(join(repoDir, 'home'), { recursive: true });
      writeFileSync(join(repoDir, 'home', 'page.tsx'), 'export default function HomePage() { return null; }');
      mkdirSync(join(repoDir, 'letter'), { recursive: true });
      writeFileSync(join(repoDir, 'letter', 'page.tsx'), 'export default function LetterPage() { return null; }');

      const evidence: EvidenceBundle = {
        repoPath: repoDir,
        generatedAt: now,
        packageJson: { name: 'app', scripts: {}, dependencies: { next: '^16.0.0' }, devDependencies: {} },
        buildConfig: [],
        routes: [
          { path: '/', file: 'page.tsx', kind: 'page', startLine: 1 },
          { path: '/home', file: 'home/page.tsx', kind: 'page', startLine: 1 },
          { path: '/letter', file: 'letter/page.tsx', kind: 'page', startLine: 1 }
        ],
        existingTests: [],
        signals: []
      };
      const cases: Case[] = [
        {
          id: 'case:smell:client-side-secret-gate:login-gate.tsx',
          topicKey: 'smell:client-side-secret-gate:login-gate.tsx',
          signals: [],
          matchedKnownBugs: [],
          status: 'resolved_by_human',
          humanDecision: { decision: 'intentional', decidedAt: now, via: 'resolve_case_tool' }
        }
      ];

      await writeSpecTree({ repoPath: repoDir, outputDir, evidence, cases });

      expect(existsSync(join(outputDir, 'vitest.config.ts'))).toBe(true);
      expect(readFileSync(join(outputDir, 'vitest.config.ts'), 'utf-8')).toContain('fileParallelism: false');

      // Regression: the gate-redirect test's `sourceFile` is the ORIGINAL
      // app's guard file (app-shell.tsx here) — used only to pick a mutation
      // target — not the route files it actually behaviorally covers ('/' and
      // '/home'). Using sourceFile alone here would wrongly mark both of
      // those routes "untested" and have the PreToolUse hook block the exact
      // files this test requires a rebuild agent to build.
      const untested = JSON.parse(readFileSync(join(outputDir, 'spec', 'untested-contracts.json'), 'utf-8'));
      expect(untested).toEqual(['letter/page.tsx']);
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(outputDir, { recursive: true, force: true });
    }
  }, 60000);

  it('refuses to overwrite an existing output directory', async () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-writetree-repo-'));
    const outputDir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-writetree-out-'));
    try {
      const evidence: EvidenceBundle = {
        repoPath: repoDir,
        generatedAt: now,
        packageJson: { scripts: {}, dependencies: {}, devDependencies: {} },
        buildConfig: [],
        routes: [],
        existingTests: [],
        signals: []
      };
      await expect(writeSpecTree({ repoPath: repoDir, outputDir, evidence, cases: [] })).rejects.toThrow();
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('never leaves a partial output directory behind when generation fails partway through', async () => {
    // Real, live-triggered finding: an MCP client that times out waiting for
    // generate_spec (a real, multi-minute call for a real app) has no way to
    // tell "generation is still running/failed" from "this app genuinely has
    // 0 tests" — both look identical (a directory with CLAUDE.md/contracts
    // but no tests/test-dependencies.json yet). A fresh agent facing that
    // ambiguity treated it as the latter and wrote its own self-authored,
    // self-graded test — exactly the failure mode this tool exists to
    // prevent, caused by the tool's own output having no atomicity guarantee.
    // Forces a genuine mid-write failure (not a mock): generateContracts
    // reads route.file from disk unconditionally when startLine is set, so a
    // route pointing at a nonexistent file throws a real ENOENT partway
    // through writeSpecTree, after CLAUDE.md/settings/rules have already been
    // written but before contracts/tests exist.
    const repoDir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-writetree-repo-'));
    const outputDir = join(tmpdir(), `rebuild-dossier-writetree-partial-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    try {
      const evidence: EvidenceBundle = {
        repoPath: repoDir,
        generatedAt: now,
        packageJson: { name: 'sample-app', scripts: {}, dependencies: {}, devDependencies: {} },
        buildConfig: [],
        routes: [{ path: '/api/gone', method: 'GET', file: 'does-not-exist.ts', kind: 'api', startLine: 3 }],
        existingTests: [],
        signals: []
      };

      await expect(writeSpecTree({ repoPath: repoDir, outputDir, evidence, cases: [] })).rejects.toThrow();

      expect(existsSync(outputDir)).toBe(false);
      // No temp-directory litter left behind in the parent either.
      const parentEntries = readdirSync(dirname(outputDir));
      const leftoverTempDirs = parentEntries.filter(
        (e) => e.includes('writetree-partial') && !outputDir.endsWith(e)
      );
      expect(leftoverTempDirs).toEqual([]);
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(outputDir, { recursive: true, force: true });
    }
  });
});
