#!/usr/bin/env node
// PostToolUse hook, matcher "Bash". Closes a real, previously-named gap: a
// directory listing or similar command (e.g. `find . -maxdepth 3 ...`)
// whose command TEXT never mentions tests/held-out/ can still have it in
// its OUTPUT once the command actually runs — invisible to a
// PreToolUse-only, command-text check, since PreToolUse fires before the
// command executes and has no output to look at.
//
// Ported from a prior fix to this same measurement approach for the
// identical gap (a `find tests -type f | sort`-style command's text never
// says "held-out", but its captured stdout does). That fix lives in an
// offline analysis script fed by an unconditional output-logging hook;
// this one is architecturally the same shape, adapted to Claude Code: log
// every Bash call's actual output, scan it here rather than trusting the
// PreToolUse-only check alone.
//
// Confirmed directly (a real PostToolUse payload for a Bash call was
// captured and inspected, not assumed): the tool's actual output arrives
// as `tool_response.stdout` / `tool_response.stderr`, both plain strings.
// Multi-line output is captured in full, verified against the exact
// real-world shape that was missed before (a `find ... | sort` listing
// several paths, held-out files among them).
import { existsSync, appendFileSync, mkdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';

// Identical pattern to tool-log-readonly.mjs, not shared via import —
// matches this project's existing convention of small, independent hook
// scripts (Claude Code invokes each as its own process; there is no
// shared module to import from). Requires the fuller tests/held-out/ path
// segment, not just the bare word "held-out" -- deliberate: a command's
// output using that word in an unrelated, non-path sense (e.g. a comment
// or log line saying a feature is "held out") should not trigger this,
// and cannot, since it lacks the surrounding tests[\\/] ... [\\/] shape.
// For this project's own target apps, there is no legitimate reason for
// generated-app output to contain the literal path tests/held-out/ other
// than actually referencing that directory, so a false positive here
// would itself be a real, worth-investigating signal, not noise to
// suppress.
const HELD_OUT_PATH_PATTERN = /(^|[\s\\/])tests[\\/]held-out[\\/]/;

let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(raw);
    const cwd = input.cwd || process.cwd();
    const command = input.tool_input?.command;
    const stdout = input.tool_response?.stdout;
    const stderr = input.tool_response?.stderr;

    const stateDir = join(dirname(cwd), '.claude-plugin-state', basename(cwd));
    mkdirSync(stateDir, { recursive: true });
    const logPath = join(stateDir, 'activity-log.jsonl');

    const touchesHeldOut = Boolean(
      (stdout && HELD_OUT_PATH_PATTERN.test(stdout)) || (stderr && HELD_OUT_PATH_PATTERN.test(stderr))
    );

    appendFileSync(
      logPath,
      JSON.stringify({
        ts: new Date().toISOString(),
        phase: 'after-bash-output',
        toolNameRaw: input.tool_name ?? input.tool ?? null,
        command,
        touchesHeldOut
      }) + '\n'
    );
    process.exit(0); // this hook never blocks anything — logging only
  } catch {
    process.exit(0);
  }
});
