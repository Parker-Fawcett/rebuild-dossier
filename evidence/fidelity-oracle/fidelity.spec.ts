// Fidelity oracle battery (frozen before any snapshot was scored).
//
// For each of the 32 method-level routes the sealed study's visible and
// held-out suites cover, send a fixed, generic battery of requests derived from
// the original app's auth and input handling, not tailored to any rebuild:
//   A  no Authorization header, no body
//   B  a non-Bearer Authorization header
//   C  a well-formed Bearer token (the original's base64 "userId:ts" scheme)
//   D  (body methods) C plus a malformed JSON body
//   E  (body methods) C plus an empty JSON object
// Records status and the sorted top-level JSON keys. Run identically against
// the original app (golden master) and each frozen rebuild; scored elsewhere.
import { NextRequest } from 'next/server';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.env.FIDELITY_ROOT!;
const out = process.env.FIDELITY_OUT!;
const routes = JSON.parse(readFileSync(process.env.FIDELITY_ROUTES!, 'utf-8'));
const TOKEN = Buffer.from('oracle-user:0').toString('base64');
const TIMEOUT_MS = 8000;

function variants(method: string) {
  const bearer = { Authorization: `Bearer ${TOKEN}` };
  const v: { id: string; headers: Record<string, string>; body?: string }[] = [
    { id: 'A', headers: {} },
    { id: 'B', headers: { Authorization: 'Basic abc' } },
    { id: 'C', headers: bearer },
  ];
  if (method !== 'GET') {
    v.push({ id: 'D', headers: { ...bearer, 'Content-Type': 'application/json' }, body: '{not json' });
    v.push({ id: 'E', headers: { ...bearer, 'Content-Type': 'application/json' }, body: '{}' });
  }
  return v;
}

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

it('fidelity battery', async () => {
  const results: unknown[] = [];
  for (const r of routes) {
    const file = resolveFile(r.file);
    let handler: unknown = null;
    let buildState = 'built';
    if (!file) buildState = 'not-built';
    else {
      try {
        const mod = await import(pathToFileURL(file).href);
        handler = mod[r.method];
        if (typeof handler !== 'function') buildState = 'method-missing';
      } catch (e) {
        buildState = 'import-error';
      }
    }
    for (const v of variants(r.method)) {
      const base = { route: `${r.method} ${r.file}`, suite: r.suite, variant: v.id };
      if (buildState !== 'built') { results.push({ ...base, outcome: buildState }); continue; }
      try {
        const req = new NextRequest(r.url, { method: r.method, headers: v.headers, body: v.body });
        const res = await Promise.race([
          (handler as (q: NextRequest, c: unknown) => Promise<Response>)(req, { params: r.params }),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), TIMEOUT_MS)),
        ]);
        results.push({ ...base, outcome: 'responded', ...(await describeResponse(res)) });
      } catch (e) {
        results.push({ ...base, outcome: (e as Error).message === 'timeout' ? 'timeout' : 'threw' });
      }
    }
  }
  writeFileSync(out, JSON.stringify(results, null, 1));
}, 900000);
