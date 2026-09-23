import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { runWithWatchdog } from '../../../src/mutation/runWithWatchdog.js';

// These tests are the evidence behind the mutation check's per-run cap. The
// cap used to be execFileSync's own `timeout`, which was observed not to fire
// at all (one run went ~97 minutes and exited on its own), and which never
// killed grandchildren. A cap is only claimed if these pass.
describe('runWithWatchdog', () => {
  const dir = mkdtempSync(join(tmpdir(), 'watchdog-spec-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const node = process.execPath;
  const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

  it('returns a normal command\'s stdout and exit code untouched', () => {
    const r = runWithWatchdog(node, ['-e', 'process.stdout.write("hello"); process.exit(0)'], { cwd: dir, timeoutMs: 10_000 });
    expect(r).toMatchObject({ stdout: 'hello', exitCode: 0, timedOut: false });
  });

  it('reports a failing command\'s non-zero exit without calling it a timeout', () => {
    const r = runWithWatchdog(node, ['-e', 'process.exit(3)'], { cwd: dir, timeoutMs: 10_000 });
    expect(r.exitCode).toBe(3);
    expect(r.timedOut).toBe(false);
  });

  it('stops a command that never exits within the cap, not whenever it happens to finish', () => {
    const r = runWithWatchdog(node, ['-e', 'setInterval(() => {}, 1000)'], { cwd: dir, timeoutMs: 1500 });
    expect(r.timedOut).toBe(true);
    expect(r.elapsedMs).toBeLessThan(6000);
  });

  it('kills grandchildren too, including one holding stdout open, so nothing outlives the run', () => {
    const pidFile = join(dir, 'grandchild.pid');
    const script =
      `const c = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' });` +
      `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(c.pid)); setInterval(() => {}, 1000);`;
    const r = runWithWatchdog(node, ['-e', script], { cwd: dir, timeoutMs: 1500 });
    expect(r.timedOut).toBe(true);
    expect(r.elapsedMs).toBeLessThan(6000);
    const grandchild = Number(readFileSync(pidFile, 'utf-8'));
    const deadline = Date.now() + 2000;
    while (alive(grandchild) && Date.now() < deadline) { /* SIGKILL delivery is near-instant; allow a brief moment */ }
    expect(alive(grandchild)).toBe(false);
  });

  it('also reaps children left behind by a command that exits normally', () => {
    const pidFile = join(dir, 'straggler.pid');
    const script =
      `const c = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });` +
      `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(c.pid)); process.exit(0);`;
    const r = runWithWatchdog(node, ['-e', script], { cwd: dir, timeoutMs: 10_000 });
    expect(r.exitCode).toBe(0);
    const straggler = Number(readFileSync(pidFile, 'utf-8'));
    const deadline = Date.now() + 2000;
    while (alive(straggler) && Date.now() < deadline) { /* wait for the group kill */ }
    expect(alive(straggler)).toBe(false);
  });
});
