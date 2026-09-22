#!/usr/bin/env node
// E1 (PREREGISTRATION.md): a run ledger generated from primary evidence, not
// prose. Walks every harness state dir under the given roots and emits one
// row per rep: what summary.json recorded, plus configuration facts read
// from the rep itself (settings.json hash and the hook scripts it names vs.
// the ones actually present), so drift between reps is visible in the data.
//
// Usage: node build-ledger.mjs [root ...] > ledger.csv
//   default root: ~/ablation-runs
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';

const roots = process.argv.slice(2).length ? process.argv.slice(2) : [join(homedir(), 'ablation-runs')];
const sha = (p) => (existsSync(p) ? createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 12) : '');
const rows = [];

const walk = (dir, depth = 0) => {
  if (depth > 3 || !existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    let st; try { st = statSync(p); } catch { continue; }
    if (!st.isDirectory() || name === 'node_modules') continue;
    if (name === '.claude-plugin-state' || name === '.codex-plugin-state') {
      for (const rep of readdirSync(p)) {
        const state = join(p, rep);
        if (!statSync(state).isDirectory()) continue;
        const summaryPath = join(state, 'summary.json');
        const s = existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, 'utf-8')) : null;
        const repDir = join(dir, rep);
        const settings = name === '.codex-plugin-state' ? join(repDir, '.codex', 'hooks.json') : join(repDir, '.claude', 'settings.json');
        let named = [], missing = [];
        if (existsSync(settings)) {
          named = [...new Set((readFileSync(settings, 'utf-8').match(/hooks\/[\w.-]+\.mjs/g) || []))];
          const hookDir = name === '.codex-plugin-state' ? join(repDir, '.codex') : join(repDir, '.claude');
          missing = named.filter((h) => !existsSync(join(hookDir, h)));
        }
        const markers = readdirSync(state).filter((f) => f.startsWith('enforce'));
        rows.push({
          family: basename(dir),
          rep,
          harness: name === '.codex-plugin-state' ? 'codex' : 'claude-code',
          markers: markers.join('+') || 'none',
          hasSummary: Boolean(s),
          exitCode: s?.claudeExitCode ?? s?.codexExitCode ?? '',
          toolCalls: s?.totalToolCallsLogged ?? '',
          visible: s ? `${s.visiblePass ?? '?'}/${s.visibleTotal ?? '?'}` : '',
          heldOut: s ? `${s.heldOutPass ?? '?'}/${s.heldOutTotal ?? '?'}` : '',
          heldOutTouchCount: s?.heldOutTouchCount ?? '',
          railViolationAttempts: s?.railViolationAttempts ?? '',
          heartbeatFired: s?.hookHeartbeatEverFired ?? '',
          settingsSha: sha(settings),
          hooksNamedInSettings: named.join(' '),
          hooksNamedButMissing: missing.join(' ')
        });
      }
      continue;
    }
    walk(p, depth + 1);
  }
};
roots.forEach((r) => walk(r));

const cols = Object.keys(rows[0] || { family: '' });
const esc = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
console.log(cols.join(','));
for (const r of rows.sort((a, b) => (a.family + a.rep).localeCompare(b.family + b.rep))) console.log(cols.map((c) => esc(r[c])).join(','));
