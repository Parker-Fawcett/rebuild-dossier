// OpenCode workspace plugin. Enforces two rules for this project (mirrors
// generateSettingsJson.ts's Claude Code hooks exactly): spec/ is locked, and
// a contract with no covering test yet in tests/visible/ cannot be built
// ahead of schedule.
//
// Every artifact this plugin reads or writes lives in a sibling directory
// next to the project root (../.plugin-state/<project-dir-name>/), never
// inside the project root itself — confirmed live that this matters: an
// earlier version wrote its activity log and enforcement marker inside the
// project root, and a real session's own directory listing surfaced them,
// which the model then read directly. Enforcement is gated on a file named
// `enforce` existing in that sibling directory — present means both rules
// are active; absent means logging still happens but neither rule blocks
// anything.
import type { Plugin } from '@opencode-ai/plugin';
import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';

// Boundary is start-of-string, a path separator, OR whitespace — not just
// the first two. Real, live-triggered bug found during a dry run: a bash
// command listing several paths space-separated (e.g. `ls -la spec/
// tests/held-out/`) has "tests/held-out/" preceded by a space, which
// `(^|[\\/])` never matches — the self-reporting agent correctly flagged
// touching tests/held-out/ in exactly this shape, while this pattern
// silently returned false, disagreeing with a mechanical log that was
// supposed to be the more trustworthy source.
const SPEC_PATH_PATTERN = /(^|[\s\\/])spec[\\/]/;
const HELD_OUT_PATH_PATTERN = /(^|[\s\\/])tests[\\/]held-out[\\/]/;

function extractFilePath(output: any): string | undefined {
  const args = output?.args ?? {};
  return args.filePath ?? args.file_path ?? args.path;
}

function isUntestedContract(directory: string, filePath: string): boolean {
  const listPath = join(directory, 'spec', 'untested-contracts.json');
  if (!existsSync(listPath)) return false;
  let untested: string[];
  try {
    untested = JSON.parse(readFileSync(listPath, 'utf-8'));
  } catch {
    return false;
  }
  const normalized = filePath.replace(/\\/g, '/');
  return untested.some((u) => normalized.endsWith(String(u).replace(/\\/g, '/')));
}

export const ActivityLogPlugin: Plugin = async ({ directory }) => {
  const pluginStateDir = join(directory, '..', '.plugin-state', basename(directory));
  mkdirSync(pluginStateDir, { recursive: true });
  const logPath = join(pluginStateDir, 'activity-log.jsonl');
  const enforce = existsSync(join(pluginStateDir, 'enforce'));

  function logLine(entry: Record<string, unknown>): void {
    appendFileSync(logPath, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
  }

  return {
    'tool.execute.before': async (input: any, output: any) => {
      const tool = input.tool;
      const filePath = extractFilePath(output);
      const command = output?.args?.command;

      const isEditOrWrite = tool === 'edit' || tool === 'write';
      const underSpec = Boolean(filePath && SPEC_PATH_PATTERN.test(filePath));
      const untestedContract = Boolean(filePath && isEditOrWrite && isUntestedContract(directory, filePath));
      // Boolean(...) wrapped, not left as a possibly-undefined expression —
      // JSON.stringify silently DROPS an undefined field instead of writing
      // `false`, which would make an explicit non-match indistinguishable
      // from a field that was never computed at all when parsing the log
      // later. Every boolean field here must always be present.
      const touchesHeldOut = Boolean(
        (filePath && HELD_OUT_PATH_PATTERN.test(filePath)) || (command && HELD_OUT_PATH_PATTERN.test(command))
      );

      // Log the attempt before deciding whether to block it, not after.
      logLine({
        phase: 'before',
        tool,
        filePath,
        command,
        underSpec,
        untestedContract,
        touchesHeldOut
      });

      if (!enforce) return; // "without contract-locking" — log only, never block.
      if (isEditOrWrite && underSpec) {
        throw new Error('Blocked: spec/ is locked — do not edit files under spec/.');
      }
      if (isEditOrWrite && untestedContract) {
        throw new Error(
          'Blocked: this file corresponds to a locked contract with no associated test in ' +
            'tests/visible/ yet. Building it now is batch regeneration, which this workspace ' +
            'disallows — work test-by-test. If this file genuinely must be built ahead of a ' +
            'failing test, stop and ask first.'
        );
      }
    },
    'tool.execute.after': async (input: any, output: any) => {
      const tool = input.tool;
      const command = input.args?.command;
      logLine({
        phase: 'after',
        tool,
        command,
        output: output?.output ?? output?.metadata?.output,
        exitCode: output?.metadata?.exit
      });
    }
  };
};
