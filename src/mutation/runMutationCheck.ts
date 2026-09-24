import { cpSync, existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tsMorphEngine } from './tsMorphEngine.js';
import { runWithWatchdog } from './runWithWatchdog.js';
import { resolveVitestEntry } from './vitestRunner.js';
import type { MutationSite } from './engine.js';

// .next is build output, not source the scratch copy needs to mutate — same
// exclusion, and same reasoning, as listSourceFiles.ts's identically-named
// constant (docs/v0-findings.md, "ingest_repo scans build output as source").
const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.dossier', 'coverage']);
const OWN_PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const ownRequire = createRequire(import.meta.url);

// A real, previously-undiscovered bug this replaces: `join(OWN_PROJECT_ROOT,
// 'node_modules', pkg)` assumes `pkg` is nested directly under this
// package's own node_modules, which is only true for a local dev checkout
// (`npm install` inside a single-package repo). Under `npx <pkg>@latest` —
// this project's own documented, only end-user install method — npm hoists
// dependencies to the npx cache's top-level node_modules instead, so that
// literal path never exists even though the package genuinely is installed
// and importable. Using `require.resolve` walks the real Node resolution
// algorithm (which checks every ancestor node_modules, hoisted or not) and
// derives the entry from wherever it actually lands, instead of guessing one
// fixed layout. Confirmed live: `vitest`/`playwright` both resolved via the
// old literal check inside this repo's own dev checkout, and both silently
// failed to resolve the identical way under a real `npx rebuild-dossier@latest`
// install — every generated test came back `unrunnable` for every target app,
// regardless of that app's own content, independent of anything this tool's
// mutation logic was actually trying to measure.
function resolveOwnPackageDir(pkg: string): string | undefined {
  try {
    return dirname(ownRequire.resolve(`${pkg}/package.json`, { paths: [OWN_PROJECT_ROOT] }));
  } catch {
    return undefined;
  }
}

// Resolved on first use, not at import: under npx, vitest is not installed
// with this package, and obtaining it may mean a one-time install (see
// vitestRunner.ts). A failure throws out of generate_spec with a clear
// message instead of turning every test into `unrunnable`.
let vitestEntry: string | undefined;
function getVitestEntry(): string {
  vitestEntry ??= resolveVitestEntry(() => resolveOwnPackageDir('vitest'));
  return vitestEntry;
}
const OWN_CONFIG_FILENAMES = ['vitest.config.ts', 'vitest.config.js', 'vitest.config.mts', 'vite.config.ts', 'vite.config.js', 'vite.config.mts'];

