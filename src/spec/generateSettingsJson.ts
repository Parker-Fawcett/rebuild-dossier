// Cross-platform (no bash/jq assumption) — reads the hook's stdin JSON,
// blocks only when tool_input.file_path falls under a spec/ directory
// segment.
const BLOCK_SPEC_EDITS_COMMAND =
  'node -e "let d=\'\';process.stdin.on(\'data\',c=>d+=c);process.stdin.on(\'end\',()=>{try{const j=JSON.parse(d);const fp=(j.tool_input&&j.tool_input.file_path)||\'\';if(/(^|[\\\\/])spec[\\\\/]/.test(fp)){console.error(\'Blocked: spec/ is locked — do not edit files under spec/.\');process.exit(2);}process.exit(0);}catch(e){process.exit(0);}});"';

// "Only build what's currently failing, don't batch-regenerate every locked
// contract" was, before this, only a sentence in the kickoff prompt — nothing
// mechanically checked it, so a model that weighs prose less heavily could
// (and did, in practice) build every contract in spec/contracts/ up front and
// still pass every test, since no test ever looks at the extra files. This
// hook is what makes that rule structurally identical to the spec/-edit
// block above, instead of advisory: it reads spec/untested-contracts.json
// (written by generate_spec) and blocks writing to any file listed there.
const BLOCK_UNTESTED_CONTRACT_WRITES_COMMAND =
  'node -e "let d=\'\';process.stdin.on(\'data\',c=>d+=c);process.stdin.on(\'end\',()=>{try{const j=JSON.parse(d);const fp=(j.tool_input&&j.tool_input.file_path)||\'\';const cwd=j.cwd||process.cwd();const fs=require(\'fs\');const path=require(\'path\');const listPath=path.join(cwd,\'spec\',\'untested-contracts.json\');if(!fs.existsSync(listPath)){process.exit(0);}const untested=JSON.parse(fs.readFileSync(listPath,\'utf-8\'));const norm=fp.replace(/\\\\/g,\'/\');const hit=untested.some(u=>norm.endsWith(String(u).replace(/\\\\/g,\'/\')));if(hit){console.error(\'Blocked: this file corresponds to a locked contract with no associated test in tests/visible/ yet. Building it now is batch regeneration, which this workspace disallows -- work test-by-test. If this file genuinely must be built ahead of a failing test, stop and ask first.\');process.exit(2);}process.exit(0);}catch(e){process.exit(0);}});"';

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
          matcher: 'Edit|Write',
          hooks: [{ type: 'command', command: BLOCK_SPEC_EDITS_COMMAND }]
        },
        {
          matcher: 'Edit|Write',
          hooks: [{ type: 'command', command: BLOCK_UNTESTED_CONTRACT_WRITES_COMMAND }]
        }
      ]
    }
  };
}
