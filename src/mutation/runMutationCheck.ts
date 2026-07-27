import { cpSync, existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tsMorphEngine } from './tsMorphEngine.js';
import type { MutationSite } from './engine.js';

const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.dossier', 'coverage']);
const OWN_PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const VITEST_ENTRY = join(OWN_PROJECT_ROOT, 'node_modules/vitest/vitest.mjs');
const OWN_CONFIG_FILENAMES = ['vitest.config.ts', 'vitest.config.js', 'vitest.config.mts', 'vite.config.ts', 'vite.config.js', 'vite.config.mts'];

// playwright is never a real target app's own dependency — it's only ever
// needed by the gate tests THIS tool generates. Once a target has its own
// real node_modules (true for every real app), that became the sole source
// and playwright silently stopped resolving, so every gate-test mutation
// check against a real app failed at import time. vitest itself doesn't need
// this treatment — it resolves its own package internally regardless of the
// project root, since it's the process orchestrating the run.
const TEST_ONLY_TOOLING_PACKAGES = ['playwright'];

function symlinkEntry(target: string, linkPath: string): void {
  try {
    symlinkSync(target, linkPath, 'junction');
  } catch {
    // best effort — a failed entry surfaces later as a real resolution
    // failure for whatever imports it, which reports as "unrunnable" rather
    // than silently mis-scoring a real mutation
  }
}

// Real, live-triggered finding (smoke test against a real Next 16 +
// Turbopack app): symlinking `next` itself into the scratch copy makes
// Turbopack's own workspace-root detection fail 100% of the time —
// "Turbopack build failed... We couldn't find the Next.js package
// (next/package.json) from the project directory... For security and
// performance reasons, files outside of the project directory will not be
// compiled." Turbopack deliberately refuses to resolve its own package
// through a symlink pointing outside the scratch directory, so `next dev`
// never becomes ready and every target is misreported as `unrunnable` —
// not because the test or the target app is broken, but because of how the
// scratch copy links its own dependencies. `next` is the one package real-
// copied (not symlinked) so a genuine, in-project-directory
// `next/package.json` always exists; every other dependency stays
// symlinked to avoid the cost (confirmed real: ~170MB for `next` alone) of
// copying all of node_modules per mutation site.
const COPIED_PACKAGES = new Set(['next']);

function linkOrCopyEntry(target: string, linkPath: string, entryName: string): void {
  if (COPIED_PACKAGES.has(entryName)) {
    try {
      cpSync(target, linkPath, { recursive: true });
    } catch {
      // best effort — see symlinkEntry's own comment above: a failed entry
      // surfaces later as a real resolution failure, reported as
      // "unrunnable" rather than silently mis-scoring a real mutation
    }
    return;
  }
  symlinkEntry(target, linkPath);
}

// The scratch copy only ever gets source files (copying node_modules per
// mutation would be far too expensive) — so a generated test importing the
// original repo's real runtime deps (express, next, etc.) needs node_modules
// linked in, not copied. When the target has no node_modules of its own
// (never true for a real target repo, only for this tool's own tiny test
// fixtures), falls back to a single junction over rebuild-dossier's whole
// node_modules. When it does, scratchDir/node_modules is built as a real
// directory with one junction per top-level package from the target's own
// install (except `next`, real-copied — see linkOrCopyEntry above) — plus
// an overlay junction for any test-only tooling package (see above) the
// target doesn't have, since that's never the target's own dependency to
// provide.
function linkNodeModules(originalRepoPath: string, scratchDir: string): void {
  const originalNodeModules = join(originalRepoPath, 'node_modules');
  if (!existsSync(originalNodeModules)) {
    symlinkEntry(join(OWN_PROJECT_ROOT, 'node_modules'), join(scratchDir, 'node_modules'));
    return;
  }

  const scratchNodeModules = join(scratchDir, 'node_modules');
  mkdirSync(scratchNodeModules, { recursive: true });

  const ownEntries = new Set(readdirSync(originalNodeModules));
  for (const entry of ownEntries) {
    linkOrCopyEntry(join(originalNodeModules, entry), join(scratchNodeModules, entry), entry);
  }

  for (const pkg of TEST_ONLY_TOOLING_PACKAGES) {
    if (ownEntries.has(pkg)) continue;
    const ownProjectPkgPath = join(OWN_PROJECT_ROOT, 'node_modules', pkg);
    if (existsSync(ownProjectPkgPath)) {
      symlinkEntry(ownProjectPkgPath, join(scratchNodeModules, pkg));
    }
  }
}

function escapeForRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// tsconfig `@/*`-style path aliases are a common convention well beyond
// Next.js (Vite, webpack, any bundler-resolution setup), and vitest does not
// resolve them on its own — a target file reached only through such an alias
// would otherwise fail to even load inside the scratch copy, at which point
// every mutation looks identical to a real kill (see the baseline-pass check
// below for why that's dangerous). Only handles the overwhelmingly common
// single-wildcard shape ("@/*": ["./src/*"]) — a deliberately narrow, real
// fix, not a general tsconfig-paths resolver.
function writeAliasConfigIfNeeded(originalRepoPath: string, scratchDir: string): void {
  if (OWN_CONFIG_FILENAMES.some((f) => existsSync(join(scratchDir, f)))) return;

  const tsconfigPath = join(originalRepoPath, 'tsconfig.json');
  if (!existsSync(tsconfigPath)) return;

  let tsconfig: { compilerOptions?: { paths?: Record<string, string[]> } };
  try {
    tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf-8'));
  } catch {
    return;
  }

  const paths = tsconfig.compilerOptions?.paths;
  if (!paths || typeof paths !== 'object') return;

  const aliasEntries: string[] = [];
  for (const [key, targets] of Object.entries(paths)) {
    if (!Array.isArray(targets) || targets.length === 0) continue;
    const keyMatch = key.match(/^(.*)\/\*$/);
    const targetMatch = String(targets[0]).match(/^(.*)\/\*$/);
    if (!keyMatch || !targetMatch) continue;
    const findPattern = `^${escapeForRegex(keyMatch[1]!)}\\/`;
    const replacement = join(scratchDir, targetMatch[1]!).replace(/\\/g, '/') + '/';
    aliasEntries.push(`{ find: new RegExp(${JSON.stringify(findPattern)}), replacement: ${JSON.stringify(replacement)} }`);
  }
  if (aliasEntries.length === 0) return;

  // Deliberately a plain object export, not `defineConfig` from 'vitest/config'
  // — a real target repo's own node_modules (linked into the scratch copy)
  // essentially never has vitest as one of ITS dependencies (that's an
  // artifact of the tests THIS tool generates, not the target app's own
  // tooling), so that import would fail to resolve there. `defineConfig` is
  // purely a TS-typing helper with no runtime behavior beyond identity.
  writeFileSync(
    join(scratchDir, 'vitest.config.ts'),
    `export default {\n  resolve: { alias: [${aliasEntries.join(', ')}] }\n};\n`
  );
}

function prepareScratchCopy(originalRepoPath: string): string {
  const scratchDir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-mutation-'));
  cpSync(originalRepoPath, scratchDir, {
    recursive: true,
    filter: (src) => !IGNORED_DIRS.has(src.split(/[\\/]/).pop() ?? '')
  });
  linkNodeModules(originalRepoPath, scratchDir);
  writeAliasConfigIfNeeded(originalRepoPath, scratchDir);
  return scratchDir;
}

export interface MutationTarget {
  filename: string;
  content: string;
  sourceFile: string; // route's underlying source file, relative to the original repo
  maxMutationSites?: number; // caps how many of sourceFile's enumerated sites get checked for
  // this target — a page test's cost is one fresh scratch-copy + `next dev`
  // boot PER SITE (see prepareScratchCopy/runVitestOnce below), which scales
  // with a page component's incidental code complexity, not with anything
  // this tool controls. Undefined (the default, used by every non-page
  // target) means uncapped.
}

export interface MutationResult {
  testFile: string;
  mutator: string;
  locator: MutationSite['locator'];
  killed: boolean;
}

export interface MutationCheckReport {
  results: MutationResult[];
  weakTestFiles: string[]; // had at least one applicable mutant, but killed none of them
  unrunnableTestFiles: string[]; // never passed even against the original, unmutated code
}

// Generous enough for a Next.js dev-server boot (generateGateTests' own
// beforeAll budgets 90s for that), not just an in-process Express server.
const VITEST_RUN_TIMEOUT_MS = 120_000;

