import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PINNED_VITEST_VERSION, VitestUnavailableError, resolveVitestEntry } from '../../../src/mutation/vitestRunner.js';

// The regression these guard: from 0.2.9 through 0.2.10 the published package
// had no vitest (devDependencies aren't installed under npx), and every
// generated test was silently marked unrunnable. Resolution must either find
// or install a runner, or fail loudly.
describe.skipIf(process.platform === 'win32')('resolveVitestEntry', () => {
  let dir: string;
  const saved = { ...process.env };
  const noOwn = () => undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vitest-runner-spec-'));
    delete process.env.REBUILD_DOSSIER_VITEST_ENTRY;
    process.env.REBUILD_DOSSIER_RUNNER_DIR = join(dir, 'runner');
  });
  afterEach(() => {
    process.env = { ...saved };
    rmSync(dir, { recursive: true, force: true });
  });

  const fakeNpm = (body: string) => {
    const path = join(dir, 'fake-npm');
    writeFileSync(path, `#!/bin/sh\n${body}\n`);
    chmodSync(path, 0o755);
    process.env.REBUILD_DOSSIER_NPM = path;
    return path;
  };
  const runnerEntry = () => join(dir, 'runner', 'node_modules', 'vitest', 'vitest.mjs');

  it('prefers an explicit REBUILD_DOSSIER_VITEST_ENTRY', () => {
    const entry = join(dir, 'custom-vitest.mjs');
    writeFileSync(entry, '');
    process.env.REBUILD_DOSSIER_VITEST_ENTRY = entry;
    expect(resolveVitestEntry(noOwn)).toBe(entry);
  });

  it('uses vitest from its own install when one exists (a dev checkout)', () => {
    const own = join(dir, 'own-vitest');
    mkdirSync(own);
    writeFileSync(join(own, 'vitest.mjs'), '');
    fakeNpm('exit 99');
    expect(resolveVitestEntry(() => own)).toBe(join(own, 'vitest.mjs'));
  });

  it('reuses an already-installed runner without calling npm', () => {
    mkdirSync(join(dir, 'runner', 'node_modules', 'vitest'), { recursive: true });
    writeFileSync(runnerEntry(), '');
    fakeNpm('exit 99');
    expect(resolveVitestEntry(noOwn)).toBe(runnerEntry());
  });

  it('installs the pinned vitest with --legacy-peer-deps when nothing else is available', () => {
    const argsFile = join(dir, 'npm-args');
    fakeNpm(`echo "$@" > "${argsFile}"; mkdir -p "$3/node_modules/vitest"; touch "$3/node_modules/vitest/vitest.mjs"`);
    expect(resolveVitestEntry(noOwn)).toBe(runnerEntry());
    const args = readFileSync(argsFile, 'utf-8');
    expect(args).toContain(`vitest@${PINNED_VITEST_VERSION}`);
    expect(args).toContain('--legacy-peer-deps');
  });

  it('throws a clear error, not a silent fallback, when the install fails', () => {
    fakeNpm('echo "npm error network unreachable" >&2; exit 1');
    expect(() => resolveVitestEntry(noOwn)).toThrow(VitestUnavailableError);
    expect(() => resolveVitestEntry(noOwn)).toThrow(/network unreachable/);
  });

  it('throws when npm claims success but no runner appears', () => {
    fakeNpm('exit 0');
    expect(() => resolveVitestEntry(noOwn)).toThrow(/does not exist/);
  });
});
