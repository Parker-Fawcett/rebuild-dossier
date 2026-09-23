import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// An enforced wall-clock cap for one child command, and everything it spawns.
//
// Why this exists: the mutation check used execFileSync's own `timeout` as
// its per-run cap, and that cap was observed not to fire at all. One run went
// ~97 minutes and exited on its own with `signal: null`, killSignal SIGKILL
// already set, and the root cause was never found (docs/v0-findings.md,
// "execFileSync's mutation-check timeout doesn't reliably fire"). Separately,
// its timeout only kills the direct child: anything that child spawned (vitest
// workers, a `next dev` a generated test booted) survives as an orphan.
//
// So the cap no longer depends on execFileSync's timer. The command runs under
// a small supervisor process (`node -e WATCHDOG_SOURCE`, passed as an argv
// element, so no shell ever rewrites it) that:
//   - starts the command in its own process group, with stdout/stderr going to
//     files, never to a pipe the parent waits on;
//   - on its own timer, SIGKILLs the whole process group and exits;
//   - on normal exit, also SIGKILLs the group, so no child outlives the run.
// The outer execFileSync keeps a looser timeout as a backstop, in case the
// supervisor itself ever wedges.
const WATCHDOG_SOURCE = [
  "const { spawn } = require('node:child_process');",
  "const fs = require('node:fs');",
  "const [timeoutMs, outFile, errFile, markFile, cwd, cmd, ...args] = process.argv.slice(1);",
  "const out = fs.openSync(outFile, 'w');",
  "const err = fs.openSync(errFile, 'w');",
  "const child = spawn(cmd, args, { cwd, detached: process.platform !== 'win32', stdio: ['ignore', out, err] });",
  "const killGroup = () => { try { if (process.platform === 'win32') child.kill('SIGKILL'); else process.kill(-child.pid, 'SIGKILL'); } catch (e) {} };",
  "const timer = setTimeout(() => { fs.writeFileSync(markFile, 'timeout'); killGroup(); process.exit(124); }, Number(timeoutMs));",
  "child.on('error', () => { clearTimeout(timer); process.exit(127); });",
  "child.on('exit', (code, signal) => { clearTimeout(timer); killGroup(); process.exit(code === null ? 1 : code); });"
].join('\n');

export interface WatchdogResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  elapsedMs: number;
}

// Grace on top of the supervisor's own cap before the outer backstop fires.
const BACKSTOP_GRACE_MS = 15_000;

export function runWithWatchdog(command: string, args: string[], options: { cwd: string; timeoutMs: number }): WatchdogResult {
  const dir = mkdtempSync(join(tmpdir(), 'dossier-watchdog-'));
  const outFile = join(dir, 'stdout');
  const errFile = join(dir, 'stderr');
  const markFile = join(dir, 'timed-out');
  const started = Date.now();
  let exitCode: number | null = 0;
  try {
    execFileSync(process.execPath, ['-e', WATCHDOG_SOURCE, String(options.timeoutMs), outFile, errFile, markFile, options.cwd, command, ...args], {
      stdio: 'ignore',
      timeout: options.timeoutMs + BACKSTOP_GRACE_MS,
      killSignal: 'SIGKILL'
    });
  } catch (err) {
    exitCode = (err as { status?: number | null }).status ?? null;
  }
  const read = (f: string) => (existsSync(f) ? readFileSync(f, 'utf-8') : '');
  const result: WatchdogResult = {
    stdout: read(outFile),
    stderr: read(errFile),
    exitCode,
    timedOut: existsSync(markFile) || Date.now() - started >= options.timeoutMs + BACKSTOP_GRACE_MS,
    elapsedMs: Date.now() - started
  };
  rmSync(dir, { recursive: true, force: true });
  return result;
}
