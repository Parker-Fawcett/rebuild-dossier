export interface GenerateClaudeMdInput {
  projectName: string;
  stackLines: string[];
  testCommand: string;
}

// Kept short (~stack + non-negotiables only) — this is meant to be read in
// full every session, not skimmed.
export function generateClaudeMd(input: GenerateClaudeMdInput): string {
  return `# Project: ${input.projectName} (rebuild)

## Stack
${input.stackLines.join('\n')}

## Non-negotiable
- TDD strict. No code is considered done until tests/visible/ passes.
  A PostToolUse hook runs \`${input.testCommand}\` after every edit — do
  not bypass or ignore a failing hook.
- Interface contracts in spec/contracts/ are locked. Do not change a
  function signature or endpoint shape without first updating the
  spec file and getting it re-approved — a "correct" implementation
  with the wrong shape still fails verification.
- The dependency versions already pinned in package.json are locked
  the same way — they're the exact versions the original app actually
  ran with, not a suggestion. Do not upgrade, downgrade, or loosen them
  to a range, even if a different version would also satisfy the
  contracts; a different version can silently change real behavior.
- Do not special-case literal values seen in tests/visible/. Tests in
  tests/held-out/ exist specifically to catch this. If you find
  yourself writing \`if input === <test fixture value>\`, stop — you
  are gaming the suite, not solving the problem.
- After any passing state, do not let a subsequent change silently
  break something that was passing. Re-run the full visible suite,
  not just the test you were targeting, before considering a change
  complete.
- See .claude/rules/ for topic-specific conventions.

## Working style
- Prefer small, verifiable increments over large rewrites: fix one
  failing test at a time, confirm nothing else broke, then move on.
- If a test seems wrong, flag it and stop rather than silently
  overriding it. Spec files are the source of truth.
`;
}
