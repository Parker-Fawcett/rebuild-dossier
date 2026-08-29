# rebuild-dossier — Phase 2 vision

**Status:** not started, not scoped, no urgency.

## The one-sentence version

A tool that takes genuinely messy real-world source — old, weird-language legacy code, or
current AI-slop-quality code with no tests and no clean architecture — and extracts a spec good
enough to clone it into a clean, dead-code-free, working repo that looks and functions the same,
via a single kickoff prompt to an agent using an auto-generated harness.

## What this is not

A revision to Paper 1. Paper 1 (currently under review at EMSE) is complete and answers its own
question — does mechanical enforcement change LLM agent behavior, and where does it stop
mattering. This vision is a separate, future research direction: can the underlying tool actually
generalize to arbitrary, messy, real-world targets. The two stay separated on purpose.

## The governing rule

Any repo work that would require re-measuring or reinterpreting a number Paper 1 already cites
waits for Paper 2.

Purely additive work — new language support, new capability, anything that doesn't touch the
pinned `v0.2.x-paper` history — is fair game any time.

The sharper test for whether a fix can fold back into Paper 1's own documentation now, versus
waiting for a batched revision pass: does it change the truth-value of something a reader is
currently citing?

- An observability fix (e.g. `touchesHeldOut`) that lets the harness see something it was blind
  to before, without making any existing sentence in the manuscript false, can be folded into
  `docs/v0-findings.md` immediately — it's a measurement-apparatus improvement, not a claim under
  review changing.
- A capability fix that retires a limitation the manuscript currently states as open (e.g.
  DOM-stability polling closing the JS-motion gap Appendix C.5 calls "fully open") makes an
  existing sentence false the moment it lands. That's a bigger claim than an instrumentation fix,
  and it earns the same scrutiny any "we can now do X" assertion should get before entering a
  manuscript under review — independent re-verification, ideally against a second real target,
  not just the fixture purpose-built to expose the original gap. It lives in
  `docs/v0-findings.md` as the current, accurate record, and waits for a deliberate, batched
  revision pass to enter the manuscript itself.

## What Paper 1's own evidence already says about backend fidelity

Not "backend cloning barely works" — something more specific and more useful to design against:

- Field names, shapes, and formats reproduce reliably — §4.6's notarybox result, verified via
  matching live HTTP responses field-for-field, down to exact timestamp formatting.
- What's actually missing is a specific, enumerable set of semantic properties the current
  contract format has no representation for at all:
  - Status-code conventions (200 vs. 201)
  - Business-rule validation (accepting an incomplete record the original rejects)
  - Error-handling structure (try/catch presence)
  - Value-type semantics (string enum vs. number)

These are the real, nameable gaps to design against.

## Open question, not yet resolved

Whether a recollection of "backend cloning doesn't work reliably" reflects the tool's current
state or an earlier one — worth a fresh, direct check against the current tool before treating it
as a real, current gap.

## Rough shape of the components this would eventually need

(No particular order yet.)

- Language-agnostic extraction — current parsers are JS/TS only, by the tool's own stated
  limitation.
- The semantic contract gaps above — status codes, validation rules, error-handling structure,
  type semantics.
- Frontend fidelity beyond DOM-text and static screenshots — motion is a first step, already
  underway (DOM-stability polling, `v0.2.8-paper`).
- Real auth/session handling in generated specs.

## Log of Phase-2-adjacent fixes already folded back into Paper 1's documentation

(Observability/instrumentation fixes only — capability fixes wait for a batched revision pass,
per the rule above.)

- `touchesHeldOut` bash-output scanning gap (Claude Code harness) — fixed, `v0.2.6-paper`.
- DOM-stability polling for JS-driven motion capture — fixed, `v0.2.8-paper`. Capability fix, not
  yet folded into the manuscript — verified against `driftlight` only so far; needs a second real
  target before it's ready to enter a revision pass.
