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

Not "backend cloning barely works," and not simply "field names/shapes reproduce reliably"
either — a fresh, second blind-rebuild experiment (`supportdesk`, see below) replaced that
first-pass read with a precise, mechanistic, falsifiable claim:

- **Field names/shapes/formats reproduce reliably only when a route's response is a literal
  object built in the same handler.** §4.6's notarybox result held because notarybox's one route
  happened to be exactly that shape. The moment a route's success response is a bare variable
  instead — a database row, an update result (`NextResponse.json(ticket)`,
  `NextResponse.json(updated)`) — contract generation goes fully blind: `inferResponseBodyFields`'s
  own documented scope (a bare-variable response is invisible) means the generated contract for
  that route carries zero information beyond its status code. In `supportdesk`, 3 of 4 routes hit
  this shape, and each shipped with a response contract containing nothing but an `error` field.
  A blind-rebuild agent given only that produced content-free stub responses (`{}`) for every one
  of them — passing every generated test (which only checks status codes and crash-safety) while
  reproducing zero real behavior. This is a majority shape in any real app with more than trivial
  CRUD, which is why it's the load-bearing finding, not a footnote.
- The semantic gaps named below are still real and reconfirmed with fresh, concrete examples —
  but the mechanism above is more fundamental: it's not just "the tests don't check business
  rules," it's that **the contract itself carries no information to check against** for the
  majority-shape case.
  - Status-code conventions (200 vs. 201) — still no contract signal for a dynamic-segment route.
  - Business-rule validation (accepting an incomplete record the original rejects) — reconfirmed;
    `supportdesk`'s rebuild silently accepted a request missing required fields.
  - Error-handling structure (try/catch presence) — reconfirmed; a malformed-JSON request that the
    original rejects with a clean `400` crashed the rebuild with an unhandled `500`.
  - Value-type semantics (string enum vs. number) — still untested directly, since the one field
    that would have exercised it (`resolution_minutes`, a computed number) lived on a bare-variable
    response and never reached the contract at all.

These are the real, nameable gaps to design against — `inferResponseBodyFields.ts`'s bare-variable
limitation is the single highest-leverage one, since it's the one gap that silences every other
signal downstream of it.

## Open question — resolved, with caveats

"Backend cloning doesn't work reliably" was a stale, too-coarse recollection — it's neither fully
true nor fully false. The `supportdesk` experiment (built specifically to re-run notarybox's
protocol against a genuinely more complex app: enum validation, two state-transition business
rules, a computed numeric field, five distinct status codes) replaced it with the precise
bare-variable-response mechanism above. Two rounds of blind rebuild were run to isolate a real
methodological confound: the first round's `--allowedTools` scoping blocked `next build`/`mkdir`/
`rm`, and the agent worked around being unable to diagnose a missing `tsconfig.json` by silently
converting the whole app from TypeScript to plain JavaScript — a dramatic-looking deviation that
turned out to be an artifact of the harness, not the pipeline. A second round with those tools
properly allowed kept the app in TypeScript and self-healed the missing `tsconfig.json`, but
surfaced a different, also-real pipeline gap (see the log below) and, freed from fighting that
blocker, converged even further toward content-free stub responses — strengthening rather than
undermining the core finding. Same evidentiary bar as notarybox itself (n=1, one hand-built app);
worth a second real target before this is fully settled, same discipline as the DOM-motion finding
below.

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
  yet folded into the manuscript. Now verified against a second, independently-built app (`glimmer`,
  a `setTimeout`-driven typewriter reveal — a different motion mechanism than `driftlight`'s
  `requestAnimationFrame` counter) in addition to `driftlight` itself — see `docs/v0-findings.md`,
  "Verifying `v0.2.8-paper` against a second target." Still n=2 and both hand-built apps, not
  something found in the wild, and both still the same broad category (JS-driven, eventually-
  settling DOM text) — a genuinely infinite or externally-paced motion source is still untested.
  Closer to ready for a revision pass than before, not yet there.
- `supportdesk` blind-rebuild experiment: resolved the open backend-fidelity question above into
  the bare-variable-response mechanism. Four general, real correctness bugs it surfaced are now
  fixed — narrow, cheap, general fixes, same category as `touchesHeldOut`, folded in directly, not
  gated on anything above: comma-inside-a-string-literal entry-splitting and request-field
  extraction hardcoded to a variable literally named `body` (both in
  `inferResponseBodyFields.ts`/`inferRequestBodyFields.ts`); and, from the confound-isolation
  rerun, the generated rebuild `package.json` unconditionally setting `"type": "module"` regardless
  of what the original app itself declared, and never carrying over the original's own
  `typescript`/`@types/*` devDependencies at all (`writeSpecTree.ts`). That last one is the
  confirmed, sole real cause of the confound-isolation rerun's `next dev` crash — isolated directly
  by testing each variable independently: pinning `typescript` back down alone fixed the boot with
  `"type": "module"` still present, and removing `"type": "module"` alone (with the incompatible
  `typescript` major left in place) did not fix it, reproducing the identical crash. The initial
  write-up here had attributed part of the cause to `"type": "module"` too, echoing the rebuild
  agent's own self-diagnosis without independently verifying it — that specific claim doesn't hold
  up; corrected here. `"type": "module"` is still fixed on its own, more modest merits (consistency
  with the rest of the pipeline's pin-to-the-original's-real-environment discipline; it also
  produced a real, if non-fatal, module-reparse warning), not because it was ever shown to cause
  the crash itself. The bare-variable-response limitation itself remains open — a real Phase 2
  capability gap, not fixed here. See `docs/v0-findings.md`, "The `supportdesk` blind-rebuild
  experiment," for the full methodology, both live-verified rebuild rounds, and the isolation test.