function runVitestOnce(scratchDir: string, testFilePath: string): boolean {
  try {
    const output = execFileSync('node', [VITEST_ENTRY, 'run', testFilePath, '--root', scratchDir, '--reporter=json', '--no-color'], {
      encoding: 'utf-8',
      // `--root` only tells vitest where to resolve test files/config from —
      // it does NOT change the child process's own process.cwd(). Without
      // this, any target-app module that does something relative to
      // process.cwd() at import time (e.g. opening a database file by a
      // bare relative path) writes into wherever this server process
      // itself happens to be running, not the isolated scratch copy —
      // confirmed for real via a stray fieldnotes.db file left behind in
      // rebuild-dossier's own directory before this was added.
      cwd: scratchDir,
      timeout: VITEST_RUN_TIMEOUT_MS,
      // execFileSync's `timeout` option defaults to SIGTERM, which vitest
      // (or whatever it's awaiting inside a hung `beforeAll`) can simply not
      // honor — SIGKILL can't be ignored, so this is a real, defensible
      // hardening against that general Node.js gotcha.
      // NOT a confirmed fix for a specific, still-unexplained hang found
      // this same session: one reproduction — with this exact killSignal
      // already set — ran for ~97 minutes and exited on its own
      // (`signal: null`, never killed), meaning VITEST_RUN_TIMEOUT_MS
      // wasn't enforced at all, by any signal, in that run. Root cause not
      // found; see docs/v0-findings.md's "execFileSync's mutation-check
      // timeout doesn't reliably fire" entry — every timing number this
      // function has ever contributed to (including the ~9.15-minute
      // catchandtrade page-test-generation figure) is what happened to
      // occur, not a value this timeout guaranteed as an upper bound.
      killSignal: 'SIGKILL',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    const jsonStart = output.indexOf('{');
    const parsed = JSON.parse(output.slice(jsonStart));
    return parsed.success === true;
  } catch {
    // A thrown execFileSync (non-zero exit, timeout, or crash) means the run
    // did not succeed — treat identically to a parsed failure.
    return false;
  }
}

// Real, live-triggered finding (smoke test against a real 19-page Next.js
// app): rmSync's recursive delete can throw ENOTEMPTY even with force:true
// when something is still actively writing inside scratchDir at the moment
// of deletion — observed cause was next dev's own worker/compiler child
// processes outliving the top-level next dev pid that afterAll killed (see
// nextDevServerBoilerplate.ts's process-group kill fix, which addresses the
// root cause). This is a second, defense-in-depth layer: even after that
// fix, a transient race here must not be allowed to throw past this point —
// an uncaught exception mid-mutation-check aborts every remaining target's
// check for the entire (possibly many-minutes-long) generate_spec call, per
// writeSpecTree's atomicity model. A handful of short retries clears the
// overwhelmingly common case (a process finishing its exit a few hundred ms
// late); if it still fails after that, a leaked scratch dir under the OS
// temp folder is a nuisance to clean up manually, not a correctness problem
// worth crashing the whole run over.
function removeScratchDirWithRetry(scratchDir: string): void {
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      rmSync(scratchDir, { recursive: true, force: true });
      return;
    } catch (err) {
      if (attempt === maxAttempts) {
        console.error(`rebuild-dossier: failed to remove scratch dir ${scratchDir} after ${maxAttempts} attempts — leaving it in place:`, err);
        return;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200 * attempt);
    }
  }
}

// Runs the test once against a pristine (unmutated) copy. Without this, a
// test that can never pass — a broken import, a missing env var, whatever —
// looks IDENTICAL to a real kill on every single mutant: runVitestOnce
// returns false regardless of mutation, so killed = !succeeded ends up true
// across the board. That reports a 100% "kill rate" for a test providing
// zero real signal, which is worse than a weak test (0% kill rate) because a
// weak test at least gets flagged and moved to tests/weak/ instead of
// silently looking trustworthy.
function passesBaseline(originalRepoPath: string, target: MutationTarget): boolean {
  const scratchDir = prepareScratchCopy(originalRepoPath);
  try {
    const testDir = join(scratchDir, 'tests', 'visible');
    mkdirSync(testDir, { recursive: true });
    const testFilePath = join(testDir, target.filename);
    writeFileSync(testFilePath, target.content);
    return runVitestOnce(scratchDir, testFilePath);
  } finally {
    removeScratchDirWithRetry(scratchDir);
  }
}

export function runMutationCheck(originalRepoPath: string, targets: MutationTarget[]): MutationCheckReport {
  const results: MutationResult[] = [];
  const unrunnableTestFiles: string[] = [];

  const sitesBySourceFile = new Map<string, MutationSite[]>();
  for (const target of targets) {
    if (!sitesBySourceFile.has(target.sourceFile)) {
      sitesBySourceFile.set(
        target.sourceFile,
        tsMorphEngine.enumerateSites(join(originalRepoPath, target.sourceFile), target.sourceFile)
      );
    }
  }

  for (const target of targets) {
    if (!passesBaseline(originalRepoPath, target)) {
      unrunnableTestFiles.push(target.filename);
      continue;
    }

    const allSites = sitesBySourceFile.get(target.sourceFile) ?? [];
    const sites = target.maxMutationSites !== undefined ? allSites.slice(0, target.maxMutationSites) : allSites;

    for (const site of sites) {
      const scratchDir = prepareScratchCopy(originalRepoPath);
      try {
        const applied = tsMorphEngine.apply(join(scratchDir, site.locator.file), site);
        if (!applied) continue;

        const testDir = join(scratchDir, 'tests', 'visible');
        mkdirSync(testDir, { recursive: true });
        const testFilePath = join(testDir, target.filename);
        writeFileSync(testFilePath, target.content);

        const succeeded = runVitestOnce(scratchDir, testFilePath);
        results.push({
          testFile: target.filename,
          mutator: site.mutatorName,
          locator: site.locator,
          killed: !succeeded
        });
      } finally {
        removeScratchDirWithRetry(scratchDir);
      }
    }
  }

  const weakTestFiles = targets
    .map((t) => t.filename)
    .filter((filename) => {
      const forThisFile = results.filter((r) => r.testFile === filename);
      return forThisFile.length > 0 && forThisFile.every((r) => !r.killed);
    });

  return { results, weakTestFiles, unrunnableTestFiles };
}
