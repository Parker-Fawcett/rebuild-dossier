import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Where the mutation check gets the vitest it runs every generated test with.
//
// Why this exists: vitest used to be a runtime dependency, and a cold
// `npx rebuild-dossier@latest` crashed inside npm's arborist ("Cannot read
// properties of null (reading 'edgesOut')") on vitest's optional peer chain.
// 0.2.9 moved it to devDependencies on the belief that nothing at runtime
// needed it. That belief was wrong: the mutation check runs vitest itself.
// Under npx, devDependencies are never installed, so from 0.2.9 through
// 0.2.10 every published install marked every generated test `unrunnable`
// on every app, with no error (found by a cold run of docs/validators.md;
// see docs/v0-findings.md). Putting vitest back into dependencies still
// reproduces the arborist crash, and so does asking npx for both packages.
//
// So, in order:
//   1. REBUILD_DOSSIER_VITEST_ENTRY, if set and present.
//   2. vitest resolvable from this package's own install (a dev checkout).
//   3. A pinned vitest in a tool-owned runner directory, installed there on
//      first use with --legacy-peer-deps, which skips the peer resolution
//      that crashes. This is the one network fetch the default path makes
//      beyond npx itself.
// If none of these works, this throws. The mutation check must never again
// silently report every test as unrunnable because its runner is missing.
export const PINNED_VITEST_VERSION = '4.1.10';

export class VitestUnavailableError extends Error {
  constructor(detail: string) {
    super(
      `rebuild-dossier could not obtain vitest ${PINNED_VITEST_VERSION}, which the mutation check needs to run any generated test, ` +
        `so it stopped rather than mark every test unrunnable. ${detail} ` +
        `To supply it yourself: npm install --prefix "${defaultRunnerDir()}" vitest@${PINNED_VITEST_VERSION} --legacy-peer-deps ` +
        `(or set REBUILD_DOSSIER_VITEST_ENTRY to a vitest.mjs).`
    );
    this.name = 'VitestUnavailableError';
  }
}

export function defaultRunnerDir(): string {
  return process.env.REBUILD_DOSSIER_RUNNER_DIR || join(homedir(), '.cache', 'rebuild-dossier', `vitest-${PINNED_VITEST_VERSION}`);
}

const INSTALL_TIMEOUT_MS = 5 * 60_000;

export function resolveVitestEntry(resolveOwnVitestDir: () => string | undefined): string {
  const fromEnv = process.env.REBUILD_DOSSIER_VITEST_ENTRY;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;

  const ownDir = resolveOwnVitestDir();
  if (ownDir && existsSync(join(ownDir, 'vitest.mjs'))) return join(ownDir, 'vitest.mjs');

  const runnerDir = defaultRunnerDir();
  const runnerEntry = join(runnerDir, 'node_modules', 'vitest', 'vitest.mjs');
  if (existsSync(runnerEntry)) return runnerEntry;

  const npm = process.env.REBUILD_DOSSIER_NPM || (process.platform === 'win32' ? 'npm.cmd' : 'npm');
  try {
    mkdirSync(runnerDir, { recursive: true });
    execFileSync(
      npm,
      ['install', '--prefix', runnerDir, `vitest@${PINNED_VITEST_VERSION}`, '--legacy-peer-deps', '--no-audit', '--no-fund', '--no-package-lock', '--loglevel=error'],
      { stdio: ['ignore', 'pipe', 'pipe'], timeout: INSTALL_TIMEOUT_MS, shell: process.platform === 'win32' }
    );
  } catch (err) {
    const stderr = String((err as { stderr?: Buffer | string }).stderr ?? '').trim().slice(-800);
    throw new VitestUnavailableError(`Installing it into ${runnerDir} failed${stderr ? `: ${stderr}` : '.'}`);
  }
  if (!existsSync(runnerEntry)) {
    throw new VitestUnavailableError(`npm reported success, but ${runnerEntry} does not exist.`);
  }
  return runnerEntry;
}
