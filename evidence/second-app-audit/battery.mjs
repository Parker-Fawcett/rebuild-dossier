// Second-application audit battery: abdoulayebinta/mini-express-recipes-api @ 857d02fb.
// Author-written from the original's source; frozen (with golden answers and
// the scoring rule in PROTOCOL.md) before the rebuild was run.
//
//   TARGET=<app dir> OUT=<results.json> node evidence/second-app-audit/battery.mjs
//
// Runs the app from a fresh copy (so its JSON data files start from the
// committed state), over real HTTP, with a fixed JWT_SECRET. Records status,
// sorted top-level JSON keys, and a few shape facts per check.
import { cpSync, mkdtempSync, readdirSync, symlinkSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';

const TARGET = process.env.TARGET;
const OUT = process.env.OUT;
const PORT = 18000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;

const work = mkdtempSync(join(tmpdir(), 'recipes-audit-'));
for (const entry of readdirSync(TARGET)) {
  if (entry === 'node_modules' || entry === '.git' || entry === '.dossier') continue;
  cpSync(join(TARGET, entry), join(work, entry), { recursive: true });
}
symlinkSync(join(TARGET, 'node_modules'), join(work, 'node_modules'));

const server = spawn('node', ['src/index.js'], { cwd: work, env: { ...process.env, PORT: String(PORT), JWT_SECRET: 'audit-secret' }, stdio: 'ignore' });
let exited = false;
server.on('exit', () => { exited = true; });

async function waitUp() {
  for (let i = 0; i < 100; i++) {
    try { await fetch(`${BASE}/api/v1/recipes`); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error('server did not start');
}

async function call(method, path, { body, raw, token } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined || raw !== undefined) headers['Content-Type'] = 'application/json';
  try {
    const res = await fetch(`${BASE}${path}`, { method, headers, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined), redirect: 'manual', signal: AbortSignal.timeout(5000) });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch {}
    const keys = json && typeof json === 'object' && !Array.isArray(json) ? Object.keys(json).sort() : json === undefined ? (text ? 'non-json' : 'empty') : Array.isArray(json) ? 'array' : typeof json;
    const data = json?.data;
    return {
      outcome: 'responded', status: res.status, keys,
      location: res.headers.get('location'),
      dataIsArray: Array.isArray(data), dataLength: Array.isArray(data) ? data.length : undefined,
      dataKeys: data && !Array.isArray(data) && typeof data === 'object' ? Object.keys(data).sort() : undefined,
      hasToken: typeof json?.token === 'string',
      _json: json,
    };
  } catch (e) {
    return { outcome: exited ? 'server-exited' : 'no-response', error: String(e.name) };
  }
}

const recipe = { name: 'Audit Soup', healthLabels: ['Vegan'], cookTimeMinutes: 10, prepTimeMinutes: 5, ingredients: ['water'] };
const user = { name: 'auditor', email: `auditor-${Date.now()}@example.com`, password: 'correct-horse' };

const results = [];
const rec = (id, r) => { const { _json, ...rest } = r; results.push({ id, ...rest }); return r; };

try {
  await waitUp();
  rec('R01 GET / redirect', await call('GET', '/'));
  rec('R02 GET recipes list', await call('GET', '/api/v1/recipes'));
  rec('R03 GET seeded recipe 1', await call('GET', '/api/v1/recipes/1'));
  rec('R04 POST recipe, no token', await call('POST', '/api/v1/recipes', { body: recipe }));
  rec('R05 POST recipe, garbage token', await call('POST', '/api/v1/recipes', { body: recipe, token: 'not-a-jwt' }));
  rec('R06 PUT recipe 1, no token', await call('PUT', '/api/v1/recipes/1', { body: recipe }));
  rec('R07 DELETE recipe 1, no token', await call('DELETE', '/api/v1/recipes/1'));
  const signup = rec('R08 signup new user', await call('POST', '/api/v1/users/signup', { body: user }));
  rec('R09 signup duplicate email', await call('POST', '/api/v1/users/signup', { body: user }));
  const login = rec('R10 login correct password', await call('POST', '/api/v1/users/login', { body: { email: user.email, password: user.password } }));
  rec('R11 login wrong password [flagged]', await call('POST', '/api/v1/users/login', { body: { email: user.email, password: 'wrong' } }));
  rec('R12 login unknown email', await call('POST', '/api/v1/users/login', { body: { email: 'nobody@example.com', password: 'x' } }));
  const token = login._json?.token ?? signup._json?.token;
  const created = rec('R13 POST recipe, valid token', await call('POST', '/api/v1/recipes', { body: recipe, token }));
  rec('R14 POST recipe, valid token, empty body', await call('POST', '/api/v1/recipes', { body: {}, token }));
  const newId = created._json?.data?.id;
  rec('R15 GET created recipe', newId !== undefined ? await call('GET', `/api/v1/recipes/${newId}`) : { outcome: 'skipped: no created id' });
  rec('R16 PUT created recipe [flagged]', newId !== undefined ? await call('PUT', `/api/v1/recipes/${newId}`, { body: { ...recipe, name: 'Audit Soup 2' }, token }) : { outcome: 'skipped: no created id' });
  rec('R17 DELETE created recipe [flagged]', newId !== undefined ? await call('DELETE', `/api/v1/recipes/${newId}`, { token }) : { outcome: 'skipped: no created id' });
  rec('R18 signup, malformed JSON', await call('POST', '/api/v1/users/signup', { raw: '{not json' }));
  rec('R19 GET missing recipe (last: may crash the original)', await call('GET', '/api/v1/recipes/999999'));
} finally {
  writeFileSync(OUT, JSON.stringify(results, null, 1));
  server.kill();
  rmSync(work, { recursive: true, force: true });
}
