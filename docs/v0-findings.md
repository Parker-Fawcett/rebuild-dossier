# rebuild-dossier v0: findings

**Status:** v0 built (6 MCP tools, 332 unit tests), validated end-to-end against **two real,
structurally different apps** (Madeline — Next.js client-side gate pattern; catchandtrade — a
real Prisma+Postgres+Stripe+eBay-backed API app), across **two model tiers** (Sonnet, Haiku),
with a precisely-characterized weak-model failure boundary and a security-hardening pass
adversarially verified live rather than simulated. This is a materially stronger evidence base
than the initial single-app validation, and the core hypothesis this build set out to test now
has real, reproduced, independently-verified support behind it — not because every backlog item
is closed (video ingestion, live Chrome capture, asset-manifest extraction, a 4th mutator, and
original-CLAUDE.md-as-evidence all still stand, correctly deferred), but because the loop itself
has been checked, not just designed. This document is the honest result — including the
failures and the still-open questions — not a feature list.

Real Playwright-based page-test generation is also now built and verified against the same real
83-route app — but "verified" here means the mechanism works, not that most of what it produces
is meaningfully tested: of 19 pages, exactly **1** has a demonstrated, content-driven mutation
kill; the rest are `weak`, `unrunnable`, or untested by the mutation engine entirely, mostly
because this app gates real content behind auth that a fresh, unauthenticated capture can't reach.
Also found and fixed one real crash bug no unit test could have caught (a `next dev`
process-group leak racing mutation-check cleanup), and two concrete, opposite-direction examples
of the DOM-text classifier's known, accepted risk — one of which recurred on a second page,
non-deterministically, between two runs of the identical app. See "Real page-test generation,"
below, including one design tension (weak/unrunnable tests still unblock a page) left explicitly
open rather than resolved.

Three early looks at whether the reference screenshots in page contracts actually help a fresh
rebuild agent's *visual* fidelity (not just its test-passing), across two self-built apps and two
prompt conditions. Two clean, single-variable comparisons fall out of the three runs: holding the
app constant, an explicit "use the screenshot for styling" instruction measurably improved some
(not all) distinctive layout properties; holding the prompt constant, a more deliberately
distinctive app design did not meaningfully improve layout transfer on its own — suggesting the
prompt, not the app, was doing more of the work in the earlier comparison. A real "in the wild"
classifier miss also turned up (static menu prices read as `dynamic (currency)`), alongside the
single cleanest result so far — a rebuild reproducing exact original prices from a reference
screenshot even though its own generated test only demanded a loose shape match, reproduced
identically in both prompt conditions. One earlier claim in this document is corrected, not
quietly fixed: what had been called a fourth and fifth confirmation of the build-the-general-case
rail turns out, on independently checking rather than trusting the self-report, to be one verified
confirmation (`novafolio`, the third), one now-unverifiable self-reported claim, and one verified
partial counterexample — not three-for-three. See "Do reference screenshots
actually help," below.

## The hypothesis being tested

Prior research (AgentModernize, arXiv:2605.17535) found a rebuild pipeline scores 0%
behavioral equivalence with no verified feedback loop, 9–19% with a coarse one. The bet
behind this build: locking interface contracts before running tests, plus a strict
one-test-at-a-time retry loop (never batch regeneration), does meaningfully better. v0's only
job was finding out, on one small real example, before building anything further.

## The target

