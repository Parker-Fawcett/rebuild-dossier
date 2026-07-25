// Shared spawn/wait/kill boilerplate for a generated test's own `beforeAll`/
// `afterAll` that needs a real, running `next dev` + a real Chromium instance
// to drive with Playwright. Originally written (and still used) by
// generateGateTests.ts for its one narrow client-side-secret-gate test;
// extracted here so generatePageTests.ts can reuse the exact same
// spawn/kill/waitForReady logic instead of a second copy that could drift.
export function devServerBoilerplate(): string {
  return `import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const port = 10000 + Math.floor(Math.random() * 40000);
// "localhost", not "127.0.0.1" — Next's dev server only trusts "localhost" as
// a default dev origin; 127.0.0.1 silently fails the HMR/hydration handshake.
const baseUrl = \`http://localhost:\${port}\`;

let devServer;
let browser;

async function waitForReady(deadline) {
  while (Date.now() < deadline) {
    try {
      const res = await fetch(baseUrl);
      if (res.status < 500) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('next dev did not become ready in time');
}

beforeAll(async () => {
  // Spawn next's own CLI script directly via node, NOT "npx next dev" through
  // a shell — a shell-wrapped spawn (cmd.exe on Windows) means .kill() only
  // kills the shell, leaving the actual next dev process orphaned and still
  // holding the port for every subsequent test run.
  //
  // detached: true (POSIX only) makes this child the leader of its own new
  // process group, rather than inheriting ours — required so afterAll can
  // kill the whole group, not just this one pid. Real, live-triggered
  // finding: next dev itself spawns its own worker/router child processes
  // (webpack/turbopack compilation workers) that inherit next dev's process
  // group by default; killing only next dev's own pid leaves those workers
  // running and still writing into the app directory (e.g. .next/cache/**)
  // after the "test" has formally finished — which then races a caller's
  // temp-directory cleanup (see runMutationCheck.ts's scratch-copy rmSync)
  // and can throw ENOTEMPTY on a directory that should have been fully torn
  // down. Killing the negative pid (the whole group) reaches those workers
  // too, matching the Windows branch's existing "/t" tree-kill intent.
  const require = createRequire(import.meta.url);
  const nextBin = require.resolve('next/dist/bin/next');
  devServer = spawn(process.execPath, [nextBin, 'dev', '-p', String(port)], {
    cwd: appRoot,
    stdio: 'ignore',
    detached: process.platform !== 'win32'
  });
  await waitForReady(Date.now() + 60000);
  browser = await chromium.launch({ headless: true });
}, 90000);

afterAll(async () => {
  await browser?.close();
  if (devServer?.pid) {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(devServer.pid), '/t', '/f']);
    } else {
      try {
        // Negative pid targets the whole process group created by
        // detached: true above — reaches next dev's own worker children,
        // not just next dev itself.
        process.kill(-devServer.pid, 'SIGKILL');
      } catch {
        // already gone
      }
    }
  }
});
`;
}
