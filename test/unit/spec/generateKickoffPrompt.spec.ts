import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { KICKOFF_PROMPT } from '../../../src/spec/generateKickoffPrompt.js';

const EXACT_TEXT = `This workspace has a locked rebuild spec. Before writing any code:

1. Read CLAUDE.md and everything in .claude/rules/ — these are
   non-negotiable, not suggestions.
2. Read spec/ in full. Every file there represents a decision that has
   already been made. Do not re-litigate any of it. If something in
   spec/ seems wrong or contradictory, STOP and ask.
3. Read spec/contracts/*.md. Match these interface shapes exactly. A
   correct implementation with the wrong shape still fails verification.

Then work in strict red-green-refactor cycles, not batch regeneration:

4. Pick ONE currently-failing test. Make the smallest possible change
   that could make it pass.
5. Immediately re-run the FULL tests/visible/ suite. If anything
   previously green is now red, revert and try a smaller fix.
6. Once your fix passes and no previously-passing test has regressed,
   move to the next currently-failing test. (Other tests you haven't
   reached yet are expected to still be red — that's normal progress,
   not a blocker.)
7. Never branch on a literal value that looks like a test fixture.

Do not touch tests/held-out/ until every visible test passes. Run it
once, at the end, as a final report.

If stuck on any test, say so explicitly rather than forcing a change
through. Report final pass/fail counts and anything you couldn't
satisfy without changing the spec.
`;

describe('KICKOFF_PROMPT', () => {
  it('matches the exact template text from the build spec, verbatim', () => {
    expect(KICKOFF_PROMPT).toBe(EXACT_TEXT);
  });

  it('ships exactly the wording the pre-registered randomized test validated', () => {
    const tested = readFileSync(new URL('../../../ablation/review-2026-09/prompts/kickoff-astra-revised.txt', import.meta.url), 'utf-8');
    expect(KICKOFF_PROMPT).toBe(tested);
  });

  it('no longer contains the sentence that deadlocks when read literally', () => {
    expect(KICKOFF_PROMPT).not.toContain('Only once the full visible suite is green');
  });
});