// playwright is never a real target app's own dependency — it's only ever
// needed by the gate tests THIS tool generates. Once a target has its own
// real node_modules (true for every real app), that became the sole source
// and playwright silently stopped resolving, so every gate-test mutation
// check against a real app failed at import time.
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
    const ownProjectPkgPath = resolveOwnPackageDir(pkg);
    if (ownProjectPkgPath) {
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

// Real subtlety, traced before shipping: this scratch copy is built from the
// ORIGINAL target repo's own tree, not the rebuild output directory — so a
// generated page test's reference to tests/fixtures/auth-storage-state.json
// (see generatePageTests.ts's buildPageTestContent, relative to its own
// import.meta.url) would resolve to a path that never gets created here,
// making Playwright's storageState load fail and every such test register as
// unrunnable — the opposite of what supplying authStorageStatePath is for.
// Copied unconditionally into every scratch dir when set, regardless of
// whether the specific target being run actually uses it — it's a tiny file,
// and tracking per-target usage isn't worth the complexity.
function writeAuthFixtureIfNeeded(scratchDir: string, authStorageStatePath: string | undefined): void {
  if (!authStorageStatePath) return;
  const fixturesDir = join(scratchDir, 'tests', 'fixtures');
  mkdirSync(fixturesDir, { recursive: true });
  cpSync(authStorageStatePath, join(fixturesDir, 'auth-storage-state.json'));
}

// Exported for direct unit testing (test/unit/mutation/prepareScratchCopy.spec.ts) — a pure
// filesystem operation that doesn't need a real mutation run to verify, unlike the rest of
// this module's mutation-kill behavior, which is tested end-to-end through runMutationCheck.
export function prepareScratchCopy(originalRepoPath: string, authStorageStatePath?: string): string {
  const scratchDir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-mutation-'));
  cpSync(originalRepoPath, scratchDir, {
    recursive: true,
    filter: (src) => !IGNORED_DIRS.has(src.split(/[\\/]/).pop() ?? '')
  });
  linkNodeModules(originalRepoPath, scratchDir);
  writeAliasConfigIfNeeded(originalRepoPath, scratchDir);
  writeAuthFixtureIfNeeded(scratchDir, authStorageStatePath);
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
// Overridable for tests; read per call, not at import.
const DEFAULT_VITEST_RUN_TIMEOUT_MS = 120_000;
function vitestRunTimeoutMs(): number {
  const fromEnv = Number(process.env.REBUILD_DOSSIER_MUTATION_TIMEOUT_MS);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_VITEST_RUN_TIMEOUT_MS;
}

function runVitestOnce(scratchDir: string, testFilePath: string): boolean {
  // A real regression, confirmed live: vitest 4.1.11 (still satisfying this
  // project's own "^4.0.0" range, so any fresh install can silently pick it
  // up) fails to match an ABSOLUTE test-file filter against --root on
  // macOS, where /tmp is itself a symlink to /private/tmp — vitest 4.1.10
  // canonicalizes consistently and matches fine; 4.1.11 apparently doesn't,
  // so the filter and the collected file path disagree by that one symlink
  // hop and the run reports "No test files found" for every target,
  // regardless of the test's own content. A path relative to `cwd` (already
  // set to scratchDir below) sidesteps the mismatch entirely rather than
  // depending on this tool staying pinned behind whatever vitest version
  // happens to fix it.
  const relativeTestFilePath = relative(scratchDir, testFilePath);
  // `cwd: scratchDir` matters beyond --root: any target-app module that
  // resolves a path relative to process.cwd() at import time (e.g. a bare
  // relative database filename) must write into the isolated scratch copy,
  // not wherever this server runs — confirmed via a stray fieldnotes.db left
  // in rebuild-dossier's own directory before cwd was set.
  //
  // The per-run cap is enforced by runWithWatchdog (a supervisor process that
  // SIGKILLs the run's whole process group on its own timer), not by
  // execFileSync's `timeout`, which was observed not to fire at all (a ~97-min
  // run that exited on its own, signal: null) and which never killed
  // grandchildren. A timed-out run counts as not succeeding.
  const run = runWithWatchdog('node', [getVitestEntry(), 'run', relativeTestFilePath, '--root', scratchDir, '--reporter=json', '--no-color'], {
    cwd: scratchDir,
    timeoutMs: vitestRunTimeoutMs()
  });
  if (process.env.REBUILD_DOSSIER_MUTATION_DEBUG && (run.exitCode !== 0 || run.timedOut)) {
    console.error('MUTATION_DEBUG runVitestOnce failed for', testFilePath, {
      exitCode: run.exitCode,
      timedOut: run.timedOut,
      elapsedMs: run.elapsedMs,
      stderr: run.stderr.slice(-4000)
    });
  }
  if (run.timedOut || run.exitCode !== 0) return false;
  try {
    const jsonStart = run.stdout.indexOf('{');
    return JSON.parse(run.stdout.slice(jsonStart)).success === true;
  } catch {
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
function passesBaseline(originalRepoPath: string, target: MutationTarget, authStorageStatePath?: string): boolean {
  const scratchDir = prepareScratchCopy(originalRepoPath, authStorageStatePath);
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

export function runMutationCheck(
  originalRepoPath: string,
  targets: MutationTarget[],
  authStorageStatePath?: string
): MutationCheckReport {
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
    if (!passesBaseline(originalRepoPath, target, authStorageStatePath)) {
      unrunnableTestFiles.push(target.filename);
      continue;
    }

    const allSites = sitesBySourceFile.get(target.sourceFile) ?? [];
    const sites = target.maxMutationSites !== undefined ? allSites.slice(0, target.maxMutationSites) : allSites;

    for (const site of sites) {
      const scratchDir = prepareScratchCopy(originalRepoPath, authStorageStatePath);
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
