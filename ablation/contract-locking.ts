// Native OpenCode plugin reimplementing rebuild-dossier's two mechanically-
// enforced "contract-locking" rails (see README.md's "Rails that are
// mechanically enforced, not just written down" and generateSettingsJson.ts,
// which this file's logic mirrors exactly) — needed because OpenCode does
// NOT natively honor Claude Code's .claude/settings.json PreToolUse/
// PostToolUse hooks; its own plugin API is a different shape entirely
// (tool.execute.before/after, per https://opencode.ai/docs/plugins). Without
// this file, generate_spec's own hooks silently do nothing under OpenCode,
// and the ablation's "with contract-locking" condition would be
// indistinguishable from "without" — the whole comparison would be measuring
// nothing.
//
// Install this file at ABLATION-WITH-DIR/.opencode/plugin/contract-locking.ts
// for every "with contract-locking" rep. Leave it out entirely (don't copy
// this file at all) for every "without contract-locking" rep — that's the
// one, isolated variable this ablation is testing.
//
// Smoke-tested live (opencode-ai@1.18.13, opencode/deepseek-v4-flash-free,
// --auto) against a scratch project, three cases: an edit under spec/ was
// blocked with this file's exact error message; a write to a file listed in
// spec/untested-contracts.json was blocked with this file's exact error
// message (the agent read this plugin's own source and correctly stopped to
// ask rather than trying to route around it); a write to an ordinary file
// under neither rule succeeded normally, confirming the plugin doesn't
// over-block. All three matched the hook signature below (input.tool,
// output.args.filePath) exactly as documented — no field-name corrections
// were needed.
import type { Plugin } from '@opencode-ai/plugin';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Mirrors BLOCK_SPEC_EDITS_COMMAND's regex in generateSettingsJson.ts.
const SPEC_PATH_PATTERN = /(^|[\\/])spec[\\/]/;

function extractFilePath(output: any): string | undefined {
  const args = output?.args ?? {};
  return args.filePath ?? args.file_path ?? args.path;
}

export const ContractLockingPlugin: Plugin = async ({ directory }) => {
  return {
    'tool.execute.before': async (input: any, output: any) => {
      if (input.tool !== 'edit' && input.tool !== 'write') return;
      const filePath = extractFilePath(output);
      if (!filePath) return;

      // Rail 1: spec/ is locked — mirrors BLOCK_SPEC_EDITS_COMMAND.
      if (SPEC_PATH_PATTERN.test(filePath)) {
        throw new Error('Blocked: spec/ is locked — do not edit files under spec/.');
      }

      // Rail 2: contracts without tests don't get built ahead of schedule —
      // mirrors BLOCK_UNTESTED_CONTRACT_WRITES_COMMAND.
      const listPath = join(directory, 'spec', 'untested-contracts.json');
      if (!existsSync(listPath)) return;
      let untested: string[];
      try {
        untested = JSON.parse(readFileSync(listPath, 'utf-8'));
      } catch {
        return;
      }
      const normalized = filePath.replace(/\\/g, '/');
      const hit = untested.some((u) => normalized.endsWith(String(u).replace(/\\/g, '/')));
      if (hit) {
        throw new Error(
          'Blocked: this file corresponds to a locked contract with no associated test in ' +
            'tests/visible/ yet. Building it now is batch regeneration, which this workspace ' +
            'disallows — work test-by-test. If this file genuinely must be built ahead of a ' +
            'failing test, stop and ask first.'
        );
      }
    }
  };
};
