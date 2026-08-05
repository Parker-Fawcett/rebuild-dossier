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
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const port = 10000 + Math.floor(Math.random() * 40000);
// "localhost", not "127.0.0.1" — Next's dev server only trusts "localhost" as
// a default dev origin; 127.0.0.1 silently fails the HMR/hydration handshake.
const baseUrl = \`http://localhost:\${port}\`;

// Mirrors resolveLocalApiUrlOverrides in resolveLocalApiUrlOverrides.ts —
// inlined here (not imported) because this generated file is its own,
// separate npm project with no dependency on rebuild-dossier itself, the
// same reason a couple of other capture-fidelity fixes are also inlined as
// plain JS elsewhere in this codebase's generated output. See that file's
// doc comment for why this exists: a target app can bake a NEXT_PUBLIC_* var
// pointing at a fixed localhost port into its own client bundle, which would
// otherwise never match whichever random port this specific test run's dev
// server lands on.
function resolveLocalApiUrlOverrides(repoPath, baseUrl) {
  const overrides = {};
  for (const filename of ['.env', '.env.local', '.env.development', '.env.development.local']) {
    const filePath = join(repoPath, filename);
    if (!existsSync(filePath)) continue;
    for (const line of readFileSync(filePath, 'utf-8').split('\\n')) {
      const match = line.match(/^\\s*(NEXT_PUBLIC_[A-Z0-9_]+)\\s*=\\s*["']?(https?:\\/\\/(?:localhost|127\\.0\\.0\\.1):\\d+)/);
      if (match) overrides[match[1]] = baseUrl;
    }
  }
  return overrides;
}

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
    detached: process.platform !== 'win32',
    // Overrides any NEXT_PUBLIC_* var this app's own .env* files hardcode to
    // a fixed localhost port — see resolveLocalApiUrlOverrides above.
    env: { ...process.env, ...resolveLocalApiUrlOverrides(appRoot, baseUrl) }
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
