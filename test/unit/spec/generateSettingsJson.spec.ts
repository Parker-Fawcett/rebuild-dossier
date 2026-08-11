import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { generateSettingsJson } from '../../../src/spec/generateSettingsJson.js';

describe('generateSettingsJson', () => {
  let tmpDir: string | undefined;

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  });

  it('runs the detected test command after every Edit/Write via PostToolUse', () => {
    const settings = generateSettingsJson('npm test');
    const postToolUse = settings.hooks.PostToolUse;

    expect(postToolUse).toHaveLength(1);
    expect(postToolUse[0]?.matcher).toBe('Edit|Write');
    // The real test command still runs — chained after the heartbeat write,
    // not replaced by it.
    expect(postToolUse[0]?.hooks[0]?.command).toContain('npm test');
    expect(postToolUse[0]?.hooks[0]?.type).toBe('command');
  });

  it('writes a filesystem heartbeat before running the real test command, so a verifier does not have to assume enforcement was live from settings.json\'s mere presence', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'dossier-heartbeat-'));
    const settings = generateSettingsJson('node -e "process.exit(0)"');
    const command = settings.hooks.PostToolUse[0]?.hooks[0]?.command ?? '';

    // Simulate exactly what Claude Code does: pipe the hook JSON on stdin,
    // run in the target directory's own cwd.
    execSync(command, {
      cwd: tmpDir,
      input: JSON.stringify({ cwd: tmpDir, tool_input: { file_path: 'app/page.tsx' } })
    });

    const heartbeat = JSON.parse(readFileSync(join(tmpDir, '.claude', '.hook-heartbeat.json'), 'utf-8'));
    expect(heartbeat.cwd).toBe(tmpDir);
    expect(heartbeat.count).toBe(1);
    expect(new Date(heartbeat.lastFiredAt).toString()).not.toBe('Invalid Date');
  });

  it('increments the heartbeat count across repeated firings, so a verifier can distinguish one fluke firing from a session\'s real edit history', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'dossier-heartbeat-'));
    const settings = generateSettingsJson('node -e "process.exit(0)"');
    const command = settings.hooks.PostToolUse[0]?.hooks[0]?.command ?? '';
    const input = JSON.stringify({ cwd: tmpDir, tool_input: { file_path: 'app/page.tsx' } });

    execSync(command, { cwd: tmpDir, input });
    execSync(command, { cwd: tmpDir, input });
    execSync(command, { cwd: tmpDir, input });

    const heartbeat = JSON.parse(readFileSync(join(tmpDir, '.claude', '.hook-heartbeat.json'), 'utf-8'));
    expect(heartbeat.count).toBe(3);
  });

  it('still fails the hook overall when the real test command fails, even though the heartbeat write itself always succeeds', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'dossier-heartbeat-'));
    const settings = generateSettingsJson('node -e "process.exit(1)"');
    const command = settings.hooks.PostToolUse[0]?.hooks[0]?.command ?? '';
    const input = JSON.stringify({ cwd: tmpDir, tool_input: { file_path: 'app/page.tsx' } });

    expect(() => execSync(command, { cwd: tmpDir, input })).toThrow();

    // The heartbeat still recorded the firing — observability never masks
    // a real failure, and a real failure never suppresses the heartbeat.
    const heartbeat = JSON.parse(readFileSync(join(tmpDir, '.claude', '.hook-heartbeat.json'), 'utf-8'));
    expect(heartbeat.count).toBe(1);
  });

  it('blocks edits to spec/ via a PreToolUse hook that exits 2', () => {
    const settings = generateSettingsJson('npm test');
    const preToolUse = settings.hooks.PreToolUse;

    const specHook = preToolUse.find((entry) => entry.hooks[0]?.command.includes("spec[\\\\/]"));
    expect(specHook).toBeDefined();
    expect(specHook?.matcher).toBe('Edit|Write');
    expect(specHook?.hooks[0]?.type).toBe('command');
    expect(specHook?.hooks[0]?.command).toContain('process.exit(2)');
  });

  it('blocks writes to a contract file with no associated test via a second PreToolUse hook', () => {
    const settings = generateSettingsJson('npm test');
    const preToolUse = settings.hooks.PreToolUse;

    const untestedHook = preToolUse.find((entry) => entry.hooks[0]?.command.includes('untested-contracts.json'));
    expect(untestedHook).toBeDefined();
    expect(untestedHook?.matcher).toBe('Edit|Write');
    expect(untestedHook?.hooks[0]?.command).toContain('process.exit(2)');
  });
});
