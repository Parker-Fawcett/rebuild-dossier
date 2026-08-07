#!/usr/bin/env node
// Session-root Claude Code hook script for the Claude-Code-native leg of the
// contract-locking ablation. Confirmed empirically that a target rep
// directory's own .claude/settings.json is never consulted for an Agent-tool
// subagent's tool calls — hooks only fire from this session's own root/global
// settings.json. So this script is installed there instead, and scopes
// itself entirely by matching tool_input's path/command against TRIAL_ROOT
// (argv[2]) — anything outside that root is a no-op, so this can never
// affect any other work in this session.
//
// Mirrors activity-log.ts's OpenCode plugin rules and logging exactly,
// ported to Claude Code's PreToolUse/PostToolUse hook protocol (payload
// shape confirmed live: hook_event_name, tool_name, tool_input, and for
// PostToolUse, tool_response.stdout/stderr).
import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const TRIAL_ROOT = process.argv[2];

const SPEC_PATH_PATTERN = /(^|[\s\\/])spec[\\/]/;
const HELD_OUT_PATH_PATTERN = /(^|[\s\\/])tests[\\/]held-out[\\/]/;

function repDirFor(pathOrCommand) {
  if (!TRIAL_ROOT || !pathOrCommand || !pathOrCommand.includes(TRIAL_ROOT)) return undefined;
  const rest = pathOrCommand.slice(pathOrCommand.indexOf(TRIAL_ROOT) + TRIAL_ROOT.length).replace(/^\/+/, '');
  const repName = rest.split(/[\s/]/)[0];
  return repName ? { repName, repPath: join(TRIAL_ROOT, repName) } : undefined;
}

let data = '';
process.stdin.on('data', (c) => (data += c));
process.stdin.on('end', () => {
  let j;
  try {
    j = JSON.parse(data);
  } catch {
    process.exit(0);
  }
  const event = j.hook_event_name;
  const tool = j.tool_name;
  const filePath = j.tool_input?.file_path;
  const command = j.tool_input?.command;

  const rep = repDirFor(filePath || command || '');
  if (!rep) process.exit(0);

  const stateDir = join(TRIAL_ROOT, '..', '.plugin-state', rep.repName);
  mkdirSync(stateDir, { recursive: true });
  const logPath = join(stateDir, 'activity-log.jsonl');
  const enforce = existsSync(join(stateDir, 'enforce'));

  function logLine(entry) {
    appendFileSync(logPath, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
  }

  if (event === 'PreToolUse' && (tool === 'Write' || tool === 'Edit')) {
    const underSpec = Boolean(filePath && SPEC_PATH_PATTERN.test(filePath));
    let untestedContract = false;
    if (filePath) {
      const listPath = join(rep.repPath, 'spec', 'untested-contracts.json');
      if (existsSync(listPath)) {
        try {
          const untested = JSON.parse(readFileSync(listPath, 'utf-8'));
          const norm = filePath.replace(/\\/g, '/');
          untestedContract = untested.some((u) => norm.endsWith(String(u).replace(/\\/g, '/')));
        } catch {
          // malformed list — fail open, matching activity-log.ts's isUntestedContract
        }
      }
    }
    const touchesHeldOut = Boolean(filePath && HELD_OUT_PATH_PATTERN.test(filePath));
    logLine({ phase: 'before', tool, filePath, underSpec, untestedContract, touchesHeldOut });

    if (!enforce) process.exit(0);
    if (underSpec) {
      console.error('Blocked: spec/ is locked — do not edit files under spec/.');
      process.exit(2);
    }
    if (untestedContract) {
      console.error(
        'Blocked: this file corresponds to a locked contract with no associated test in ' +
          'tests/visible/ yet. Building it now is batch regeneration, which this workspace ' +
          'disallows — work test-by-test. If this file genuinely must be built ahead of a ' +
          'failing test, stop and ask first.'
      );
      process.exit(2);
    }
    process.exit(0);
  }

  if (event === 'PreToolUse' && tool === 'Bash') {
    const touchesHeldOut = Boolean(command && HELD_OUT_PATH_PATTERN.test(command));
    logLine({ phase: 'before', tool, command, touchesHeldOut });
    process.exit(0);
  }

  if (event === 'PostToolUse' && tool === 'Bash') {
    const output = j.tool_response?.stdout ?? '';
    logLine({ phase: 'after', tool, command, output, exitCode: j.tool_response?.interrupted ? null : 0 });
    process.exit(0);
  }

  process.exit(0);
});
