// Runs S. N. Ahmed's independently authored checks (checks-ahmed.json, frozen
// unchanged) against one target: the original app or one frozen rebuild.
// Same execution path as evidence/fidelity-oracle/fidelity.spec.ts: each
// route's handler is imported and called in-process with a NextRequest; no
// database (DATABASE_URL points at a closed port). Records outcome, status and
// the sorted top-level JSON keys; scoring is done separately by score.mjs.
import { NextRequest } from 'next/server';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.env.FIDELITY_ROOT!;
const out = process.env.FIDELITY_OUT!;
const routes = JSON.parse(readFileSync(process.env.FIDELITY_ROUTES!, 'utf-8'));
const { checks } = JSON.parse(readFileSync(process.env.INDEPENDENT_CHECKS!, 'utf-8'));
const TIMEOUT_MS = 8000;

// Map a check's method + path onto a route file and its path params.
const matchers = routes.map((r: { method: string; file: string; suite: string }) => {
  const names: string[] = [];
  const pattern = r.file
    .replace(/^src\/app/, '')
    .replace(/\/route\.ts$/, '')
    .replace(/\[([^\]]+)\]/g, (_: string, n: string) => (names.push(n), '([^/]+)'));
  return { re: new RegExp(`^${pattern}$`), names, route: r };
});

function resolveFile(rel: string): string | null {
  const base = join(root, rel).replace(/\.ts$/, '');
  for (const ext of ['.ts', '.js', '.tsx', '.mjs']) if (existsSync(base + ext)) return base + ext;
  return null;
}

async function describeResponse(res: Response) {
  const text = await res.text();
  let keys: string[] | string = 'non-json';
  try {
    const json = JSON.parse(text);
    keys = json && typeof json === 'object' && !Array.isArray(json) ? Object.keys(json).sort() : Array.isArray(json) ? 'array' : typeof json;
  } catch {}
  return { status: res.status, keys };
}

it('independent checks', async () => {
  const results: unknown[] = [];
  for (const c of checks) {
    const [pathname] = c.path.split('?');
    const m = matchers.find((x: { route: { method: string }; re: RegExp }) => x.route.method === c.method && x.re.test(pathname));
    const base = { id: c.id, route: m ? `${m.route.method} ${m.route.file}` : null, suite: m?.route.suite ?? null };
    if (!m) { results.push({ ...base, outcome: 'unmapped' }); continue; }
    const values = pathname.match(m.re)!.slice(1);
    const params = Object.fromEntries(m.names.map((n: string, i: number) => [n, values[i]]));
    const file = resolveFile(m.route.file);
    if (!file) { results.push({ ...base, outcome: 'not-built' }); continue; }
    let handler: unknown;
    try {
      handler = (await import(pathToFileURL(file).href))[c.method];
    } catch {
      results.push({ ...base, outcome: 'import-error' }); continue;
    }
    if (typeof handler !== 'function') { results.push({ ...base, outcome: 'method-missing' }); continue; }
    try {
      const body = c.body === null || c.body === undefined ? undefined : typeof c.body === 'string' ? c.body : JSON.stringify(c.body);
      const req = new NextRequest(`http://localhost:3000${c.path}`, { method: c.method, headers: c.headers, body });
      const res = await Promise.race([
        (handler as (q: NextRequest, ctx: unknown) => Promise<Response>)(req, { params }),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), TIMEOUT_MS)),
      ]);
      results.push({ ...base, outcome: 'responded', ...(await describeResponse(res)) });
    } catch (e) {
      results.push({ ...base, outcome: (e as Error).message === 'timeout' ? 'timeout' : 'threw' });
    }
  }
  writeFileSync(out, JSON.stringify(results, null, 1));
}, 900000);
