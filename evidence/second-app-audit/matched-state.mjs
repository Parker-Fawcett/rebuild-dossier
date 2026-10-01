// Supplementary matched-state check for R06/R07, recorded separately from the
// frozen 18-check score. In the frozen battery, R06/R07 use recipe id 1, which
// exists in the original's seed data and not in the rebuild, so resource state
// differs. Here both apps are asked about the SAME state:
//   present-in-both: a recipe each app just created (authenticated POST)
//   absent-in-both:  id 999999
// with no credentials, for PUT and DELETE. (GET on a missing id crashes the
// original, so it is not used.)
//   TARGET=<app dir> OUT=<json> node evidence/second-app-audit/matched-state.mjs
import { cpSync, mkdtempSync, readdirSync, symlinkSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';

const TARGET = process.env.TARGET, OUT = process.env.OUT;
const PORT = 19000 + Math.floor(Math.random() * 900), BASE = `http://127.0.0.1:${PORT}`;
const work = mkdtempSync(join(tmpdir(), 'recipes-matched-'));
for (const e of readdirSync(TARGET)) if (!['node_modules', '.git', '.dossier'].includes(e)) cpSync(join(TARGET, e), join(work, e), { recursive: true });
symlinkSync(join(TARGET, 'node_modules'), join(work, 'node_modules'));
const server = spawn('node', ['src/index.js'], { cwd: work, env: { ...process.env, PORT: String(PORT), JWT_SECRET: 'audit-secret' }, stdio: 'ignore' });

const call = async (method, path, { body, token } = {}) => {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(5000) });
  const text = await res.text(); let json; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json };
};
const results = [];
try {
  for (let i = 0; i < 100; i++) { try { await fetch(`${BASE}/api/v1/recipes`); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  const user = { name: 'm', email: `matched-${Date.now()}@example.com`, password: 'pw-123456' };
  await call('POST', '/api/v1/users/signup', { body: user });
  const { json: login } = await call('POST', '/api/v1/users/login', { body: { email: user.email, password: user.password } });
  const recipe = { name: 'Matched', healthLabels: ['x'], cookTimeMinutes: 1, prepTimeMinutes: 1, ingredients: ['y'] };
  const created = await call('POST', '/api/v1/recipes', { body: recipe, token: login?.token });
  const id = created.json?.data?.id;
  for (const [state, rid] of [['present-in-both', id], ['absent-in-both', 999999]]) {
    for (const method of ['PUT', 'DELETE']) {
      const r = await call(method, `/api/v1/recipes/${rid}`, method === 'PUT' ? { body: recipe } : {});
      results.push({ state, method, status: r.status });
    }
  }
} finally {
  writeFileSync(OUT, JSON.stringify(results, null, 1));
  server.kill();
  rmSync(work, { recursive: true, force: true });
}