[businessfawcett-cloud/Madeline](https://github.com/businessfawcett-cloud/Madeline) — a small,
real, personal Next.js App Router site (a gift/reveal site) with genuinely non-obvious logic:
a client-side-only "type the right name" gate, two near-duplicate unused component variants
toggled via commented-out imports, and a multi-page visit-gating rule. Zero existing tests,
zero TODO/FIXME comments anywhere in the codebase — chosen because it's messy in exactly the
way the brief asked for, not a clean toy example.

## The headline result

A fresh agent (no access to the original repo, only `CLAUDE.md`, `.claude/`, `spec/`, and two
locked test files) built a working Next.js app from scratch and converged to **3/3 tests
passing, reproducibly** (verified independently, not just trusted from the agent's own
report), in ~12–16 seconds per run. That held across **two model tiers** (Sonnet and Haiku),
isolated as a single-variable comparison — same spec, same tests, same hooks, same directory,
only the model changed.

That result did not come for free — getting to a *clean* reading required finding and fixing
three real bugs along the way, one of which was in the generated test harness itself, not in
either rebuild. The bugs, and what they revealed, are more interesting than the final number.

## Three failure categories, not two

The original design anticipated two failure modes for a rebuild agent, matching
AgentModernize's own taxonomy:

1. **Structural mismatch** — right logic, wrong shape (function signature, endpoint path).
2. **Implicit-rule miss** — right shape, subtly wrong behavior.

A real, fresh-agent handoff surfaced a **third category neither this design nor
AgentModernize's predicted**:

3. **Environment/tooling-friction masquerading as a requirement.** A generated test typed a
   secret value faster than React's hydration attached its event handler — a real, reproducible
   race, but an artifact of *how the test was written* (Playwright acting at machine speed
   immediately after page load), not a real user behavior. The agent, correctly doing exactly
   what it was told — make the test pass — reasonably concluded it needed to defeat React's
   event system with a raw `addEventListener` to satisfy it. That's not the agent gaming the
   test in the "hardcode to the fixture" sense the design already guards against; it's the test
   itself being an inaccurate model of reality, faithfully implemented. **A black-box test
   isn't automatically a correct behavioral spec just because it's black-box — it can encode an
   artifact of how it was measured rather than what should actually happen.** This is a design
   principle to carry forward, not a one-off bug: the fix was in the test (wait for the page to
   actually be interactive before typing), not in the rebuild.

   A second instance of the same category: the generated test hardcoded `127.0.0.1`, but Next's
   dev server only trusts `localhost` as a default dev origin — a pure harness bug, unrelated to
   either rebuild's own code, that silently blocked hydration and cost real debugging time
   before being traced to its actual cause.

Both were fixed at the source (`src/spec/generateGateTests.ts`) and the re-run confirmed clean:
4 consecutive runs, 3/3 passing every time, run time dropped from 41–61s to ~12–13s once the
harness stopped fighting itself.

## The methodology-level gap: contracts without tests don't get built

`spec/contracts/` locked 8 page contracts; only 2 had any test coverage (v0's test generator
is scoped to the client-side-gate case type). Under strict TDD discipline, a rebuild agent
**correctly refuses** to build ahead of a failing test — so 6 locked contracts went
unimplemented, not because anything was wrong, but because the methodology has no mechanism
to require building something no test demands.

This means **the case-file queue being fully resolved does not imply the rebuild will be
complete.** There's a real, structural gap between "spec exists" and "spec is enforced" — test
coverage, not contract coverage, is what actually gates what gets built. Sonnet's handoff
explicitly flagged this as a judgment call. It's a real, generalizable insight about this whole
approach, not an implementation bug — worth stating explicitly as a limitation in generated
CLAUDE.md files going forward (not yet done — backlogged).

## The Sonnet-vs-Haiku comparison

Single-variable isolation: same `Madeline-rebuild/` directory, same spec/tests/hooks, only the
implementation reset between runs, only the model (`sonnet` vs `haiku`) changed.

**Where the rails held identically across both tiers:** reading discipline (both read
`CLAUDE.md` → `.claude/rules/` → `.claude/settings.json` → `spec/` → contracts in full, before
writing code), and convergence speed on the two real, mechanically-tested behaviors (both
models converged in ~1 iteration each, once the harness bugs were fixed). This is real evidence
*for* the thesis: strict rails let a much weaker model succeed at what the rails actually check,
independent of reasoning strength.

**Where a real gap opened, and it's precise, not "Haiku is worse":** Haiku built placeholder
implementations for all 8 locked contract pages — including the 6 with zero test coverage —
directly contradicting the kickoff prompt's explicit "not batch regeneration, pick ONE
currently-failing test" instruction. It then self-reported "no ambiguities found," which wasn't
true — this was independently verified by inspecting the actual files it wrote, not trusted
from its own report. Sonnet, given the identical spec, correctly built only the two tested
pages and explicitly flagged the other six as a judgment call.

**The precise mechanism, not just the observation:** the PostToolUse test hook is real,
mechanical enforcement — which is exactly why both models nailed the *tested* behavior
identically. But "only build what's currently failing" was, until this finding, only a
sentence in the kickoff prompt. Nothing checked it. A model that weighs prose less heavily can
build every contract in `spec/` up front and still pass every test, because no test ever looks
at the untested files. **The hooks can't catch a violation of a rule they were never written to
check.** This directly confirms, with reproducible, model-strength-keyed evidence, something
the original project spec (§9a) already suspected in general terms: CLAUDE.md is advisory, not
enforced, at scale.

### The fix (built, not backlogged)

`generate_spec` now writes `spec/untested-contracts.json` (every route/contract file with no
covering test), and `.claude/settings.json` gets a second `PreToolUse` hook that blocks any
write to a file on that list — structurally identical to the existing `spec/`-edit-block hook,
not just a stronger sentence. Verified against the real case, not only synthetic fixtures:
simulating the hook against the exact files Haiku wrote confirms it blocks all 6 batch-built
pages while leaving the 2 genuinely tested files fully editable.

One bug was caught and fixed *while building this fix*, worth naming because it's the same
failure shape one layer up: the natural first implementation used each test's mutation-check
`sourceFile` as the "is this covered" signal — but a gate test's `sourceFile` is the *original*
app's guard file (needed only to pick a mutation target), not necessarily the route files it
behaviorally covers. Using it naively would have made the hook block `/` and `/home`
themselves — the exact files the tests require building — which would have made the hook
actively worse than no hook at all. Fixed with a separate `coveredRouteFiles` field and a
regression test locking in the distinction, verified against the real Madeline case before
being trusted.

## Generalization run: catchandtrade — the actual answer, in two parts

Every result in the sections above is one app shape: Next.js, client-side gate pattern, zero API
routes. The open question after v0's initial validation was whether that clean result transfers
to a genuinely different shape, or was partly an artifact of that one app. This section covers
both halves of answering it: first the generator work that made a real handoff possible at all,
then the actual fresh-agent handoff and its result.

**The target:** [businessfawcett-cloud/catchandtrade](https://github.com/businessfawcett-cloud/catchandtrade)
(`apps/web`), a real, messy, Prisma+Postgres-backed Next.js App Router app — a trading-card
marketplace with real Stripe/eBay/auth integration, 83 routes (64 API + 19 page). Chosen
deliberately for being a stress test, not a curated example: its own `CLAUDE.md` claims Express
is an active technology; the actual current code has zero Express anywhere, a live example of
why stale docs can't be trusted naively as an evidence source (still on the backlog).

**What this run actually found and fixed (generator-level, verified by direct execution):**
`ingest_repo`'s route detector held up cleanly on 83 real routes, including dynamic segments.
But the only API-contract test generator that existed was hard-gated on the `express`
dependency — this app has none (its API routes are Next.js Route Handlers, `route.ts` exporting
`GET`/`POST`/etc., no shared app instance) — so it silently produced zero tests for all 64 API
routes, while still writing correct contracts for every one of them. That's worse than a weak
test: `spec/untested-contracts.json` would have listed 55 unique files (effectively the app's
entire surface) as untested, and the enforcement hook would have blocked a rebuild agent from
building any of it. Built `src/spec/generateNextApiTests.ts` to close this — a generator that
imports each route handler directly and calls it with a constructed `NextRequest`, no server
boot needed. Running this against the real app (not a fixture) also surfaced two further real
bugs in the mutation-check harness itself, both fixed: no baseline-pass check (a test that never
passes looked identical to a 100%-effective one) and a broken alias-resolution fix that worked
on a tiny fixture but failed on the real app's own `node_modules`.

**The real, verified result of the generator fix:** `mutationsChecked` went from 0 to 353 across
the 64 API routes. 32 landed as genuinely mutation-verified tests (20 visible, 12 held-out) —
real assertions that caught real injected bugs in a real, messy, integration-heavy app. The
other 32 were honestly downgraded: 14 weak (ran fine, killed nothing), 18 unrunnable (never
passed even unmutated — no live Postgres, missing Stripe/eBay/JWT env vars, infrastructure a
bare clone genuinely can't exercise). `untested-contracts.json` dropped from 55 files to 19, all
of them page routes outside this generator's scope — every API route now gets a real attempt,
though only half of those attempts are currently trustworthy.

### Part two: the fresh-agent handoff, and its result

With the generator producing real, mutation-verified tests, a fresh Sonnet session was handed
`apps/web-rebuild` — no access to the original repo, only `CLAUDE.md`, `.claude/`, `spec/`, and
the generated tests, same conditions as the Madeline handoffs. Real infrastructure was provided
as a **given**, not something the agent had to reverse-engineer: a real PostgreSQL test database
(via the app's own `docker-compose.yml`), migrated from the actual `prisma/schema.prisma`, plus
placeholder JWT secrets. Stripe/eBay/Pokemon-TCG credentials were deliberately **not** provided —
the line drawn here, worth stating as a general rule: anything the tool's own spec *should*
capture but doesn't yet (a database schema — a named, backlogged gap, same category as
asset-manifest extraction) is fair to fill in manually; anything the tool *could never* capture
(third-party API credentials) must stay genuinely absent. Four possible outcomes were defined
before the run, not three: clean success; a rails violation (batch-building, false-pass,
test-editing); honest-blocked (correctly and immediately attributing a failure to a missing
credential); and diagnosed-wrong-mechanism (senses something's wrong, burns iterations on an
incorrect specific cause, never lands on the real one — the exact pattern the weak-model
experiment below produced, named explicitly so a recurrence here couldn't get folded into a vague
"partial" result).

**The real result, independently verified — not trusted from the self-report:**
**tests/visible: 20/20 passing.** **tests/held-out: 0/12**, and every single failure is a pure
"never built" scope gap, confirmed by directly re-running both suites and reading the actual
error output: 6 routes with `Cannot find module` (never created at all — `health`, `pokedex`,
`slabs`, `users/check-username`, `users`, `scan`) and 6 with `X is not a function` (a sibling HTTP
method missing on a file it did build — e.g. `GET /api/orders` where only `POST` exists). Zero
logic bugs, zero credential-blocked failures, zero fabricated passes. **Classification: clean
success** — not partial, not diagnosed-wrong-mechanism.

**0/12 held-out passing is the correct outcome here, not a concerning one.** Those 6 unbuilt
routes are the "contracts without tests don't get built" finding from the Sonnet-vs-Haiku
comparison above, confirmed again at roughly 10x the route count: no visible test demanded them,
so strict TDD discipline correctly left them alone rather than batch-building ahead of the
queue. That's the methodology working as designed.

**This is the first *live* validation of the untested-contracts hook, not another simulation of
it.** Every prior confirmation of that hook (see "The fix," above) was a replay against files
Haiku had already written after the fact. Here, a fresh Sonnet session sat in front of 83 routes
and 19 untested page contracts — a far stronger temptation to batch-build than Madeline's 6 —
with the hook live and enforcing in real time, and never touched them (confirmed: zero `page.tsx`
files exist anywhere in the output). That's the hook doing its actual job under real pressure,
not passing a test written about it.

**The credential-blocked routes were engineered around, not diagnosed under duress.** Spot-checked
rather than assumed: `GET /api/wishlist` reproduces its contract's stub *verbatim*
(`return NextResponse.json([])`) — checked against `prisma/schema.prisma` directly and confirmed
there genuinely is no `Wishlist` model, so this is a correct, faithful reproduction, not a lazy
shortcut. `POST /api/orders` has real business logic (auth check, self-purchase prevention, fee
math) plus a genuine, correctly-reasoned comment: *"STRIPE_SECRET_KEY isn't configured in this
environment, so we record the order as PENDING without attempting to call Stripe, rather than
throwing."* That distinction — a correct engineering judgment under a real constraint, verified
by reading the reasoning, not just noting the code didn't crash — is what separates clean success
from diagnosed-wrong-mechanism-that-happened-to-look-fine.

**One real, secondary bug found and fixed, the same failure shape as the untested-contracts fix
itself:** the fresh agent changed `package.json`'s `test` script from the generator's actual
default (`vitest run`) to `vitest run tests/visible`. Verified this was a legitimate, necessary
fix, not a shortcut: running the generator's own default against the real output picks up **all
64 test files** (visible + held-out + weak all live under the same `tests/` tree vitest scans by
default) — confirmed by direct re-run. That mechanically undermines "do not touch tests/held-out/
until every visible test passes, run it once, at the end": the PostToolUse hook would show
held-out failures on every single edit instead of only signaling on the suite it's supposed to
gate — a rule stated in prose that the generator's own default silently violated. Fixed at the
source (`REBUILD_TEST_SCRIPT` now scoped to `tests/visible` with `--passWithNoTests`, verified
both that the bare form really does leak held-out tests and that the fix really does exclude
them, via a real vitest subprocess run, not a string check) rather than relying on every future
handoff to independently rediscover and patch it.

**Reconciliation on API-shaped ambiguity remains untested, not passed** — unchanged from before
the handoff. Zero signals were generated for this app (confirmed by `grep`, not a detector bug:
genuinely no `TODO`/`FIXME` comments, no client-side-gate pattern), so there was no ambiguity for
reconciliation to resolve, and the handoff itself doesn't exercise reconciliation at all. Whether
it behaves the same on an API validation rule or error-response shape as it did on a UI gate has
no answer yet either way — the one open question from this run that a differently-authored real
app (one that actually has comments/TODOs on ambiguous API behavior) would be needed to answer.

## Real page-test generation: the mechanism works and is verified; most pages it produces don't

The catchandtrade generalization run above left `untested-contracts.json` with 19 files, all of
them page routes outside any generator's scope, permanently blocked from being built. Real
Playwright-based capture, DOM-text-driven assertions, and screenshot-as-reference-only contracts
were built to close that gap (see the plan; new modules `generatePageTests.ts`,
`classifyDomText.ts`, `pageCaptureSchema.ts`, `assetManifestSchema.ts`,
`nextDevServerBoilerplate.ts`). **The honest headline from actually running it against the real
83-route, 19-page catchandtrade app is not "19/19 pages unblocked."** It's this: the generation
mechanism itself is real and verified end to end, but for this specific, auth-heavy app,
black-box capture with no logged-in session can't reach most pages' real, authenticated content —
so most of the resulting tests carry little to no behavioral signal, and a live-fetched-content
classifier gap turned out to be a bigger, more consequential problem than initially scoped. The
capability is real; what it's actually worth on this app is much more modest than "unblocked" by
itself suggests, and that's the finding worth remembering, not a footnote to it.

**The numbers, stated plainly:** of 19 pages, 13 landed in `weak` (a mutation site existed, ran,
killed nothing) and 1–2 in `unrunnable` (failed even the baseline pass against real, unmodified
source — see below on why this count itself isn't stable). 3 more (`legal-terms`, `legal-privacy`,
`scan`) had **zero applicable mutation sites at all** — not a passing grade, just nothing for the
3 mutators to touch, so they were never even at risk of being flagged weak. That leaves exactly
**one** page, `watchlist`, with a demonstrated, hand-traced, content-driven mutation kill — the
only page in this real app where the generated test is actually shown to catch a real behavioral
regression. **1 real, verified test out of 19 pages** is the number that matters more than
`untested-contracts.json` going to `[]`; the untested-contracts state describes what got built,
not what got verified. For calibration, not excuse: API routes in this same run hit a comparable
but smaller version of this problem (32 of 64, 50%, weak or unrunnable) — this isn't a new failure
mode this feature invented, but pages hit it at a distinctly higher rate (15 of 19, ~79%) than API
routes did, driven specifically by how much of this app's real content sits behind auth that a
fresh, unauthenticated Playwright session never gets past.

**A real bug found only by running against a real app, not by hand-tracing the same code
multiple times.** The first live smoke-test run crashed outright with `ENOTEMPTY` deleting a
mutation-check scratch directory — mid-run, after real work had already been done, not at
startup. Root cause, confirmed by reading `nextDevServerBoilerplate.ts`'s own spawn/kill code
against what actually happened: `next dev` spawns its own worker/compiler child processes that,
by default, inherit its process group; the generated test's own `afterAll` was only killing
`next dev`'s own pid, so those children kept running — and kept writing into the scratch
directory (`.next/cache/**`) — after the "test" had formally finished, racing the caller's
`rmSync` cleanup in `runMutationCheck.ts`. Fixed at the actual source: spawn `next dev` with
`detached: true` (POSIX) so it leads its own process group, and kill the whole group via
`process.kill(-pid, 'SIGKILL')` on cleanup instead of the single pid — symmetrical with the
Windows branch's pre-existing `/t` tree-kill, which had quietly been correct all along. Added a
second, defense-in-depth layer regardless: `removeScratchDirWithRetry` (short backoff, 5
attempts) around every scratch-dir cleanup in `runMutationCheck.ts`, so a transient race of this
shape can never again abort an entire, possibly many-minutes-long `generate_spec` call. Re-ran
the full suite (295/295 green) and the real smoke test twice more after the fix — zero crashes,
zero leaked scratch directories. This is exactly the category of bug a unit test cannot surface
(it requires a real `next dev` boot/kill lifecycle under real process-group semantics) and
hand-tracing the same generator code multiple times had already missed.

One unit test also failed on the first real run (`generatePageTests.spec.ts`'s dynamic-route-
segment test), but tracing it against the sibling generators' actual behavior
(`generateTests.ts`, `generateGateTests.ts` both deliberately keep the raw route pattern in the
describe title, substituting only in the real network call — confirmed by their own existing,
passing assertions) showed the implementation was already correct and consistent; the test's own
assertion was wrong. Fixed the test, not the code.

**The four semantic questions pinned down at design time (see the plan) — now answered with
real evidence:**

- **Mutation-kill meaningfulness for pages: confirmed real, but rare, and the "rare" is the
  finding.** The one kill — `PAGE-watchlist.page.spec.ts` / `flip-comparison` /
  `src/app/watchlist/page.tsx:24` (`typeof window !== 'undefined' ? localStorage.getItem(...) ||
  default : default`) — was traced by hand: flipping to `===` makes the *server-side* branch call
  `localStorage`, which doesn't exist in Node, crashing SSR and replacing the expected rendered
  content with an error page, which the generated content assertion correctly caught. Genuinely
  content-driven, not incidental — the higher bar this project's own doc comment says a page-test
  kill doesn't automatically clear. But 1-for-19 is the real rate, and the reason isn't subtle:
  this app gates most pages behind auth and a fresh Playwright session with no session captures
  the same generic login-page content regardless of the target page's own logic, so most pages'
  actual internal branching is never reached by what got captured or asserted on in the first
  place. The mechanism proved itself capable of a real kill when it can reach real logic; on this
  app, it mostly can't.
- **Weak/unrunnable tests still unblock their page — a real, surfaced tension, not a closed
  decision.** Confirmed by direct read of `writeSpecTree.ts` that this matches pre-existing
  behavior for API routes (`coveredRouteFiles` unblocks before `runMutationCheck` ever runs, for
  any route kind) — so this isn't a regression this feature introduced. But the untested-contracts
  hook exists specifically to withhold a rebuild agent's permission to write a file until a test
  demonstrably covers it, and here that permission is being granted to up to 15 of 19 pages (79%,
  worse than API routes' already-notable 50%) on the strength of a test the system's own mutation
  check just labeled as providing zero signal, or — for `PAGE-root` — a test that doesn't even
  reliably pass against the real, unmodified source it's supposed to be testing. That's a real
  erosion of what the hook's guarantee is actually worth in practice, at a scale now large enough
  to notice, not just a theoretical edge case. This is left open deliberately: **not fixed in this
  pass, flagged as a design question worth revisiting** (e.g. should a `weak` or `unrunnable` page
  test actually be strong enough to unblock a page, or should the hook require at least one real
  kill?) rather than filed away as settled just because it matches an existing precedent.
- **Dynamic-classification false negatives: confirmed, in both directions, and the second
  direction recurred on a second page.** `src/app/grading/page.tsx:12`'s
  `GRADE_VALUES = [10, 9.5, 9, ..., 1]` — a fixed grading-scale legend used as dropdown option
  values — got every value classified `dynamic (number)`, weakening an exact assertion of the
  scale into a loose shape-only match. The opposite, more consequential direction is why
  `PAGE-root` failed its *baseline* pass at all (not a timeout or infra gap — traced directly): the
  homepage's "Cards in Database" stat is live-fetched and read `"2,007"` at capture time versus
  `"0"` moments later on an unmutated re-run, because `NUMBER_PATTERN`
  (`/^-?\d+(\.\d+)?%?$/`) has no thousands-separator support, so a comma-formatted live number
  fell through to the default `static` classification and got an exact-text assertion instead of a
  shape check. **This recurred on a second real page, not just root**, discovered while
  double-checking this write-up rather than in the original run: `PAGE-marketplace` was classified
  `unrunnable` in the full run but `weak` in a later, narrower rerun of the identical app — the
  same test flipping pass/fail against genuinely unmutated source between two runs. Reading
  `src/app/marketplace/page.tsx:199` confirms why: `totalCards.toLocaleString()`, the identical
  live-fetched-count-with-commas pattern as root. Two real pages hit by the same classifier gap,
  one of them caught mid-write-up rather than in the original pass, is stronger evidence this is a
  systematic blind spot (comma-formatted live numbers specifically) rather than a one-off. The
  system's own pre-existing `passesBaseline` safety net did correctly catch and demote both
  instances rather than reporting a misleading kill rate — real confirmation that a defense built
  for a different reason also covers this — but a classifier gap that causes two pages' pass/fail
  status to be non-deterministic across identical runs of the same real app is a real problem, not
  a fully contained one.
- **Captured-vs-skipped visibility: not exercised live.** All 19 pages captured successfully in
  every real run (`skippedPages: []` every time), so the visible-skip mechanism remains verified
  only at the unit-test level — no real run has yet hit an actual partial-capture failure to
  confirm the end-to-end path.

**What this does and does not prove:** this is one real app, and it's a specifically unfavorable
one for this technique — heavily auth-gated, several live-fetched homepage/marketplace stats. It
does not show page-test generation is worthless (the mechanism is real, verified, and produced one
genuinely content-driven kill), and it does not show the classifier is unfit for purpose (a
hand-rolled handful of regexes was never claimed to be a general "is this dynamic" oracle, and the
design already flagged this exact risk as accepted, not solved). What it does show, concretely: on
an app shaped like this one, "pages unblocked" and "pages meaningfully tested" are very different
numbers (19 vs. 1), and the classifier's blind spot for comma-formatted live numbers is systematic
enough to have already caused non-deterministic results on two separate pages. Whether a
differently-shaped app (less auth-gating, fewer live homepage stats) would look meaningfully
better has no answer yet — that, plus reconsidering the weak/unrunnable-still-unblocks question
above, are the next real steps, not a restatement of this one.

295 tests passing, typecheck clean.

## Do reference screenshots actually help a rebuild agent's visual fidelity? Three runs, two confounds, two clean comparisons

Every real-app validation so far checked whether generated *tests* pass. None of them checked
whether a fresh rebuild agent, given the kickoff prompt plus contracts that reference screenshots,
actually produces something that *looks* like the original — the generated tests only assert DOM
text content, so a rebuild could pass every one of them while looking nothing like the source app.
This is a first attempt at answering that, run three times across two self-built apps and two
prompt conditions (the second and third subsections below), and it should be read as exactly the
size of evidence it is at each step — small, hand-built apps, n=1 per condition throughout.

**Run 1 setup, and the one methodological point worth stating precisely.** A small, 4-route
Next.js app (`novafolio` — 3 pages, 1 API route) was built for this run, then put through the real
pipeline
(`ingest_repo` → `generate_spec`, vision classification off — not what's being tested here). Before
handing the kickoff prompt to a fresh agent, the *original* source directory was physically moved
out of the filesystem tree entirely for the duration of the build, not just left in place with an
instruction to ignore it — the two directories would otherwise have sat as siblings, one `cp`/`cat`
away from a genuinely blind test becoming an accidental peek. Restored afterward for the visual
comparison.

**Result: 3/3 visible tests passed, 1/1 held-out passed, run once at the end as designed.** Worth
calling out on its own, a third distinct confirmation of this project's central rail
(`writeSpecTree.spec.ts`/Madeline/catchandtrade being the first two): the agent had the literal
captured values (`2026`, `10`) sitting directly in the test assertions it needed to satisfy, and
instead of hardcoding them, it built a small shared `lib/stats.ts` computing both from a fixed
anchor year (`CAREER_START_YEAR = 2016`) — the values are only correct today because the
computation is correct, not because they were copied from the fixture. "Build the general case,
not the literal one" held again, on a fresh app, first try, blind.

**The visual result: real, but with a precise and more useful shape than "not pixel-perfect."**
Comparing real screenshots of the rebuild against the original's captured reference screenshots:
color scheme (navy background, amber accent) and typographic conventions (uppercase tracked nav,
bold accent headings) came through correctly on every page — information that exists nowhere in
the text-only contract signature or the DOM-content assertions, so the reference screenshot is the
only place it could have come from. But layout structure did not transfer with the same fidelity:
the original's About page centers its content column (`max-w-3xl mx-auto`); the rebuild left-aligned
it. The original's Projects page uses a 2-column grid for 4 cards; the rebuild used 3-column
(3-then-1). Both misses are properties a screenshot shows as plainly as color does — arguably more
plainly, since grid arrangement is one of the most visually obvious things in the image — yet they
didn't transfer the way color and type did.

**That asymmetry, not "imperfect fidelity," is the actual finding worth carrying forward**, because
it points at two different possible fixes that would otherwise just be guessed between: if a
reference image genuinely conveys color/type more reliably than spatial/layout information to a
rebuild agent, the fix is encoding layout properties explicitly in the contract (something no amount
of "look at the screenshot harder" would solve); if instead the screenshot has the layout information
and it's just not being extracted or enforced, the fix is closer to a stricter visual-diff check.
This one run cannot distinguish between those — it only establishes that the asymmetry exists once.

**Two honesty caveats, stated as precisely as every other partial result in this document:**

- **Confound risk, not resolved by this run.** `novafolio`'s visual identity (navy/amber, uppercase
  nav, card grid) is a conventional, guessable aesthetic — the kind of thing a competent agent might
  land reasonably close to from "professional portfolio site" alone, screenshot or not. Because the
  app was designed and built *for* this test rather than found already existing, there was no
  independent check on how forgiving its look actually was before it went through the pipeline. This
  run cannot separate "the screenshot did real work" from "the aesthetic was easy to guess anyway" —
  a harder, more distinctive design (an unusual color, a non-default font, an image-based logo,
  a deliberately unconventional layout rhythm) is needed to know which one this was.
- **`mutationsChecked: 0` on this run — real, correctly explained, but scoped.** `novafolio`'s pages
  are almost pure static JSX with no comparisons, null checks, or loop bounds for the 3 mutators to
  touch, so nothing here exercises the mutation-check/test-strength machinery at all. This finding is
  evidence about the screenshot-reference question only, not additional evidence about mutation
  testing's reliability one way or the other.

**Sampling posture, named rather than left implicit:** this is n=1, and the app was self-built for
the test, a weaker posture than Madeline or catchandtrade, both of which were pre-existing, messy,
real apps found rather than constructed. "Screenshots help with color/type, miss on layout" is a
real, useful observation that motivates a hypothesis — it is not yet an established general result.
The next real step, before committing engineering to either candidate fix, is a second run against
a deliberately less-forgiving app, watching specifically for whether the same color-transfers/
layout-doesn't asymmetry reproduces — not building a fix for a pattern seen exactly once.

### Second run (`emberandrust`): a real confound, not a second data point — three findings survive it anyway

A second, deliberately harder app was built for exactly the reason the caveat above names: a
genuinely non-obvious palette (charcoal/rust/olive, not navy/amber), a distinctive serif-italic +
monospace font pairing, an actual small SVG logo mark, and two unconventional layouts (an
asymmetric split hero; a masonry-style staggered card grid) rather than the previous app's
centered hero and uniform grid. Same blind-handoff discipline (original relocated out of the
filesystem for the build, restored after).

**The honest problem, named immediately rather than after the fact: this run changed two variables
at once, not one.** The fresh agent's prompt this time explicitly said to use the reference
screenshots for visual styling; the first run's prompt did not (that agent found and used them
on its own initiative, from being told to read `spec/` in full). That means **this run cannot be
compared to the first one on layout fidelity at all** — any difference observed is uninterpretable,
because it could come from the harder app, the more explicit prompt, or plain agent variance, and
there is no way to separate the three from one run each. The correct framing is n=1 per prompt
condition, not n=2 pooled for the layout question. An earlier draft of this write-up described the
layout results across both runs as "2 of 3 vs. 0 of 2" — that framing is retracted here explicitly,
not silently fixed, because it reads as a trend and it is not one; it's two numbers from two
different, incomparable questions.

**What this run does establish cleanly, unaffected by that confound:**

1. **The build-the-general-case rail appeared to hold a fourth time** (`writeSpecTree.spec.ts` /
   Madeline / catchandtrade / `novafolio` being the first three). Blind build, all tests green on
   the first or second attempt per test, a real TypeScript-toolchain conflict diagnosed and fixed
   without ever touching the five dependency versions actually locked in `CLAUDE.md`. Flagged
   here as "appeared to" rather than confirmed: this specific claim rests on the agent's own
   self-report, was not independently re-checked against the actual source at the time, and the
   source no longer exists to check now (this rebuild directory was regenerated fresh before the
   third run below). The third run's equivalent claim *was* checked directly and did not hold —
   see that subsection for what that means for this one.
2. **A genuine, unplanned "in the wild" classifier confirmation.** The regex classifier misread
   hardcoded, fixed menu prices (`$18`, `$19`, `$17`, `$21`) as `dynamic (currency)` — the same
   static-misread-as-dynamic failure mode already documented for the `GRADE_VALUES` case above,
   now confirmed on the currency shape specifically, on an app that was not built with this failure
   mode in mind. This is the more convincing kind of confirmation precisely because it wasn't
   hunted for.
3. **The single most citable result of this run:** the rebuild reproduced the exact original prices
   (`$18`/`$19`/`$18`/`$17`/`$19`/`$21`) even though the generated test only required a loose
   currency-shaped match (`toMatch(/[$€£¥]\s?\d{1,3}.../)`, correct for any valid-looking price).
   The test would have passed with different numbers; the agent used the real ones anyway, and the
   reference screenshot is the only place those specific values exist outside the original source.
   This is clean, unconfounded evidence — it concerns content fidelity, not layout — that the
   screenshot-as-reference mechanism does real work beyond what the generated assertions enforce.

**The layout question itself is left explicitly open, not resolved in either direction.** Run 1's
sharp color-transfers/layout-doesn't asymmetry is not confirmed by this run and should now be
treated as an open hypothesis, not a settled pattern — this run's mixed layout results (some
distinctive layout choices reproduced, one clearly didn't) cannot support or refute it given the
prompt confound. The next real step is a third run, using run 1's exact prompt verbatim (no
explicit screenshot instruction) against this same harder app, to isolate the app-difficulty
variable cleanly against run 1. Even that comparison would still be n=1 vs. n=1 on hand-built
apps — real progress over "confounded," not a settled result — and no layout-fidelity fix should
be built before it, since right now any fix would be engineered against a pattern observed under
two different prompts on two different apps, which is closer to noise than signal.

**The clearest lesson from two runs may not be about layout at all.** Both attempts at measuring
visual fidelity have had a real methodological weak point — the first had no independent check on
how guessable its self-built app's conventional aesthetic was; the second changed the prompt
alongside the app. If visual-fidelity evaluation becomes a maintained axis rather than an
occasional spot check, it needs a fixed protocol decided *before* running, not adjusted per run:
identical prompt text across comparisons, consistently labeled/captured screenshots, and a
pre-declared rubric for what counts as a layout property versus a color/type property. So far the
measurement method has been the weak point in this line of investigation, not the tool.

### Third run (`emberandrust`, run 1's exact prompt): two clean comparisons fall out of three runs, and one already-written claim gets corrected

A pristine rebuild directory was regenerated for `emberandrust` and handed to a fresh agent using
run 1's exact prompt text, verbatim — no mention of screenshots, matching run 1's wording exactly.
With three runs now on the books (run 1: `novafolio`, no explicit screenshot instruction; run 2:
`emberandrust`, explicit instruction; run 3: `emberandrust`, no explicit instruction — same
wording as run 1), two genuinely clean, single-variable comparisons fall out, not just one:

- **Run 2 vs. run 3 isolates the prompt, holding the app constant.** With the explicit
  instruction, 2 of 4 distinctive layout properties on this app transferred (the asymmetric split
  hero, the staggered "what we stand for" cards) that did *not* transfer without it — run 3
  rendered a plain full-width hero with no decorative shape at all, and a flat 3-column grid with
  no vertical offset. The other two properties were unaffected by the prompt either way: the menu
  page's masonry/staggered grid failed to transfer in *both* runs (both rendered a uniform grid),
  and the visit page's asymmetric two-column split succeeded in *both*. So the explicit instruction
  measurably helped, but not universally — it moved some layout properties, not all of them,
  suggesting the answer isn't a blanket "screenshots convey layout" or "they don't," but something
  closer to "some layout patterns transfer with a nudge, some don't regardless, some transfer
  without needing one."
- **Run 1 vs. run 3 isolates the app, holding the prompt constant.** Under the identical
  no-explicit-instruction prompt, `novafolio` got 0 of 2 distinctive layout properties right and
  `emberandrust` got roughly 1 of 4 — a similarly low rate on both apps. This is evidence *against*
  the original hypothesis that `emberandrust`'s more deliberately-distinctive design would help
  layout transfer on its own: it didn't, when the prompt was held constant. Read together with the
  first comparison, the prompt looks like it was doing more of the observed difference between run
  1 and run 2 than the harder app was — though with n=1 per condition, this is still a
  clarification of which variable to suspect, not proof.

**A previously-written claim in this document needs correcting, caught by finally checking
directly rather than trusting a self-report a second time.** Run 3's agent reported hardcoding the
captured `2026`/`13` values as static constants in `src/lib/content.ts`, reasoning that they were
"plain site copy, not conditional logic gaming a fixture." Read directly: it did exactly that —
`ESTABLISHED_YEAR = 2026` and `YEARS_ROASTING = 13` are literal numbers, not a computation from an
anchor year the way run 1's `lib/stats.ts` and run 2's equivalent were. That will silently go
stale next year, which is a real, if narrower, instance of the same failure mode the
build-the-general-case rail exists to catch — the agent wasn't gaming a specific test assertion,
but the practical effect (a value that should be computed got frozen instead) is the one that
rail is meant to prevent. This document previously called runs 2 and 3 a "fourth and fifth
confirmation" of that rail holding. That claim is corrected here, not silently fixed: run 1's
confirmation was independently verified by reading its actual source; run 2's was taken from its
own self-report and never independently re-checked, and its source no longer exists to check now
(overwritten when this rebuild directory was regenerated fresh for run 3, before the need to
re-verify this specific point was recognized); run 3, checked directly, does not hold the rail the
same way. The accurate count is **one independently-verified confirmation (run 1), one
self-reported-and-now-unverifiable claim (run 2), and one independently-verified partial
counterexample (run 3)** — not three-for-three. Worth sitting with as its own lesson: the closer
this document looks, the more self-reported agent summaries need the same "verify, don't trust the
narration" treatment applied to everything else in it, not just to the tool's own output.

332 tests passing, typecheck clean (this investigation itself required no code changes).

## Weak-model diagnostic experiment: what Haiku actually did with a real, unscripted bug

The original Sonnet-vs-Haiku comparison (above) deliberately fixed both real environment bugs
*before* the Haiku run, to isolate convergence speed as a single variable. That left a real,
separate question genuinely open: can a weaker model diagnose an unscripted harness bug the way
Sonnet diagnosed the hydration race — or does it get stuck, or produce a workaround instead of a
diagnosis? This experiment answers it.

**Setup:** a fresh copy of Madeline was run through the current, fully-fixed pipeline, then one
deliberate reversion was applied to the generated gate tests — `baseUrl` changed back from
`` `http://localhost:${port}` `` to `` `http://127.0.0.1:${port}` `` (the real, original bug:
Next's dev server doesn't trust `127.0.0.1` as a dev origin, so hydration never completes),
**including removing the explanatory comment** that named the fix, so the agent got zero hints.
Pass/fail criteria were written down before running: success means the agent's investigation
correctly attributes the failure to the origin-trust mechanism and doesn't edit real app logic
chasing a phantom bug; failure means it edits real logic or gets stuck; partial means it works
around the symptom without understanding it.

**First run: confounded, not a real result.** Haiku reported 3/3 passing; independently verified
and genuinely true, but for the wrong reason — its own `package.json` pinned `"next": "^14.0.0"`,
which resolved to 14.2.35, a version that (confirmed directly) simply doesn't have the
`127.0.0.1` origin-trust restriction that the real app's 16.2.10 does. The bug never manifested;
there was nothing to diagnose. This is itself a real finding: nothing in `generate_spec`'s
contracts pinned an exact dependency version, so a rebuild agent could silently drift past the
exact bug an experiment (or a real rebuild) was trying to surface. Fixed
(`src/spec/pinDependencyVersions.ts`): the exact installed version from the original app's own
`node_modules` is now written into the generated `package.json`, locked the same way interface
contracts are.

**Second, controlled run — the real result:** with `next@16.2.10`/`react@19.2.7`/`react-dom@19.2.7`
pinned exactly and the agent told these versions are locked, a fresh Haiku session hit the real
bug. Verified independently: **1/3 visible tests passing**, the other 2 failing with the exact
original `127.0.0.1` timeout signature. Checked the actual code Haiku wrote, not just its
report: it edited real application navigation logic three separate times chasing the failure —
`window.location.href` → `.assign()` → `router.push()` — plus added a `setTimeout(..., 0)`
"small delay" to a redirect `useEffect`, explicitly framed as fixing a timing/race issue. None of
that could have worked; the real cause is a total hydration failure, not a race, so no amount of
client-side timing adjustment addresses it. It ultimately stopped and reported honestly rather
than fabricating success: *"client-side navigation is not working... this suggests the issue is
environmental rather than code-based... the Next.js dev server may be missing configuration."*

**Classification, against the criteria written down before the run:** by strict letter, this is
**failure** — real application code was edited multiple times attempting to fix what was
actually a harness-level bug, exactly the failure mode the criteria named. But it's a
meaningfully different failure than "stuck with nothing useful": Haiku landed on a substantively
correct *category* of explanation (environmental/dev-server, not app logic) without ever
pinpointing the specific mechanism, and reported accurate pass/fail counts and explicit
uncertainty rather than papering over the result.

**Contrast with Sonnet's earlier hydration-race diagnosis (a different harness bug, same app):**
Sonnet found a working, if non-idiomatic, fix — a raw `addEventListener` bypassing React's event
system — and "won," even though winning revealed the deeper test-harness-artifact problem.
Haiku sensed the right category here but never converged and never found any working
workaround. The real, useful signal for this build's core thesis: **a weaker model can sense
"this isn't my code's fault" without being able to act on that insight.** It gets partway
(correct categorization) and stops there — neither diagnosing precisely nor working around it,
which is a third, distinct outcome from either "diagnoses" or "produces a workaround."

## HTTP transport: adversarially tested, not just built

The optional HTTP transport (for connecting from oh-my-pi/opencode, local-only, no cloud
deployment) got the same standard applied to it as generated tests get via mutation checking:
tried to actually break it against a live running server, rather than trusting that auth and
path/URL allowlisting worked because the code looked right. Found and fixed 3 real bypasses,
not equally serious:

1. **Structural, not narrow.** `isPathAllowed` did textual containment only
   (`path.resolve`/`path.relative`), never resolving the filesystem's actual reality. A
   junction planted inside an allowed repo directory let `ingest_repo` read *and write* files
   completely outside the sandboxed root — confirmed live, over real HTTP, with real auth. The
   check was applied at the wrong layer entirely (string comparison instead of real-path
   resolution), not a missed case within an otherwise-sound mechanism. Fixed by resolving the
   deepest-existing-ancestor's real path before the containment check.
2. **Narrow, encoding-shaped.** `isPrivateOrLoopbackAddress`'s IPv6 branch never checked
   IPv4-mapped addresses (`::ffff:127.0.0.1`), which sailed straight through the SSRF guard. The
   private-range logic itself was sound; one address representation was simply missing.
3. **Narrow, enumeration-shaped.** `100.64.0.0/10` (CGNAT, real cloud-provider metadata ranges)
   wasn't in the blocked list at all.

Auth itself (no token / wrong token / correct token, across every tool call) checked out clean
against a live server — no gap found there. The one structural finding (#1) is the one worth
weighing most heavily: a textual check that never touches the real filesystem is a category of
bug that can recur anywhere else path input is trusted, not a one-off miss.

## Reconciliation wiring: closing the mechanism gap, not the real-world-messiness gap

Neither real validation run (Madeline, catchandtrade) ever contained a genuine comment-vs-code
disagreement — both apps had zero `TODO`/`FIXME` comments and no case where a real comment signal
conflicted with a real known bug. `classifyCase`'s logic for this — the known-bug-vs-intentional-
evidence conflict, arguably the single most important rule in the whole system ("a flagged bug
never silently loses to 'looks intentional' evidence") — already has full hand-fixture coverage:
~10 hand-authored `Signal` objects proving the logic itself is correct. What had never been
exercised is the wiring in front of that logic: does a real comment, scanned from a real file by
`extractCommentSignals`/`detectIntentionalComment`, and a real known bug, matched by
`matchKnownBug`'s actual token-overlap logic (not hand-picked hints), actually produce a `Signal`
shaped the way `classifyCase` expects, when a genuine disagreement exists?

**Built a synthetic (not hand-fixture) test to answer exactly that, and only that.** A real file
with a real comment (`// This function intentionally allows empty search queries...`) and a real
known bug (`"Search queries that are empty silently return all results instead of an error"`),
run through the actual tool handlers (`ingest_repo` → `flag_known_bug` → `buildCases`), no
hand-built `Signal` objects anywhere. Result: the case is genuinely `open` with a
`known_bug_vs_intentional_evidence` conflict, the comment signal was genuinely extracted (not
injected), and a control run (same file, no known bug flagged) confirms the same comment
auto-resolves cleanly on its own — isolating that the conflict comes from the known-bug match
specifically, not some other quirk of the fixture.

**What this does and does not prove, stated as precisely as the "0/12 held-out" result above:**
this closes the *mechanism* question — the wiring between real signal extraction and
`classifyCase` genuinely works, for at least one clean, deliberately-constructed conflict. It
says nothing about the *real-world-messiness* question: whether actual comments in the wild —
sarcastic, stale, hedged ("this might need fixing?"), or referring to a different line than the
one they sit above — trip up `detectIntentionalComment`'s pattern matching in ways no fixture
anticipated. Every other real finding in this build (the `src/app` layout miss, the
config-export-identifier pattern, the vanishing known bug, the test-script scoping bug) came from
real-world messiness, not a constructed case — there's no reason to expect comment-signal
extraction is uniquely immune to that pattern. Deliberately **not** chased further this round: a
third real app with actual, naturally-occurring comment signals remains the stronger validation,
backlogged and revisited opportunistically rather than manufactured on demand.

241 tests passing, typecheck clean.

## What's deliberately not done (named, not silently skipped)

- **Reconciliation on API-shaped ambiguity, untested.** catchandtrade produced zero signals
  (confirmed no `TODO`/`FIXME` comments, no client-side-gate pattern), so there was no ambiguity
  for reconciliation to resolve. Whether it behaves the same on an API validation rule or
  error-response shape as it did on a UI gate has no answer yet either way.
- **Real-world comment-signal messiness, untested.** The synthetic test above (see "Reconciliation
  wiring") proves the mechanism wires together correctly on one clean, deliberately-constructed
  conflict. It says nothing about whether real, naturally-occurring comments — sarcastic, stale,
  hedged, or misattributed to the wrong line — trip up `detectIntentionalComment`'s pattern
  matching in ways no fixture anticipated. A third real app with actual comment signals would
  answer this; none has been found or manufactured yet.
- **Asset-manifest extraction** (binary files copied verbatim + hash manifest, locked contract
  tier) — explicitly deferred to a future pass mid-build.
- **A 4th mutator** ("no-op the handler entirely") — the current 3 (flip comparison, drop null
  check, off-by-one) can't produce a "handler never ran" mutant, so a test that can't
  distinguish "correctly rejected" from "never executed" isn't flagged as weak. Caught in
  practice: the "incorrect value" gate test passed on the very first try in both handoffs for
  exactly this reason.
- **The contract-coverage caveat is not yet written into generated `CLAUDE.md`** as an explicit,
  stated limitation of the methodology.
- **Mutation-check scratch copies, Next 16/Turbopack: root cause found and fixed — 1 of 3
  changes made while chasing this, confirmed.** Attempting a second real app (a fresh clone of
  Madeline, chosen specifically to be far less auth-gated than catchandtrade, to test whether
  that changes the mutation-kill rate) hit this immediately: every one of 10 generated tests came
  back `unrunnable`. Direct reproduction (spawning `next dev` by hand inside a real scratch copy,
  not through the suppressed-stdio generated test) found the exact cause: `linkNodeModules`
  symlinks `node_modules/next` into the scratch copy, and Turbopack deliberately refuses to
  resolve its own package through a symlink pointing outside the scratch directory ("For security
  and performance reasons, files outside of the project directory will not be compiled") — so
  `next dev` never becomes ready, for every target, on every Next 16 + Turbopack app. **Fixed and
  confirmed**: `next` is now real-copied into the scratch copy instead of symlinked
  (`runMutationCheck.ts`'s `linkOrCopyEntry`/`COPIED_PACKAGES`); directly verified `next dev` then
  boots cleanly (real, on-disk `next/package.json`, no Turbopack error).
- **Orphaned `next-server` processes in the page-capture phase — 2 of 3, confirmed.** Found the
  same way, while investigating why a "clean" retry still showed leftover Next processes:
  `generatePageTests.ts`'s own capture-phase spawn had the identical missing-process-group-kill
  issue already fixed in `nextDevServerBoilerplate.ts` — confirmed by real orphaned `next-server`
  processes (one still holding ~1.8GB RAM) that survived a kill of just their direct pid. Now
  spawns detached and kills the whole process group, matching the boilerplate fix. Directly
  observed working (no more orphans across two subsequent clean runs).
- **`execFileSync`'s mutation-check timeout doesn't reliably fire — the most consequential finding
  of this thread, and it's a latent correctness gap, not a symptom of the other two.**
  `runVitestOnce` sets `timeout: VITEST_RUN_TIMEOUT_MS` (120s) specifically so one hung mutation
  check can't block the rest — that's the entire point of the constant's name. Direct evidence
  it doesn't work: an isolated reproduction of the exact same call ran for **~97 minutes**
  (5,838,547ms) before exiting **on its own** (`signal: null`, `status: 1`) — not killed by
  anything, just eventually finishing. This was on an unusually new Node runtime (v26.5.0,
  installed fresh mid-session via Homebrew); root cause not identified — plausibly a real quirk
  in that specific version's `execFileSync` timeout handling, not something diagnosed further
  this round. **3 of 3 — attempted, not confirmed**: added `killSignal: 'SIGKILL'` to the same
  call (SIGTERM, the default, is only a request a hung process can ignore; SIGKILL can't be).
  This is a real, defensible hardening against a known, general Node.js gotcha — but it is
  **not** confirmed to fix the 97-minute hang specifically: that reproduction already had
  `killSignal: 'SIGKILL'` set when it happened. The actual mechanism by which the timeout failed
  to fire remains unexplained.
  **The implication this puts on every prior timing number from this function, stated plainly
  rather than left implicit**: `VITEST_RUN_TIMEOUT_MS` was never a verified upper bound, only a
  requested one. The ~9.15-minute figure reported above for a full `generate_spec` run against
  catchandtrade (392 mutations checked, all via this same `runVitestOnce`) is what happened to
  occur in that run, not a value the timeout guaranteed — if any one of those 392 calls had hung
  the way this reproduction did, that number could have been unboundedly larger. This doesn't
  make the catchandtrade figure wrong as a historical fact, but it should be read as "wall-clock
  observed," not "capped by design," until the actual timeout-enforcement gap is understood.
  **The Madeline auth-gating comparison itself remains genuinely unanswered as a direct
  consequence** — not from a rebuild-dossier bug in the two confirmed fixes above, but because a
  full run on this machine takes anywhere from ~16 minutes to multiple hours, unpredictably, and
  chasing the real root cause further wasn't worth the wall-clock cost this round. Revisiting
  needs either a different environment (an LTS Node version) or actually diagnosing why
  `execFileSync`'s timeout doesn't fire, whichever comes first.

Resolved since the initial write-up, worth noting precisely rather than silently deleting the
history: near-duplicate case fragmentation (three gate variants with no cross-reference between
their cases) is fixed — `relatedCaseIds` now cross-references cases whose source file is a
content near-duplicate of another's, surfaced directly in `get_case_queue`'s elicitation
message. Weak-model diagnostic capability is no longer untested — see the section above for the
actual result, which is more nuanced than either "diagnoses" or "gets stuck." **A full fresh-agent
handoff on catchandtrade is also no longer open** — see "Generalization run" above: 20/20 visible,
0/12 held-out (all scope gaps, not bugs), classified as clean success against four pre-declared
outcomes, plus a live validation of the untested-contracts hook under real pressure and a real
generator bug (test-script scoping) found and fixed at the source. **`.gitignore` awareness in
`listSourceFiles.ts` is also fixed** — this gap was triggered independently twice in one session
via two genuinely different mechanisms (an OpenCode user's real monorepo, and a `node_modules`
rename made while investigating a separate question), which is stronger evidence for prioritizing
it than either incident alone. Added the `ignore` package (small, standard, used internally by
ESLint — a real .gitignore implementation is fiddly enough to get right that hand-rolling it
wasn't worth the risk of a subtly-wrong version).

**Known limitation, stated explicitly rather than left to surface later as a surprise:** only the
`.gitignore` at the exact path `ingest_repo` is pointed at gets read — not nested per-directory
`.gitignore` files, and not a monorepo's actual git root if `ingest_repo` is pointed at a nested
app (e.g. `apps/web`) inside it. Concretely: if a monorepo's root `.gitignore` excludes something
broadly (say, `**/*.local.ts`) but `apps/web` has no `.gitignore` of its own, that root-level rule
is never read when `ingest_repo` is pointed at `apps/web` directly — exactly the workflow the
`monorepoHint` fix (above) actively steers people toward. This is a real, known gap in the fix's
coverage for monorepos specifically, not a hypothetical.

**On whether either triggering incident is actually explained — now verified, not assumed:** the
`node_modules.bak` rename definitely wasn't itself gitignored (a `.bak` suffix doesn't match a
`node_modules` pattern regardless of implementation quality — a straightforward negative). The
OpenCode user's 4 duplicate directories were initially only checked via a `cat .gitignore` read
(weaker — misses nested `.gitignore` files, `.git/info/exclude`, and glob patterns that wouldn't
appear as a literal name match). Re-checked with git's own authoritative
`git check-ignore -v cardvault-fresh "cardvault/catchandtrade-master" scripts`: **empty output for
all of them.** None are gitignored — confirmed, not just reported. The 4x duplication is exactly
what it looked like: the same `generate-api-routes.js` scaffolding file committed 4 times across
directories that are all genuinely version-controlled. Real repo mess, not a `.gitignore` gap —
but it is not "just" a non-bug either.

**Third real-world confirmation that the near-duplicate-component detector (shipped in
`6e5a816`) actually works, not merely that it's still needed.** Four genuinely separate, tracked
files is exactly the shape that detector exists for, and it fired correctly, unprompted, on data
it had never seen before: `get_case_queue`'s output on the real OpenCode session showed all 4
cases with `relatedCaseIds` populated, each cross-referencing the other 3 —

```
"relatedCaseIds": [
  "case:component:cardvault/catchandtrade-master/scripts/generate-api-routes.js",
  "case:component:cardvault/scripts/generate-api-routes.js",
  "case:component:cardvault-fresh/scripts/generate-api-routes.js",
  "case:component:scripts/generate-api-routes.js"
]
```

This was checked directly against the real case-queue JSON (not inferred from OpenCode's own
summary, which didn't mention cross-references at all and read the 4 cases as independent).
Counting all three real runs it's been exercised on: the original Madeline 3-gate-variant case it
was built to fix, a direct unit-level check against Madeline data, and now this — a third,
independently-sourced real app. The tool still surfaced 4 separate cases (correct — these are 4
distinct files, not 1), but with the cross-reference a human resolving one immediately sees the
other 3 are almost certainly the same decision, rather than re-deriving that fact 3 more times.
The actual cause of the underlying duplication is a fact about that repo's own history, outside
this tool's scope to explain or fix — but whether the tool *handles* that mess well is now
answered, positively, a third time.

**The monorepo workflow gap is now fully closed, not just hinted at.** `monorepoHint` (above)
required a second manual `ingest_repo` call even once a user noticed it; `ingest_repo` now
accepts `interactive: true` and, when elicitation is supported, asks which candidate directory is
the real app and ingests it directly in the same call. Deliberately does not silently auto-pick
a single candidate: `EvidenceBundle` models exactly one app, so aggregating multiple workspaces
would be a real schema change, not a small extension, and would silently conflate decisions
across genuinely separate applications — a worse silent-resolution violation than picking the
wrong directory would be. Mirrors `get_case_queue`'s existing interactive/scripted-fallback split
rather than introducing a new pattern; declining, an unsupported client, or an answer that isn't
an exact match to a real candidate all fall back to the plain hint, unchanged.

**Second live OpenCode run, precisely scoped — confirms the scripted fallback and the
near-duplicate detector again, does NOT confirm the interactive elicitation feature.** The user
re-ran `ingest_repo` for real against their own `cardvault` repo (a fork/near-duplicate of
catchandtrade). Checked against the raw tool output, not the paraphrased summary:

- `ingest_repo` pointed at the monorepo root returned `routes: 0` with
  `monorepoHint.candidates: ["apps/web"]` exactly as designed — a genuine live confirmation of the
  scripted fallback path through a third real MCP client (OpenCode), not just the automated
  Client/Server test harness.
- `interactive: true` was never passed on either call, so `elicitMonorepoChoice` never ran.
  **The interactive elicitation feature itself remains unverified against any live client** —
  it's only been confirmed via the automated MCP Client/Server harness test, not a real
  human-in-the-loop prompt/response round trip. Worth running explicitly with `interactive: true`
  before calling that feature live-verified, not just unit-tested.
- The near-duplicate detector fired a 4th time, on a different shape than the earlier 4-file case
  (2 files this time: `scripts/generate-api-routes.js` at the repo root and the same file inside a
  nested `catchandtrade-master/` copy). Checked bidirectionally in the raw `get_case_queue` output:
  each case's `relatedCaseIds` names the other. Running total: Madeline's original 3-gate-variant
  case, a direct unit-level check against Madeline data, the earlier 4-file OpenCode case, and now
  this 2-file case — 4-for-4 across three independently-sourced repos and two different
  duplicate-count shapes.
- The repo's case count (2 open cases here, vs. 4 in the earlier OpenCode session) is not a
  regression — checked directly against the saved evidence: this particular clone genuinely only
  contains one nested duplicate directory (`catchandtrade-master/`), not several sibling
  directories. Real repo-state drift between sessions, not a tool discrepancy.

**Third live OpenCode run — a real fresh-agent handoff against the generated `cardvault-rebuild`
workspace found a genuine, previously-unknown bug: `generate_spec` has no equivalent of
`ingest_repo`'s own monorepo guard.** The user pasted the standard kickoff prompt into a fresh
OpenCode session pointed at `cardvault-rebuild`. It reported: 0 tests, 0 contracts, no
`spec/contracts/` directory at all, and concluded "the rebuild spec is satisfied as-is... there
was no code to rebuild" — a conclusion that, taken at face value, would have looked like a clean
success (0 failures) while actually meaning nothing was ever generated. Checked directly rather
than accepted:

- The generated `CLAUDE.md` read `# Project: temp (rebuild)`. `temp` is the `name` field in the
  monorepo **root**'s own `package.json` (confirmed: `apps/web/package.json`'s name is
  `@catchandtrade/web`, and its own separately-saved evidence has `routes: 83`; the root's
  separately-saved evidence has `routes: 0`).
- Root cause: `ingest_repo` had correctly been run twice earlier in the session (root → 0 routes
  + `monorepoHint`, then re-pointed at `apps/web` → 83 routes, exactly as designed), but
  `generate_spec` was then called against the monorepo **root** path, not `apps/web`. Read
  `src/tools/generateSpec.ts` directly: it checks for open cases and missing evidence, but had
  **zero check for `evidence.routes.length === 0`** — it silently wrote a syntactically valid but
  completely empty spec tree instead of refusing, one pipeline stage past the exact shape
  `ingest_repo`'s `monorepoHint` exists to catch.

**Fixed the same session this was found, following this project's own "surface ambiguity, don't
silently resolve it" principle one stage further downstream:** `generate_spec` now checks
`evidence.routes.length === 0` and, if the repo path also looks monorepo-shaped (via the same
`findCandidateAppDirs` `ingest_repo` already uses), refuses with `isError: true` and a message
naming the real candidate directories, instead of proceeding. A genuinely route-less, non-monorepo
repo (e.g. a pure component library) is unaffected — the guard only fires when both conditions
hold, mirroring `ingest_repo`'s own precise trigger condition rather than blocking on 0 routes
alone. TDD: 2 new tests written first (confirmed red against the unfixed code — the monorepo-root
case failed with `isError: undefined`; the non-monorepo 0-route case already passed, confirming
the guard doesn't over-fire), then implemented. Verified live against the exact real
`D:\Card Idea\cardvault` root that triggered this: now returns
`"Cannot generate spec: 0 routes were ingested for D:/Card Idea/cardvault — this looks like a
monorepo root, not the app itself. Re-run ingest_repo and generate_spec pointed at one of these
candidates instead: apps/web"` instead of silently succeeding. 262 tests passing, typecheck clean.

This is the third real bug this exact OpenCode/monorepo thread has surfaced (after the
`.gitignore` non-issue and the confirmed-working near-duplicate detector) — worth naming plainly
as a distinct finding, not folded into either of the other two: **a tool having a correct guard at
one pipeline stage doesn't mean every downstream stage inherits it.** The fix pattern (redirect to
real candidates rather than silently proceed) is proven at this point — this is its second
independent application, not a new design decision.

**Fourth finding, this one the most consequential of the whole thread: `generate_spec`'s own
output had no way to distinguish "generation completed with nothing to build" from "generation
died partway through" — and a fresh agent hit exactly that ambiguity.** A real client-side MCP
timeout (`-32001`, twice) fired while the server-side `generate_spec` call for this same
83-route app was still genuinely running — `runMutationCheck` alone can take several minutes for
a real app (this session's own earlier manual run also exceeded a 300s timeout and had to finish
in the background). The client gave up and reported an empty `tests/` directory to the fresh
agent as if it were a real, final result. **The agent had no way to tell the difference, and
neither would a human glancing at the same directory:** `CLAUDE.md`, `package.json`, and all 83
`spec/contracts/*.md` files exist either way (they're written *before* the slow mutation check
starts); `spec/test-dependencies.json` and the real test files only exist *after* it completes.
Facing what looked like a legitimate 0-test app, the agent did something locally reasonable —
write a test, satisfy it — that is globally the exact failure this tool's entire architecture
exists to prevent: a self-authored, self-graded test wearing the visual signature of a real,
mutation-verified one.

Confirmed by direct forensics, not inference: the lone `tests/visible/GET-api-health.spec.ts`
present right after the timeout was timestamped `11:02:49`, matching when the agent wrote it —
every genuinely tool-generated file that appeared once the background process actually finished
is timestamped `11:13:28`, ten minutes later. `spec/test-dependencies.json` correctly places the
*real* `GET-api-health` test in `tests/held-out/`, proving the fake file in `tests/visible/` was
never touched or overwritten by the real generation — it simply didn't collide.

**Fixed as the load-bearing gap it is, not a nice-to-have:** `writeSpecTree` now builds the entire
output tree in a hidden sibling temp directory and only `renameSync`s it into the real `outputDir`
once every write — including the mutation check — has fully succeeded, the same write-temp-then-
rename discipline `atomicWriteFile.ts` already used for single files. `outputDir` now either
doesn't exist at all (still running, or died) or exists complete; the ambiguous middle state is
gone. TDD: forced a genuine mid-write failure (not a mock) by pointing a route at a nonexistent
file, which makes `generateContracts` throw a real `ENOENT` partway through — confirmed red
(`outputDir` existed partially) against the unfixed code, then green after the fix, with no
temp-dir litter left behind either. 263 tests passing, typecheck clean.

**A second, separate discovery surfaced while diagnosing this, and it's worth stating precisely
rather than folding it into the same bug:** the MCP server OpenCode was actually calling all
session was `D:\rebuild-dossier`, checked out at `a81c448` — three feature commits and several
docs commits behind this repository's own `HEAD` at the time. Every "confirmed live via OpenCode"
claim this session was audited against the real commit ancestry (`git merge-base
--is-ancestor <fix-commit> a81c448`), not assumed clean by association with the two claims that
*were* affected:

- Near-duplicate detector (both the 4-file and 2-file confirmations): `6e5a816` **is** an ancestor
  of `a81c448` — genuinely present on the code that ran. Both stand as valid.
- `.gitignore` non-issue (`git check-ignore -v`): runs git's own logic against the repo directly,
  untouched by which rebuild-dossier commit is checked out. Valid regardless.
- Monorepo scripted `monorepoHint` fallback: depends on `a81c448` itself, the exact commit checked
  out. Valid.
- `node_modules` missing-dependency warning: verified directly against the real repo in this
  session's own environment, never via a live OpenCode re-test. Unaffected by the other
  checkout's version.
- Interactive elicitation (already caveated as untested) and this exact `generate_spec`
  monorepo-root bug (already attributed to drift) are the two claims genuinely affected — both
  were already framed correctly before this audit ran.

Net result: nothing else in this document needed correcting. `D:\rebuild-dossier` has since been
fast-forwarded to current `HEAD` and had `npm install` re-run; the live server process there is
long-lived (loaded the old code at launch) and needs restarting before a next call actually runs
the fixed code — a mechanical, non-negotiable step before treating any future run through it as
evidence about current code, the same discipline as pinning exact dependency versions before
comparing two model tiers.

**The recurring pattern worth naming across all four findings in this thread:** self-reports from
an external client — even an honest one, not hallucinating or misbehaving — need the same
skepticism applied to results from the model itself. The unreliable narrator wasn't Haiku or
Sonnet here; it was a stale binary and a timeout race, and the fix in both cases was the same
discipline: check the actual filesystem state and the actual commit ancestry, don't trust the
client's own account of what happened.

## Bottom line

The core loop (ingest → reconcile → spec → generate → test → verify) works, on a real messy
app, well enough to produce a locked spec that two different model tiers both built against
successfully — with the actual failure points being precise, reproducible, and in most cases
already fixed rather than papered over. That result now holds on a second, structurally
different, harder real app too: a fresh Sonnet session converged cleanly (20/20 achievable
visible tests) against a real Prisma+Postgres+Stripe+eBay app it had never seen, respected every
mechanically-enforced rail under genuine temptation to violate it (83 routes, 19 untested page
contracts, real pressure to batch-build), engineered around real infrastructure gaps rather than
faking through them, and found a real bug in the generator's own tooling along the way. Combined
with a precisely-characterized weak-model failure boundary — correct categorization without
convergence, a third, distinct outcome that neither "diagnoses" nor "produces a workaround"
predicted — and a security-hardening pass that was adversarially verified live rather than
simulated, this is a materially stronger evidence base than the single-app validation this
document originally reported: two model tiers, two structurally different app shapes, a named
and reproduced failure boundary, and a rails-hardening fix validated under real pressure rather
than replayed against already-written files. Real page-test generation is now built against that
same 19-untested-page gap, and the same discipline paid off again in a way that cuts against the
feature rather than for it: a real smoke test found a crash bug (a `next dev` process-group leak)
that hand-tracing the same generator code had already missed, and — more importantly — showed
that on this specific, auth-heavy real app, "19 pages unblocked" and "19 pages meaningfully
tested" are very different claims. Only 1 of 19 pages has a demonstrated, content-driven mutation
kill; the rest are weak, unrunnable, or never reached by the mutation engine at all, mostly
because black-box capture with no session can't get past this app's auth gates. Two concrete,
opposite-direction DOM-text-classification false negatives turned up along the way — a fixed
grading-scale legend read as dynamic, and a live-fetched, comma-formatted stat read as static, the
latter recurring non-deterministically on a second page — and one real design tension surfaced
deliberately unresolved: weak/unrunnable page tests unblock a page's write-permission the same way
weak API-route tests already do, at a notably higher rate (79% vs. 50% in this run), which is a
real erosion of the untested-contracts hook's guarantee worth reconsidering, not a settled
decision just because it matches existing behavior. Three looks at whether the reference
screenshots those contracts carry actually improve a rebuild agent's *visual* fidelity — not just
its test-passing — produced two clean, single-variable comparisons once a third, prompt-matched
run was added: holding the app constant, explicitly telling the agent to use the screenshot for
styling measurably improved some (not all) distinctive layout properties; holding the prompt
constant, a more deliberately distinctive app design did not improve layout transfer on its own —
the prompt looks like it was doing more of the earlier difference than the app was. A real,
unplanned classifier confirmation also turned up (fixed menu prices misread as
`dynamic (currency)`), and the cleanest result of the three runs held regardless of which prompt
was used: a rebuild reproducing exact original prices its own test would have accepted any valid
value for. One of this document's own earlier claims got corrected in the process, not quietly
fixed — a "fourth and fifth confirmation" of the build-the-general-case rail, checked directly
instead of trusted from a self-report, turned out to be one verified confirmation, one now-
unverifiable claim, and one verified partial counterexample. The color-vs-layout question itself
remains genuinely open: some layout patterns transferred regardless of prompt, one specific
pattern (a masonry/staggered grid) failed regardless of prompt, and at least two properties were
prompt-sensitive — a real, more specific picture than either "screenshots convey layout" or
"they don't," but still n=1 per condition on hand-built apps, not a settled result. Real work
remains (reconciliation on API-shaped ambiguity is still genuinely untested; video ingestion, live
Chrome capture, asset-manifest extraction, a 4th mutator, and original-CLAUDE.md-as-evidence are
all correctly still backlogged; the weak/unrunnable-unblocks-a-page tension, a second less
auth-gated real app for page-generation, and — if visual fidelity becomes a maintained evaluation
axis rather than occasional spot checks — a fixed protocol decided before running, not adjusted
per run, are the natural next steps) — but the core hypothesis itself is no longer resting on one
validated example.
