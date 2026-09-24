// Verbatim per the build spec — the structure (read spec -> lock contracts
// first -> per-test red-green-refactor -> held-out run once at the end ->
// explicit blocker reporting) is what stays constant across projects; only
// the surrounding paths in spec/ itself vary per repo, not this text.
//
// Step 6 is the revised sentence from the pre-registered wording test
// (ablation/review-2026-09/PREREGISTRATION.md, E5 and §11). The original,
// "Only once the full visible suite is green, move to the next test", can
// deadlock when read literally: tests for routes not yet reached keep the
// suite red, and it forbids moving to them. gpt-6-astra stalled on it 5/5
// (and at ultra effort 2/2); a same-length neutral edit also stalled 5/5; this
// revision stalled 0/5, and 0/4 at xhigh and ultra.
export const KICKOFF_PROMPT = `This workspace has a locked rebuild spec. Before writing any code:

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
