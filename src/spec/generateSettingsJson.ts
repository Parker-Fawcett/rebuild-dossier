import { GUARD_HOOK_RELATIVE_PATH } from './generateGuardHook.js';

// Both write rails (spec/ lock, untested-contract block) now live in one
// generated script, .claude/hooks/rebuild-guard.mjs (see generateGuardHook.ts
// for why a file, and what it closes). Until this change they were inline
// `node -e` strings, and the untested-contracts one never ran at all: the
// shell collapsed a `\\` in its regex, node threw a SyntaxError before the
// script's try/catch, and exit 1 is a non-blocking hook error, so every write
// was allowed from v0 on. The matcher now includes Bash, so a shell-command
// write is checked too, and MultiEdit/NotebookEdit alongside Edit/Write.
const GUARD_MATCHER = 'Edit|Write|MultiEdit|NotebookEdit|Bash';
// `|| { …; exit 2; }` makes the guard fail closed: if the script is missing,
// unreadable, or crashes (node exits 1, which Claude Code treats as a
// non-blocking error), the write is blocked instead of silently allowed —
// the exact failure mode the old inline hook had.
// Exit 0 (allow) and 2 (a deliberate block) pass straight through; anything
// else means the guard itself failed (missing script, no node, a crash) and
// fails closed. The old `node guard || { ... }` also printed "did not run
// cleanly" after every deliberate block, so a live Codex run told the agent
// the guard was broken each time it worked.
const GUARD_COMMAND = `node ${GUARD_HOOK_RELATIVE_PATH}; s=$?; if [ "$s" -eq 0 ] || [ "$s" -eq 2 ]; then exit "$s"; fi; echo "Blocked: the workspace write guard (${GUARD_HOOK_RELATIVE_PATH}) did not run cleanly; restore it before writing." >&2; exit 2`;

// A target directory's own settings.json is never consulted at all when the
// session was launched via Claude Code's Agent tool as a subagent (confirmed
// empirically and against Claude Code's own docs — see the ablation study).
// Silent non-consultation produces no error and no signal by default:
// nothing distinguishes "the hook ran and found no violation" from "the hook
// was never loaded." This writes a heartbeat file every time PostToolUse
// actually fires, so a verifier can check .claude/.hook-heartbeat.json after
// any session and know, from the filesystem rather than a self-report,
// whether the rails shown active in this file were live for that run.
// Absence of the file after a session that made real edits is itself the
// signal: it means settings.json, PreToolUse rails included, was never
// consulted — the exact failure mode this hook exists to make visible
// instead of silent. Best-effort only: a thrown error while writing the
// heartbeat is swallowed so this observability step can never itself block
// or fail a legitimate test run.
const WRITE_HOOK_HEARTBEAT_COMMAND =
  'node -e "let d=\'\';process.stdin.on(\'data\',c=>d+=c);process.stdin.on(\'end\',()=>{try{const j=JSON.parse(d);const cwd=j.cwd||process.cwd();const fs=require(\'fs\');const path=require(\'path\');const dir=path.join(cwd,\'.claude\');fs.mkdirSync(dir,{recursive:true});const hbPath=path.join(dir,\'.hook-heartbeat.json\');let count=0;try{count=(JSON.parse(fs.readFileSync(hbPath,\'utf-8\')).count)||0;}catch(e){}fs.writeFileSync(hbPath,JSON.stringify({lastFiredAt:new Date().toISOString(),cwd:cwd,count:count+1},null,2));}catch(e){}});"';

export interface DossierSettingsJson {
  hooks: {
    PostToolUse: Array<{ matcher: string; hooks: Array<{ type: string; command: string }> }>;
    PreToolUse: Array<{ matcher: string; hooks: Array<{ type: string; command: string }> }>;
  };
}

export function generateSettingsJson(testCommand: string): DossierSettingsJson {
  return {
    hooks: {
      PostToolUse: [
        {
          matcher: 'Edit|Write',
          // PreToolUse and PostToolUse are sibling keys in the same
          // settings.json hooks object, loaded together — so a firing
          // heartbeat is proof the whole file, including both PreToolUse
          // rails, was consulted for this session, not just this one hook.
          hooks: [{ type: 'command', command: `${WRITE_HOOK_HEARTBEAT_COMMAND} && ${testCommand}` }]
        }
      ],
      PreToolUse: [
        {
          matcher: GUARD_MATCHER,
          hooks: [{ type: 'command', command: GUARD_COMMAND }]
        }
      ]
    }
  };
}

// The same two hooks for the OpenAI Codex CLI, which reads <repo>/.codex/hooks.json
// in the same nested matcher shape (confirmed live by the ablation's Codex
// harness, ablation/codex/README.md). Codex's file-edit tool is apply_patch
// (its Edit|Write matcher category also covers it) and its shell tool may
// surface under other names, so the matchers list those too. Without this
// file a Codex rebuild ran with no guard and no heartbeat at all (found in a
// cold run by a Codex-using operator). Codex asks the user to trust a
// project's hooks before running them.
const CODEX_GUARD_MATCHER = `${GUARD_MATCHER}|apply_patch|shell|exec_command|local_shell`;

export function generateCodexHooksJson(testCommand: string): DossierSettingsJson {
  return {
    hooks: {
      PostToolUse: [
        {
          matcher: 'Edit|Write|apply_patch',
          hooks: [{ type: 'command', command: `${WRITE_HOOK_HEARTBEAT_COMMAND} && ${testCommand}` }]
        }
      ],
      PreToolUse: [
        {
          matcher: CODEX_GUARD_MATCHER,
          hooks: [{ type: 'command', command: GUARD_COMMAND }]
        }
      ]
    }
  };
}
