# rebuild-dossier v0: findings

**Status:** v0 built (6 MCP tools, 504 unit tests), validated end-to-end against **two real,
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

**Two results from the most recent stretch of work belong at the top, not buried in the section
that produced them.** First: a contract-locking ablation trial produced a direct, concrete
demonstration of this project's own Goodhart concern — a rep that *violated* one-at-a-time build
discipline ended up fully green on held-out tests, while the rep that stayed *disciplined* ended
up failing, because naive pass-rate rewarded the batch-builder for incidentally covering a page
ahead of schedule. See "The weak-model question, answered on Claude Code's own hooks instead of
OpenCode's," below. Second: an Agent-tool sub-agent's tool calls were confirmed, empirically, to
never consult a target directory's own `.claude/settings.json` — only this session's own root or
global settings apply, regardless of where a sub-agent is actually working. This is a
previously-unknown fact about Claude Code itself, and it puts at least one earlier claim in this
document at genuine, unresolved risk (see the same section) — any claim here that a generated
hook "enforced" something for a fresh agent needs this caveat unless that agent ran as a truly
separate top-level session.

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

A fourth test app, `fieldnotes` — the first with a real, persistent `better-sqlite3` backend
rather than a static JSON stat endpoint — surfaced two real generator bugs no prior app had
exercised (`generateNextApiTests.ts` never sent a request body for any HTTP method, always
crashing a `POST`/`PUT`/`PATCH` handler that calls `request.json()`; the mutation-check's scratch
copy never set its vitest subprocess's `cwd`, so a target app's own relative-path side effects
leaked into `rebuild-dossier`'s own directory instead of staying contained), both fixed and
re-verified against the real app. A blind rebuild of that app then answered the actual question
this backend-having app was built to test: does a blind rebuild reproduce *functional* behavior,
not just appearance? Answer, confirmed by running identical real HTTP requests against both apps
side by side: visual and HTTP-status-code-level API parity are both achievable blind (every
route's status codes matched exactly), but **response/request body schema parity is not** — the
rebuild independently invented a different, internally-consistent field name (`note` vs. the
original's `message`) and a different timestamp format, because the generated API contract
records only the route handler's outer signature, never the JSON body shape, since the generated
tests assert status codes only. See "Blind rebuild of a real backend," below.

A fifth test app, `driftlight`, was built specifically to test animated content — a fresh clone of
the actual pushed GitHub repo was confirmed to build and pass all 334 tests standalone first, then
`driftlight`'s pipeline run showed the screenshot and DOM-text captures from a single
`generate_spec` call disagreeing with each other over an animated stat counter's value (`"0"` vs.
`"104+"`, neither the true settled `"12,400+"`), and a staggered card-entrance animation leaving
half the reference screenshot's product grid invisible. A blind rebuild by Haiku (not Sonnet,
specifically to test whether this pipeline's strict rails let a weaker model succeed without its
own judgment) converged cleanly on every test — but hardcoded the screenshot's own mid-animation
artifact (`"104+"`) as permanent static content, reproduced zero of the three real animations
(nothing in the spec encodes motion at all), and got the three screenshot-invisible product cards'
colors wrong while getting the three visible ones close — confirming that model capability only
matters for what the harness actually checks, and motion is currently a complete, unaddressed
blind spot regardless of which model does the rebuild. See "Animated content," below.

The request-body-shape half of the `note`-vs-`message` gap is now closed:
`inferRequestBodyFields.ts` statically extracts a route's real request-body field names and feeds
them into both the generated contract doc and a realistic (no longer empty-`{}`) placeholder body
in generated smoke tests, for both the Next.js and Express generators — the Express generator's
identical missing-body crash bug got fixed in the same pass. Two separate disciplines each caught
a real design flaw before it shipped: tracing the regex design directly against the real app's
actual source (not toy examples) found the first three patterns matched **nothing** on it, since
its idiomatic strict-TypeScript body access never puts `body` immediately before a `.`; and
building a live Express fixture to verify the fix found a second, related miss on `req.body` cast
directly (no intermediate variable). Both fixed, re-traced, and verified live end-to-end in both
frameworks — not just via unit tests — confirming the generated placeholder body now drives the
real handler to an actual `201`, not a `400` from an always-empty body. See "Closing the
request-body-shape gap," below.

The response-body half is now closed too: `inferResponseBodyFields.ts` extracts field names from a
route handler's own literal response construction, surfaced as a second contract-doc section —
closing the part of the gap request-side inference couldn't reach (GET routes with no request
body to lean on; server-generated fields like `id`/`created_at` that only ever appear in the
response). This time the consequential scope decision — response construction is very often
delegated to a separate function, exactly as the real motivating app does, and resolving that
requires following an import into another file — was surfaced and confirmed with the user *before*
writing any code, and the honest `[]` result for that case was traced against the real shape before
finalizing the design, then confirmed live against a fixture built specifically to prove it: one
route with an inline response gets its fields extracted, a sibling route delegating to an imported
helper function correctly gets no section at all. See "Closing the response-body-shape gap,"
below.

The value-format half of that same gap is now closed too — a field name alone never explained the
original finding's real divergence (`new Date().toISOString()` vs. SQLite's `datetime('now')`).
`inferResponseValueFormatHints` traces each field back to a real, traceable value-producing
expression (inline, or via a same-function local declaration — the more common
compute-once-use-via-shorthand style, matching the real `createNote()`'s own shape) and shows it
verbatim in the contract doc. Every edge case was traced against concrete examples before a line
was written; writing the tests then caught a real assumption error before it shipped — three tests
expected request-body passthrough fields to get no hint, all three failed, and the failure was
right: showing that a field is an untransformed passthrough is real signal too, not noise, so the
tests were fixed to match the verified-correct behavior. Confirmed live against a fresh fixture
reproducing the exact same-file pattern. See "Response value-format hints," below.

Every fix above had only ever been verified by checking the pipeline's *output* directly — never
by confirming a fresh, genuinely blind rebuild agent actually changes its behavior because of it,
which is the real evidence the original `note`-vs-`message` finding rested on. That gap is now
closed: a new app (`notarybox`), built with a same-file backend so every fix fully applies, was
put through a real blind rebuild (source relocated, fresh Haiku agent, zero access). Read directly
from the rebuild's restored source, not its self-report: `name`, `message`, and
`created_at: new Date().toISOString()` — the exact field names and expression the enriched
contract documented, confirmed a second way by running an identical `POST` against both apps side
by side and getting field-name- and format-identical JSON back. The fixes demonstrably changed
what a blind agent built, not just what the contract said. Two real divergences the same
experiment surfaced, neither addressed by anything shipped: a status-code miss (`200` vs. the
original's `201`, with no reconciliation signal to have caught it), and a missing validation rule
entirely (the rebuild accepts an incomplete request the original correctly rejects with `400`) —
the second one reconfirms an already-named limitation (generated tests only check crash-safety,
not business rules) with a fresh, concrete example, not a new discovery. See "Closing the evidence
gap," below.

Both `driftlight` bugs above are now fixed: captures neutralize animations/transitions and add a
bounded settle wait (baked into the generated test template too, not just the original capture) so
the screenshot and DOM-text no longer disagree, and a new contract-doc section documents declared
`@keyframes`/transitions — live-tested against the exact reproduced shapes, which caught and fixed
a second real bug (a shared, root-layout-level stylesheet made every page report identical
animations regardless of use, fixed by scoping detection to elements actually present on that
page). Watching a fresh blind rebuild run side by side with the original then surfaced a further
gap: the rebuild reproduced the `glow-pulse` keyframe *name* correctly but wired it to
`.button:hover` instead of the original's always-on application — the documentation recorded
animation names and selectors, but nothing about *when* they fire. Now closed, deterministically,
by labeling each usage's trigger condition — and closing it surfaced a more consequential bug than
the labeling gap itself: the existing live-element check queried selectors *with* their
pseudo-class attached, so every state-gated rule (exactly the `.button:hover` shape the rebuild
produced) was invisible to detection entirely, not merely unlabeled. Both fixed, both traced
against realistic selectors before shipping (which caught a real regex-alternation-ordering bug on
`.input:focus-within`), and confirmed live against a fresh fixture built to stress both at once.
See "Settling animations before capture," below.

The missing-validation gap the `notarybox` experiment named — the original app rejects a `POST`
missing a required field with `400`; the blind rebuild had no such check at all — is now partially
closed: `inferRequestValidationRules.ts` detects the exact real-world guard shape that motivated
this (`if (!name || !message) { return ...4xx...; }`), cross-referenced against
`inferRequestBodyFields`'s own known-field set so an unrelated check (an authorization guard, say)
can't be misreported as a body-field requirement. Ten realistic guard shapes were traced against a
throwaway script before any real code was written, including one that proved paren-balancing is
genuinely required, not optional: a naive character-class regex would have truncated a condition
containing a nested call (`!message.trim()`) mid-expression. `&&`-joined conditions, `typeof`/length
checks, and brace-less one-liners are all explicitly excluded as deferred, not silently
mishandled. Merged additively into the existing request-fields contract section as a
"required (checked via: ...)" clause per field, confirmed live against a fresh fixture run through
the real `ingest_repo` → `generate_spec` pipeline, not just unit tests. See "Closing part of the
missing-validation gap," below.

The single most-repeated limitation in this document is now closed too: a route whose response is
built by calling an imported function (`NextResponse.json(createNote(name, message))`, delegating
to a `lib/db.ts` data layer — the real motivating app's own shape, deferred twice already as "a
materially bigger, riskier increment than same-file extraction") got no response-fields section at
all. `resolveDelegatedResponseFields.ts` follows one level of same-repo relative import — resolving
named and aliased imports, isolating the callee's own function body, and unioning fields across its
return sites, the same accepted risk as the same-file extractor — deliberately scoped to the
response side only, since the real motivating app's request fields and validation guard are both
already same-file. Bare package imports and tsconfig path aliases (`@/lib/db`) are left alone, not
guessed at. **Live pipeline verification caught a real gap the design and unit tests had both
missed:** the fixture's callee built its response in a local variable, did a side effect, then
returned the variable (`const note = {...}; notes.push(note); return note;`) — a real, common
pattern neither the traced design nor its unit tests had covered, since every earlier trace used a
direct `return {...}`. Fixed by tracing a bare `return someVar;` back to its local declaration one
level deep, the same aliasing discipline `formatHintForExpression` already uses for individual
field values, now applied to the whole return statement — re-verified live afterward, not just
patched and assumed correct. See "Resolving cross-file delegated response construction," below.

Stage 1 of a four-stage roadmap against the remaining v0 ceilings is done: `inferSuccessStatusCode.ts`
closes the status-code gap the `notarybox` experiment surfaced (a rebuild silently defaulting to
`200` against an original `201` passed the only generated assertion, `res.status < 500`). It
identifies a handler's confident success-path status — the one unconditional, non-guarded response
in the source — and bails to no signal at all on any ambiguity, the same discipline as every other
extractor. Documented in the contract doc unconditionally; wired as a strict
`expect(res.status).toBe(n)` assertion in both generators only for body-carrying routes with no
dynamic path segment. **Live verification, not the design or unit tests, caught why that narrower
gate is required:** a real fixture's `GET /api/users/:id` route correctly has `200` as its
unconditional success status in the source, but the generated smoke test's placeholder path segment
(`'test-value-123'`) doesn't match a real record, so the request legitimately hits the `404`
"not found" branch instead — asserting the code's own success status there would have failed a
genuinely correct server. **The same live run also caught a real, pre-existing bug well outside
this stage's own scope:** `isolateHandlerSource.ts`, shared by every extractor built this session,
silently isolated just `{ params }` — not the real handler body — for any Next.js handler
destructuring its second parameter inline (`function GET(request, { params })`, a standard App
Router idiom for dynamic routes), since the naive "first `{` after the handler name's own `(`"
search finds the destructuring parameter's own brace first. This had been silently degrading
field-name, format, validation-rule, and cross-file extraction for every dynamic route since the
very first extractor shipped this session — no earlier fixture had combined a dynamic path segment
with real source reading until this one did. Fixed at the root, with dedicated regression tests, not
worked around locally. See "Capturing the success-status signal," below.

Stage 2 of the same roadmap broadens validation-guard detection beyond the one shape it covered:
`inferRequestValidationRules.ts` now also recognizes `typeof x !== 'string'` (type-checking) and an
explicit `x.length === 0` / `x.length < 1` non-empty check, alongside the existing bare-negation
guard — each rendering its own contract-doc wording ("must be a `string`" / "must be non-empty" vs.
"required") rather than forcing every shape into the same label. A positive `typeof x === 'string'`
guard is deliberately not recognized, since as a *rejection* condition that's inverted, unusual
logic ("reject if it IS a string"), not the natural "reject if it's NOT the expected type" idiom;
Zod/schema-based validation remains a separate, structurally different, still-unmotivated future
stage, not folded in just because it was named in the same breath as the other gaps. The extractor's
return type changed from a plain string to a small `{ expression, kind, expectedType? }` record — a
contained, internal-only change (one real consumer) made to avoid re-parsing the same expression a
second time in the renderer, with both the consumer and all existing tests updated in the same
pass. Ten branch shapes were traced via a throwaway script before any real code was written,
including the exact combined shape this stage exists for
(`if (!name || typeof message !== 'string') {...}`), then confirmed live against a fresh fixture
combining all three guard kinds in one condition, rendering all three clauses correctly and
additively alongside the stage-1 success-status line. See "Broadening validation-guard detection,"
below.

Stage 3 closes the most common of the three remaining cross-file gaps: `resolveDelegatedResponseFields.ts`
previously bailed on any non-relative import specifier, including a tsconfig path alias
(`@/lib/db`) — a near-universal Next.js convention, the default in every `create-next-app` scaffold,
and materially more likely to be hit in a real target app than the other two deferred gaps
(2+-hop delegation, cross-file request-field/validation resolution), neither of which has a
confirmed real example anywhere in this project's own experiments. It now reads and parses the
repo's `tsconfig.json`, matches a specifier against `compilerOptions.paths`' wildcard or exact
patterns, and resolves each candidate target relative to `baseUrl` — falling through cleanly (never
a crash) for a missing or malformed config, an unmatched alias, or a genuine bare-package import,
exactly as before this stage. Ten realistic tsconfig/specifier combinations were traced against a
throwaway script using real temp directories and `existsSync` before any real code was written,
including a malformed, comment-containing tsconfig.json (real-world JSONC, correctly falling
through rather than throwing) and multiple candidate targets for one alias where only the second
actually resolves. Confirmed live against a fresh fixture with a real `tsconfig.json`: a route
importing `createNote` via `@/lib/db` now resolves fields, the format hint, and the cross-file note
exactly as the existing relative-import case already did, while a sibling route's unrelated
bare-package import still correctly renders no response-fields section at all. 2+-hop delegation
and cross-file request-field/validation resolution remain deliberately deferred — still no
confirmed real motivating case, the same evidence-driven bar every other deferred item in this
document has been held to. See "Resolving tsconfig path aliases," below.

Stage 4, the last of the four-stage roadmap, was supposed to be a diagnosis-only pass: re-examine
the real, page-heavy `catchandtrade` app's weak/unrunnable pages one by one and classify the actual
cause, since the only evidence behind the earlier "mostly auth-gated" claim was an aggregate number,
not a per-page breakdown. A fresh diagnostic run instead surfaced something more consequential
first: **`capturedPages: 0`** — every one of the 19 pages failed to capture at all, with the
identical `ReferenceError: __name is not defined` inside `extractStylesheetAnimations`. Confirmed
as a real, general, previously-undiscovered regression via a minimal reproduction completely
outside this codebase (any `page.evaluate(fn)` where `fn` declares an inner function throws
identically) — not specific to any one extractor: `tsx`'s transform (the real production entrypoint
this MCP server actually runs under) wraps a nested function inside anything passed to
`page.evaluate`/`page.addInitScript` with a call to a `__name` helper defined only at the module's
own top level, invisible to the isolated realm the serialized function actually executes in. This
had likely also been silently breaking `injectAnimationNeutralizingOverride`'s own nested `inject`
arrow (an `addInitScript` failure doesn't propagate the way a failed `page.evaluate` call does) —
meaning the animation-settling work shipped earlier this session may never have actually been
applying at all. Fixed with a `window.__name` shim injected as a plain string (never itself subject
to the same transform), confirmed live against both a minimal fixture and a full catchandtrade
re-run (`capturedPages: 0 → 19`, every page, `skippedPages: []`). Notably, this bug is invisible to
vitest itself — confirmed directly that vitest's own transform doesn't inject the same helper, so no
unit test can reproduce or guard it, the same category as the pre-existing `next dev`
process-group-leak bug. With capture finally working, the real per-page diagnosis turned out to be
far more mixed than "mostly auth-gated": several pages captured their own real, in-place
"please log in" content from a render-time early return, not a redirect at all — initially
misdiagnosed as a capture-order race against Next.js dev-mode's on-demand compilation, a theory
disproven by building and live-testing the fix for it (see stage 4b, below); one genuinely separate
page uses a real `useEffect`-driven redirect and correctly captures the destination login page; one
page renders real, legitimately-public content that's simply gated by user interaction a static
capture never performs; one page's capture happened to hit a live API failure that got baked in as
expected content. See "Fixing page capture, then actually diagnosing it," below, and "Waiting for
redirects to settle — a fix that's correct but disproven as the cause it was built for," after it.

The interaction-gated-logic cause named above now has a real fix too — deliberately scoped to
static detection and documentation only, never actual interaction with the target page. Simulating
a click against an arbitrary, unknown target app was considered and explicitly rejected, not just
simplified past: it crosses into the same risk category this environment's own safety rules gate
behind explicit human permission (submitting forms, clicking action controls), and there's no human
in the loop at click-time to grant it for a fully-automated tool. `inferInteractionGatedElements.ts`
instead detects the real, confirmed motivating shape — a button whose click sets React state that
some other part of the same file conditionally renders on (`{stateVar && ...}`/`{stateVar ? ...}`),
not just "a button has an onClick handler," which would be too broad to be useful signal — and
documents it in a new contract-doc section. The cross-reference against a genuine render gate
(not just "the state variable is set somewhere") is the precision guard, directly analogous to
`inferRequestValidationRules`'s known-field cross-reference: traced against nine cases before
writing any code, including a state variable used only for inline styling comparison (correctly
not flagged) and a state-setting button whose handler is a separately-named function rather than an
inline arrow (correctly out of scope, not traced into). Verified live against a fresh fixture
reproducing the exact `grading`-shaped pattern, confirmed additive alongside a sibling page with no
such pattern. See "Detecting interaction-gated content, without touching the page," below.

The auth-gate cause behind that same 79%-weak-page-test finding — black-box capture with no
session can't get past most of a real app's login walls — now has a real fix too, scoped the same
safe way the interaction-gated fix was: the tool accepts an optional, user-supplied Playwright
storageState (cookies/localStorage from a session the user authenticates once, out-of-band) and
loads it before capture, but never logs in itself, never handles a credential, and never submits a
form. Tracing this before shipping caught a real, load-bearing bug the design would otherwise have
shipped with: Playwright's storageState origins are matched by exact port, and this tool's dev
server picks a fresh random port every single run — a storageState captured in advance would never
origin-match whatever port a later run happens to land on, silently failing to apply with no error,
capture landing right back on unauthenticated content. Confirmed directly against a fixture
reproducing the real catchandtrade `localStorage.getItem('token')` shape before it was fixed by
remapping every origin entry to the run's actual baseUrl at both capture time and inside the
generated test's own template. The same fix also had to be threaded into the mutation-check's
scratch-copy mechanism, which mirrors only the target repo's own tree, not the separate rebuild
output directory the fixture gets copied into — missed, every such page test would have silently
registered as unrunnable. See "Closing the auth-gate capture gap: a storageState fix, and the
port-mismatch bug tracing it caught before shipping," below.

That fix was then re-run against the real catchandtrade app itself, not just a fixture reproducing
its shape — a genuinely different, higher-stakes test, since the earlier fixture necessarily
matched the fix to its own bug rather than the other way around. The result is real but layered,
not a clean before/after win: capture did reach real authenticated content (a real seeded
portfolio's Charizard, condition, and purchase price, verified directly via a standalone capture),
but only after a second, unrelated capture-environment gap surfaced and had to be worked around — a
hardcoded, absolute `NEXT_PUBLIC_API_URL` in this app's own dev config that doesn't match this
tool's randomized dev-server port, silently breaking the page's own client-side data fetch
regardless of auth. In the app's own committed configuration (without that workaround), the
portfolio page's generated test still lands as unrunnable in the official mutation-check run — but
traced down to a single new console error appearing only in the mutation-check's isolated scratch
re-run, not a content-reaching failure, a pre-existing console-error-tolerance limitation this
verification happened to be the first thing able to surface concretely, since no prior run ever
captured authenticated content noisy enough to trigger it. See "Validating the auth-gate fix
against the real catchandtrade app: real data reached, two more real gaps found along the way,"
below.

The absolute-`NEXT_PUBLIC_API_URL` gap that verification surfaced now has a real fix too, and it's
general — not scoped to auth at all, since any page whose client fetches read a hardcoded localhost
origin would hit the same wall regardless of whether the page needs a session.
`resolveLocalApiUrlOverrides` scans a target's `.env`/`.env.local`/`.env.development`/
`.env.development.local` files for `NEXT_PUBLIC_*` keys already pointing at `localhost`/`127.0.0.1`,
and passes an override matching this run's actual `baseUrl` into the spawned dev server's own
env — which always wins over a dotenv-file value, so nothing in the target's own files needs to be
touched. Deliberately conservative: a `NEXT_PUBLIC_*` var pointing anywhere else (a real external
host) is left alone, since there's no way to distinguish "this should track my own dev server" from
"this is an intentional external target" other than the value already being local. Wired into both
the capture-phase spawn and the shared generated-test boilerplate (inlined there, matching this
codebase's existing precedent for logic a separately-run generated project can't import directly).
Re-verified against the same real catchandtrade app, this time with its completely unmodified
`.env.development` — `NEXT_PUBLIC_API_URL` still hardcoded to `http://localhost:3003` — and the
portfolio page's real seeded content (Charizard, condition, price) was reached automatically, no
manual workaround needed this time. See "A general fix for hardcoded local API URLs, verified
against catchandtrade with no manual workaround," below.

A genuinely blind third-party app — a 9-page Next.js QR-code generator
([Awis13/qr](https://github.com/Awis13/qr), selected for this check with no prior knowledge of its
shape — sharpened, rather than introduced, an already-open design tension named earlier in this
document: the weak/unrunnable-tests-still-unblock-a-page erosion of the untested-contracts hook's
own guarantee. On catchandtrade that erosion measured 79% (15 of 19 pages). On this app it measured
**100%** (9 of 9) — `spec/untested-contracts.json` came back completely empty, meaning the hook
would grant a rebuild agent write-permission on every single page with zero actual verification
behind any of it, regardless of which model runs, or whether contract-locking enforcement is even
present. This is a structural result, not a model-behavior question: `writeSpecTree.ts` marks a
route "covered" the instant *any* test claims it via `coveredRouteFiles`, weak or unrunnable or not,
so an app where every generated page test lands in `tests/weak/` — which this one's did, all nine,
confirmed directly by `generate_spec`'s own report — empties the untested-contracts list by
construction, not by chance. See "A second real app finds the weak-test-unblock erosion at 100%, not
79%," below.

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

## Two real bugs found only by testing against an app with genuine backend functionality

Every prior test app (`novafolio`, `emberandrust`) had at most one trivial API route returning a
static JSON stat — never a route that reads a request body, never any code that persists state
relative to the process's own working directory. `fieldnotes`, a small guestbook app with a real
`better-sqlite3`-backed database and full `GET`/`POST /api/notes` + `DELETE /api/notes/[id]` CRUD
(manually verified correct via real curl requests before running the pipeline at all), exercised
two code paths nothing before it had touched — and both immediately surfaced real, previously
undetected bugs.

**Bug 1 — `generateNextApiTests.ts` never sent a request body, for any HTTP method.** The
generated smoke test constructed `new NextRequest(url, { method })` with no `body` field, so any
`POST`/`PUT`/`PATCH` handler that unconditionally calls `request.json()` always throws
(`SyntaxError: Unexpected end of JSON input`), landing that route's test in `unrunnableTests`
regardless of whether the route's actual logic is correct. Confirmed for real against
`fieldnotes`: `POST-api-notes.spec.ts` failed the baseline "responds without crashing" check
before the fix, purely because the generated request had nothing for `request.json()` to parse —
not because of any real problem with the route. Fixed by sending `body: JSON.stringify({})` and a
`Content-Type: application/json` header for `POST`/`PUT`/`PATCH` only (`GET`/`DELETE` unchanged,
matching real REST conventions). An empty object is a deliberately minimal, generic placeholder —
there's no way to infer the route's real expected shape from static analysis alone, matching the
same philosophy as `concretePath`'s existing `test-value-123` placeholder for dynamic segments.
The handler's own validation then legitimately returns its own 4xx for the missing fields, which
still satisfies the existing `expect(res.status).toBeLessThan(500)` assertion — the fix only
needed to stop `request.json()` itself from throwing, not to satisfy any particular business-logic
outcome. Re-ran `generate_spec` against the real `fieldnotes` app after the fix:
`POST-api-notes.spec.ts` moved from `unrunnableTests` to `weakTests` (mutation-checked, not
crashing), and `mutationsChecked` rose from 3 to 5 — this app has real branching validation logic
in its POST handler that simply couldn't be exercised at all before.

**Bug 2 — the mutation-check's scratch-copy isolation leaked a real file into this repo's own
directory.** `runMutationCheck.ts`'s `runVitestOnce` passed `--root scratchDir` to the vitest
subprocess but never set the subprocess's own `cwd` — and `--root` only tells vitest where to
resolve test files/config from, it does not change `process.cwd()` for code running inside that
process. `fieldnotes/src/lib/db.ts` opens its SQLite file via a bare `path.join(process.cwd(),
'fieldnotes.db')` at module-import time (a completely ordinary thing for a small app to do), so
merely importing the route module during a scratch-copy mutation check wrote a real
`fieldnotes.db` file into `rebuild-dossier`'s own working directory — not the isolated scratch
copy the whole mechanism exists to contain side effects to. Caught by literally seeing the file
appear via `git status` after a real `generate_spec` run, not by inspection. Fixed by adding `cwd:
scratchDir` to the `execFileSync` call. Re-ran the same `fieldnotes` pipeline after the fix and
confirmed the file no longer appears anywhere outside the (still-deleted-after-use) scratch
directory. This is a real, generalizable isolation gap that any real app's normal top-level
side effects (log files, cache files, lockfiles, anything else opened via a relative path) could
have hit — `fieldnotes` is simply the first test app in this whole project with any such
side-effecting code at all.

**Why both of these went undetected across two prior full experimental runs:** neither is a
methodology gap in the screenshot-fidelity experiments above — they're gaps in the *generator*
and *mutation-check* that nothing before now happened to exercise. `novafolio` and
`emberandrust`'s single API routes were both trivial `GET`-only stat endpoints with no request
body and no filesystem side effects; the first app built with a real, persistent backend is what
finally exercised these code paths. Both fixes are covered by new unit tests
(`test/unit/spec/generateNextApiTests.spec.ts`: body/header present for `POST`/`PUT`/`PATCH`,
absent for `GET`/`DELETE`) and confirmed against the real running app, not just hand-traced —
`npm run typecheck && npm test` (334 tests, 72 files) pass, and a full `generate_spec` re-run
against `fieldnotes` was inspected directly (the generated `POST-api-notes.spec.ts` file's actual
content, the response JSON's `unrunnableTests`/`mutationsChecked` fields, and the absence of any
leaked file) rather than trusted from a self-report.

## Blind rebuild of a real backend: visual and status-code parity are achievable; response-body-shape parity is not

The three prior blind-rebuild runs (`novafolio`, `emberandrust` ×2) only ever tested visual
fidelity and layout — none of those apps had a real, stateful backend, so none of them could
answer the question this session was actually asked: does a blind rebuild reproduce an app's
*functional* behavior, not just its appearance? `fieldnotes` (a guestbook with a real
`better-sqlite3`-backed database and full `GET`/`POST /api/notes` + `DELETE /api/notes/[id]`
CRUD, manually curl-verified correct beforehand) was built specifically to test this. The original
source was physically relocated out of the filesystem (not just "instructed to ignore"), and a
fresh agent was handed the locked spec and kickoff prompt to rebuild it blind, the same protocol
as every prior run this session.

**The rebuild agent itself stalled and failed** — the background task hit a 600-second
no-progress watchdog and never finished its own manual verification pass. Its last self-report
claimed the dev server was up and `GET /api/notes` returned 200, with POST/DELETE checks still
pending. Consistent with this session's standing discipline, that self-report was not treated as
a result — the actual filesystem and running app were checked directly instead.

**What was actually there, verified directly:** all source files existed, dependencies were
installed, and `npx vitest run tests/visible` / `tests/weak` both passed in full (1/1 visible, 0
held-out — this app's single-page/single-route-file shape happened not to produce any held-out
split, 3/3 weak, including `POST-api-notes.spec.ts` — a live confirmation that yesterday's
request-body fix works correctly against a genuinely different app, not just the one it was
debugged against). So by every test-passing signal, the rebuild looked complete and correct.

**Running the identical real-HTTP-request flow against both apps side by side found two real,
distinct functional divergences that no test in either app's suite would ever catch, because
neither app's generated tests assert on response body content — only HTTP status codes:**

1. **Request/response field name.** The original app's real API expects and returns a field
   called `message` (`POST /api/notes` with `{"name":"Parker","message":"..."}`, echoed back as
   `{"id":1,"name":"Parker","message":"...","created_at":"..."}`). The rebuild independently
   invented a different, equally plausible field name: `note`
   (`{"id":2,"name":"Parker","note":"...","created_at":"..."}`) — consistently, across its own
   request body, response body, and SQLite column name, so the rebuild is entirely
   self-consistent, just diverged from the real original contract. Posting to the rebuild using
   the original's actual field name (`message`) fails its own validation
   (`{"error":"name and note are both required"}`).
2. **Timestamp format.** The original's `created_at` is `"2026-07-27T20:51:55.120Z"` — ISO 8601
   with milliseconds, produced by application-layer `new Date().toISOString()`. The rebuild's is
   `"2026-07-27 20:51:55"` — SQLite's own `datetime('now')` default expression, invoked at the
   schema level instead. Both are reasonable, working implementations of "record when this note
   was created" — they just don't produce byte-identical output.

**Confirmed as a clean control case, not just an absence of testing:** `DELETE /api/notes/:id`
matched exactly on both response shape (`{"success":true}` on both apps) and 404-on-nonexistent-id
behavior on both. That route has no free-form request or response fields to diverge on — nothing
for either implementation to invent independently — which is exactly why it didn't diverge, not
evidence the pipeline generally achieves body-level parity.

**Root cause, confirmed by reading the actual generated contract, not inferred:** the API contract
written for `POST /api/notes` (`spec/contracts/POST-api-notes.md`) records only the route
handler's outer TypeScript signature verbatim — `export async function POST(request: NextRequest)
{` — which is identical for every Next.js POST handler in existence regardless of what it does
internally. Nothing anywhere in the spec captures the expected JSON body shape, required field
names, or response field names, because `generateNextApiTests.ts`'s generated assertions only ever
check `res.status`, never response body content. A rebuild agent working from this spec alone —
even a careful one, converging cleanly on every test — has no source of truth for either finding
in this section, and both are things it had to invent, not things it got wrong through carelessness.

**What this means, stated plainly:** this pipeline's current spec generation can get a blind
rebuild agent to visual parity (prior runs) and HTTP-status-code-level API parity (this run,
verified: 200/201/400/404 all matched across every route), but **not** request/response body
schema parity for routes that read or return free-form JSON. That's a real, previously-unknown
boundary on what "functional parity" this tool can currently deliver — not a bug to patch
reactively, but a capability gap worth naming honestly before claiming this tool clones "the
functionality," not just the look, of a real backend. A natural next step — capturing a sample
real request/response body pair per API route during ingest and asserting field-name-level shape
in the generated test, not just status — is worth naming as future work here rather than
building speculatively before confirming (via a case like this one) that it's actually the
bottleneck.

## Animated content: the capture pipeline actively produces misleading fixtures, and a weak model faithfully rebuilds them anyway

**First, a standalone sanity check, not part of the animation experiment:** the actual pushed
GitHub repository (not this local working copy, which has been mutated all session) was cloned
fresh into an empty directory and put through `npm install`, `npm run build`, `npm run typecheck`,
and `npm test` with zero prior state. All green — 334 tests, 72 files, no local-only fixes or
artifacts required. The tool works for a real external user pulling it cold, not just in this
session's environment.

**The experiment:** every prior test app tested visual fidelity on essentially static content —
nothing with real, on-page motion. `driftlight`, a small ambient-lighting product site, was built
specifically to test this, with three deliberately different kinds of animation: a one-time CSS
entrance fade/slide on the hero content (`@keyframes hero-rise`, 900ms), an infinite looping glow
pulse on the CTA button (`@keyframes glow-pulse`, no settled frame at all), a staggered per-card
entrance on the collection grid (same `hero-rise` keyframe, `animation-delay` scaled by index), and
a `requestAnimationFrame`-driven stat counter that ticks from 0 to 12,400 over 1.4 seconds. Manually
verified working in a real browser before running the pipeline.

**The capture pipeline's own outputs disagreed with each other from a single run.** The generated
test's DOM-text capture recorded the counter frozen at literally `"0"` — Playwright's `page.goto` +
immediate DOM read landed before `requestAnimationFrame` had painted a single tick. The *reference
screenshot* from that same `generate_spec` call shows a third, different value: `"104+"` — neither
the DOM-captured `"0"` nor the true settled `"12,400+"`. Screenshot capture and DOM-outline capture
evidently don't happen at the same instant relative to a running animation, so a single
`generate_spec` call produced two internally-inconsistent ground truths for the same page load.

**The reference screenshot for the collection page is missing half its content.** The staggered
card-entrance animation means cards 4–6 (`Ash`, `Tallow`, `Rue`) were still at their base
`opacity: 0` when the screenshot was taken — they are simply not visible in the image, even though
the generated test correctly asserts all six product names via `textContent` (which doesn't care
about CSS visibility, so this specific gap didn't propagate into the test itself). The hero content
in the other screenshot is also visibly faded relative to its settled appearance — caught mid
fade-in, not after it.

**A blind rebuild — this time by Haiku, not Sonnet, specifically to test whether this pipeline's
enforced rails let a weaker model succeed without needing its own judgment — converged cleanly on
every test, and every claim below was checked directly against its actual output, not the agent's
self-report (which claimed a clean pass and nothing more, correctly but incompletely):**

- **2/2 visible+weak tests pass, 0 held-out tests exist for this app** — independently re-run, not
  just re-quoted.
- **The `"104+"` screenshot artifact was hardcoded as permanent static text** — `<div
  className="stat">104+ lamps lighting up homes worldwide</div>`, no state, no client component, no
  counting logic at all. The rebuild didn't just fail to reproduce the counting animation; it
  faithfully reproduced the *capture bug's own artifact* as if it were real, intended content —
  the single cleanest demonstration in this document of a static-capture pipeline actively
  misleading a downstream rebuild, not merely failing to help it.
- **Zero of the three animations were reproduced.** No `@keyframes` anywhere in the rebuilt CSS,
  no glow on the button (a plain `background-color` hover swap the model invented on its own, not
  matching the original's pulsing box-shadow), no entrance transitions, no staggered card reveal.
  Unsurprising and not a model failure: nothing in the generated tests or spec ever encodes motion
  — there was no signal to reproduce, for Haiku or any model.
- **All six products were correctly present** (rescued by the text-based assertions, which don't
  care that three of them were invisible in the reference image) **but the three
  invisible-in-screenshot cards' colors were plausible, wrong guesses** — `Ash`/`Tallow`/`Rue` came
  out a generic muted brown/tan/olive, nothing like the real `#4a4640`/`#b3893f`/`#405248`. The
  three cards that *were* visible in the screenshot fared much better — `Hollow`'s guessed
  `#5a6b5a` is nearly pixel-identical to the real `#5c6b57` — a clean, direct confirmation that
  screenshot-derived color accuracy tracks whether the content was actually visible in the
  screenshot, not some general property of the model or the pipeline.
- **A real, separate deviation, unrelated to animations:** `CLAUDE.md`'s stack line says
  "TypeScript / Next.js," but the rebuild is plain `.jsx` with no `tsconfig.json` at all — it
  added `typescript@7.0.2` and mismatched-major-version `@types/react@19.2.17` (against an actual
  `react@18.3.1` dependency) to `package.json` and then abandoned TypeScript entirely, leaving
  those now-unused packages behind. Nothing in `CLAUDE.md`'s enumerated non-negotiable rules
  explicitly bars this (the locked-dependency-versions rule is about *not changing* pinned
  versions, and no language-file-extension rule exists), so this isn't a rails violation in the
  same sense as gaming a test fixture — but it is a real, unprompted departure from the stated
  stack that a stricter rule set would need to catch explicitly, since nothing currently does.

**What this confirms and what it doesn't:** the hypothesis behind using Haiku here — that a
strict, mechanically-enforced TDD harness shouldn't require a highly capable model to reach a
green, functionally-plausible result — held for everything the harness actually checks: text
content, status-level behavior, structural completion. It does not and cannot extend to anything
the harness has no assertions for, and motion is currently a total blind spot: not weakly covered,
not partially covered, absent. A model choice only matters for what the spec gives it something to
be judged against — the ceiling here is the spec's coverage, not the model's competence, which is
exactly the strong-rails hypothesis this run set out to test, just demonstrated from the opposite
direction (a real, current gap) rather than a success.

## Closing the request-body-shape gap: tracing against real code caught two real design flaws before they shipped

The "Blind rebuild of a real backend" finding above left one concrete, well-scoped gap: the
generated contract for an API route records only the handler's outer signature line, never
anything about the request/response body shape, and the generated tests only assert HTTP status
codes — so a blind rebuild agent has no signal about expected field names and has to guess (which
is exactly how `note` ended up standing in for the real `message`). This section closes the
request-body half of that gap: a new, regex-based `inferRequestBodyFields.ts` reads a route
handler's own source, and the extracted field names feed (a) a new "Inferred request body fields"
section in the generated contract `.md`, and (b) a more realistic, non-empty placeholder body in
generated smoke tests for both the Next.js and Express generators — replacing the `{}` placeholder
that previously guaranteed every generated POST/PUT/PATCH test only ever exercised a route's
empty-body validation-failure path, never its real success path. Response-body field-name
inference and any new strict assertion on extracted names were deliberately scoped out: extracted
names are documentation and test-realism aids only, never enforcement — a bad extraction must
never be able to fail a genuinely correct rebuild.

**Bonus fix, same root cause:** the Express test generator (`generateTests.ts`) had the identical
missing-request-body crash bug already fixed on the Next.js side in the previous session — never
sending a body for any HTTP method, so any Express POST/PUT/PATCH handler reading `req.body`
unconditionally would crash this generator's own smoke test. Fixed in the same pass.

**Tracing the design against the real motivating code, before writing a single line of the
module, caught a fatal flaw the plan's own toy examples had missed.** The initial three regex
patterns (destructuring from `await request.json()`, destructuring from `req.body`, plain
`body.field` property access) were validated only against clean textbook examples during design.
Directly tracing them against the *actual* source of the real app that motivated this whole
feature —

```ts
const name =
  typeof (body as Record<string, unknown> | null)?.name === 'string'
    ? ((body as Record<string, unknown>).name as string).trim()
    : '';
```

— found **zero matches**. `body` is never immediately followed by `.`/`?.` in this code; it's
always followed by ` as Record<...>` first — the standard strict-TypeScript idiom for narrowing an
`unknown` value before touching a property. Had this shipped as originally designed, the whole
feature would have been a silent no-op on precisely the case it was built to fix, likely without
anyone noticing for a long time (a missing contract section fails safe, not loud). A fourth
pattern, added and re-traced against the same real snippet before being accepted, fixed this.

**Live end-to-end testing (not just unit tests) caught a second, related gap the same day.**
Building a live Express fixture to verify the crash fix used a natural Express idiom —
`(req.body as Record<string, unknown> | null)?.name`, casting `req.body` directly rather than
through an intermediate `body` variable — and the same pattern missed it again, for the same
underlying reason (the pattern required a literal `body` token immediately inside the parens).
One-character fix (`(?:req\.)?body`), re-traced, regression test added. Two related failures found
by two different disciplines — designing against a known real example, then testing against a
freshly-built one — neither of which the other would have caught on its own.

**Verified live, both frameworks, not just via unit tests:** for each of Next.js and Express, a
small fixture app was built with the real type-assertion idiom, manually curl/fetch-verified
correct first, then run through the actual `ingest_repo` → `generate_spec` pipeline. In both
cases: the generated contract doc listed the real field names (`name`, `message`) instead of
nothing; `unrunnableTests` was empty (confirming the crash fix); and — the concrete, load-bearing
check — issuing the exact request the generated test now sends returned a real `201` from the
real handler, not a `400` from hitting the previously-always-empty-body validation path.

## Closing the response-body-shape gap: a scoping decision made explicit, then confirmed live

The request-body fix above deliberately left the response side out of scope, reasoning that
"fixing the request side transitively fixes the response side too" for routes that echo back what
they stored. True for field *names* shared between request and response — but it does nothing for
fields that exist **only** in the response (`id`, `created_at` — exactly the fields behind the
original finding's timestamp-format divergence), and nothing at all for GET routes, which have no
request body to lean on in the first place. This increment closes that remaining gap:
`inferResponseBodyFields.ts` statically extracts field names from a route handler's own literal
response construction (`NextResponse.json({...})`, `res.json({...})`,
`res.status(n).json({...})`), surfaced as a second "Inferred response body fields" section in the
generated contract doc. Value-format inference (e.g. detecting *how* a timestamp is produced, not
just that the field exists) was scoped out here, named as separate future work — since closed, see
"Response value-format hints," below.

**A real, consequential scope decision was surfaced and confirmed before writing any code, not
discovered painfully afterward this time.** Response construction is very commonly delegated to a
separate function — the actual motivating app itself does exactly this (`route.ts` calling
`createNote()`/`listNotes()` from a `lib/db.ts` data layer, which builds and returns the shaped
object). Extracting field names from that requires resolving an import into another file and
parsing its return statement or a type declaration — a materially bigger, riskier increment than
anything built so far. Asked directly rather than assumed: scope this increment to same-file
literal construction only, and name cross-file resolution as explicit, deferred future work rather
than attempt it now. Confirmed.

**Traced against that exact shape before finalizing the design, matching the discipline the
request-side fix learned the hard way:** `NextResponse.json(createNote(name, message), { status:
201 })` and `NextResponse.json(rows)` (the common GET-list shape) were both run through the
proposed extraction logic before it was written into the plan — both correctly return `[]`, not a
wrong guess. Seven other shapes were traced the same way, including a value with nested parens
(`created_at: new Date().toISOString()`), a nested object value (only the outer key should
survive), a spread combined with a keyed property, and a handler with two return sites (an error
response and a success response) — the last of which unions both shapes' fields together rather
than distinguishing which belongs to which, an explicitly named, accepted limitation rather than
an oversight.

**Verified live, not just via unit tests, with a fixture built specifically to prove the honest
limitation is real:** two routes, manually fetch-verified correct first, then run through the
actual `ingest_repo` → `generate_spec` pipeline. The route with an inline literal response
(`NextResponse.json({ id, label, created_at: new Date().toISOString() }, { status: 201 })`) got a
contract doc correctly listing `id`, `label`, `created_at`. The sibling route delegating to an
imported `createNote()` function got **no response-fields section at all** — the scope boundary
confirmed for real, not just asserted in a unit test that could quietly drift from the actual
extraction logic over time.

**A smaller, related cleanup in the same pass:** `isolateHandlerBody` (isolating one route
handler's function body from its file) was needed by both the request- and response-field
extractors, and had to keep meaning exactly the same thing for both — so it was pulled out of
`inferRequestBodyFields.ts` into its own shared module, `isolateHandlerSource.ts`, rather than
duplicated. A future fix to isolation logic now can't silently diverge between the two consumers.

## Response value-format hints: how a field's value is produced, not just that it exists

Field names alone don't close the gap the original finding actually turned up: knowing a field is
called `created_at` gives a rebuild agent zero signal about *how* to produce its value, and the
real divergence was exactly that — `new Date().toISOString()` in the original app vs. SQLite's
`datetime('now')` in the rebuild. This increment closes it: for each response field,
`inferResponseValueFormatHints` traces back to a real, traceable value-producing expression and
shows it **verbatim** in the contract doc — no curated pattern classifier, no guessing at meaning,
matching `generateContracts.ts`'s existing "verbatim from source, never a paraphrase" philosophy
(the same one `sourceLine` already uses for the signature line).

**A real, consequential scope decision, surfaced and confirmed before designing further, same
discipline as the field-name fix.** Two levels were possible: (a) only expressions written inline
directly in the response literal, or (b) also tracing a shorthand/bare-identifier field back to its
most recent `const`/`let` declaration earlier in the same handler — the more common real-world
style (compute once, use via shorthand), and the exact shape of the real `fieldnotes` app's
`createNote()`. Confirmed: (b). **Named plainly, not glossed over: even with this scope, that
specific historical case still isn't resolved directly** — `createNote()` lives in a separate file,
and cross-file resolution is already a named, deferred limitation from the field-name fix. This
closes the *pattern*, not that one specific instance.

**Every edge case traced against concrete examples before a single line was written, not assumed**
— six cases, all confirmed correct: an inline expression; a shorthand property traced to its
declaration; a shorthand traced to a *trivial* literal (suppressed — `computed as: `1`` isn't a
format worth documenting); an inline trivial literal (also suppressed); a shorthand field with no
local declaration at all, e.g. destructured directly from the request (nothing to show, honestly);
and a chained alias (`const x = ...; const created_at = x;`) — deliberately suppressed too, since
only one level of aliasing is resolved and showing a bare alias name isn't more informative than
the field name itself.

**Writing the tests surfaced a real assumption error before it shipped, caught by the tests
failing, not by further guessing.** Three tests were first written expecting request-body
passthrough fields (e.g. `name` derived from `body.name`) to get *no* hint, on the assumption this
feature was only about server-generated values. All three failed — the actual traced logic
correctly shows a hint for `body.name` too, since it's a real, non-trivial expression. Reconsidered
rather than patched around: showing it is *correct*, not noise — telling a rebuild agent a field is
a plain, untransformed passthrough is real signal, distinct from a field that's actually computed.
The tests were fixed to match the verified-correct behavior, not the other way around.

**Verified live** against a fresh fixture reproducing the exact `createNote()`-shaped pattern in a
single file (`const created_at = new Date().toISOString(); ... return NextResponse.json({ id: 1,
name, created_at })`, manually curl-verified correct first): the generated contract doc correctly
shows `` `created_at` — computed as: `new Date().toISOString()` `` and `` `name` — computed as:
`typeof body?.name === 'string' ? body.name : ''` ``, while `id` (a trivial literal) renders with
no clause at all — exactly the designed, traced behavior, confirmed against a real pipeline run,
not just unit tests.

## Closing the evidence gap: does a fresh blind rebuild actually use the improved contract, not just receive it?

Every fix above was verified by checking the pipeline's *output* — the contract doc's content, the
generated test's body — directly. None of them had been verified by putting a fresh, genuinely
blind rebuild agent in front of the improved contract and confirming it actually *changes what the
agent builds*. That's a real, different kind of evidence, and it's the one the original `note`-vs-
`message` finding actually rested on. This closes that gap: a new app, `notarybox`, built
specifically so the fixes fully apply (backend logic same-file, no separate data layer — the one
scope boundary every fix above shares), manually curl-verified correct, run through the real
pipeline, source genuinely relocated out of the filesystem, and handed to a fresh Haiku agent with
zero access to it — the same blind-rebuild discipline as every other experiment this session, not
loosened for convenience.

**The core result is genuinely positive, not assumed.** Read directly from the rebuild's own
source (not its self-report) after restoring the original: `name`, `message`, and
`created_at: new Date().toISOString()` — the exact field names and exact timestamp-producing
expression the enriched contract documented, not a re-guess. Confirmed a second way, independent of
reading source: running an identical `POST` against both apps side by side returned field-name-
and format-identical JSON (`{"id":1,"name":"Parker","message":"...","created_at":"2026-08-
01T10:24:22...Z"}` from both, ISO-8601-with-milliseconds matching on both sides). **The fixes did
exactly what they were built to do** — this is the missing piece of evidence, not an assumption.

**Two real divergences the same experiment surfaced, neither fixed by anything shipped so far, both
worth naming plainly rather than let the positive result overshadow them:**

1. **Status code: `201` (original) vs `200` (rebuild).** The rebuild's success response never sets
   an explicit status, so it defaults to `200`. `ingest_repo` found zero comment/TODO signals for
   this route, so there was no reconciliation-based claim pinning the expected status — nothing in
   the current pipeline captures "this route should return 201," field-name/format fixes included.
   A real, minor, unaddressed gap.
2. **Missing validation, a more significant miss.** The original app rejects a `POST` missing
   `message` with `400` and an error body. The rebuild has no such check at all — it silently
   creates a note with `message: ""` and returns `200`. Confirmed live: identical incomplete
   requests against both apps get `400` from the original, `200` (with a half-empty record
   created) from the rebuild. This isn't something any fix in this document could have caught —
   the generated smoke test only asserts `res.status < 500` (both 200 and 400 satisfy that), and
   no field-name, value-format, or animation fix touches business-logic validation rules at all.
   This *reconfirms* an already-named, pre-existing limitation of the current test-generation
   approach (crash-safety only, not business-rule correctness) with a fresh, concrete, live
   example, rather than surfacing something new.

**What this settles, and what it doesn't.** The request/response field-name and value-format
fixes are now validated at the level that actually matters — a fresh, blind rebuild agent changing
its behavior because of them, not just a correct-looking contract doc. That's real, closed
evidence, not an assumption carried forward from the original finding. It does not mean "blind
rebuilds now reliably clone a backend": validation logic, and anything else not captured by field
names/shapes/formats, remains fully exposed to a blind rebuild's own guessing, with nothing in the
current pipeline giving it a signal either way.

## Settling animations before capture, and a new limitation found the moment a rebuild agent actually used the result

The "Animated content" finding above left two confirmed, concrete bugs: a single `generate_spec`
call's screenshot and DOM-text captures could disagree with each other on an animated value (a
counter frozen at `"0"` by one capture, `"104+"` by the other, neither the true settled
`"12,400+"`), and a staggered CSS entrance animation left half a product grid invisible in the
reference screenshot. Both are now fixed, as new default behavior (no opt-in — this only touches
an in-memory Playwright page during capture, never the target repo, and adds no external cost):
animations/transitions are neutralized via `page.addInitScript` injecting the same near-zero
duration / single-iteration override real visual-regression tools (Percy, Chromatic) use, and a
bounded settle wait handles JS-driven motion a CSS override can't touch (a
`requestAnimationFrame` counter). The wait is baked into *both* the original capture and the
generated test's own template — a necessary correction found during design, not an afterthought:
without it, a rebuild agent that faithfully reproduces documented motion would fail its own
generated test by being read before the motion settles.

Alongside the fix, a new contract-doc section — "Declared CSS animations/transitions" — surfaces
`@keyframes` names and transition-bearing selectors read from the page's own authored stylesheets
(never computed style, which the neutralizing override would corrupt), so a rebuild agent has
*some* signal that motion exists at all, which the pipeline previously gave none of. Live testing
against a fixture reproducing the exact `driftlight` shapes caught a second real bug before this
shipped: a shared stylesheet (`globals.css`, loaded on every page via the Next.js root layout)
made every page report the same animations regardless of whether it used them — a plain "about"
page with zero animated elements initially showed the same `hero-rise`/`glow-pulse` entries as the
pages that actually use them. Fixed by scoping detection to selectors that match a live element on
that specific page, confirmed live: the about page correctly shows no section at all, the home
page shows both keyframes, the collection page shows only the one its cards actually use.

**A further, real limitation found the same day, from the most direct kind of test: watching a
blind rebuild run side by side with the original in a browser.** The original app's CTA button
pulses an amber glow *unconditionally*, all the time — `glow-pulse` is applied directly to `.cta`,
no interaction required. A Haiku-driven blind rebuild (working only from the locked spec, no
access to this source) correctly reproduced the keyframe *name* — `glow-pulse` genuinely exists in
its generated CSS — but wired it to `.button:hover` instead, so at rest, with nothing hovering it,
there's no glow at all. The color was also wrong (`#d4a574`/`rgba(255, 193, 7, ...)` — a generic
amber — vs. the real `#e8a548`/`rgba(232, 165, 72, ...)`), which is the same, already-documented,
screenshot-derived-color-approximation pattern from every prior visual-fidelity run this session.
The hover-vs-always-on miss is a different, new kind of gap: the "Declared CSS animations/
transitions" section lists keyframe *names* and transition-bearing *selectors*, but nothing about
*when* an animation fires — always-on vs. triggered by an interaction state like `:hover`. A
rebuild agent has no way to distinguish "this pulses constantly" from "this pulses on hover" from
the current documentation alone; it has to guess, and guessed the more common web-convention
default (motion reserved for interaction) rather than this specific app's actual, less-common
choice (motion always on).

**This gap is now closed, and closing it surfaced a second bug more consequential than the
labeling gap itself.** Each detected keyframe usage and transition now records its trigger
condition — `unconditional` or the specific state pseudo-class (`:hover`, `:focus-within`, etc.) —
read directly from the rule's own selector text, no LLM call, no new non-determinism. But
`matchesLiveElement`'s existing live-element check queried the selector *with its pseudo-class
still attached* (`.button:hover`), and `document.querySelector('.button:hover')` returns `null`
during automated capture regardless of whether `.button` exists, since nothing is actually being
hovered — **meaning every state-gated rule was invisible to detection entirely, not merely
unlabeled.** A rebuild attempting the exact `.button:hover { animation: glow-pulse ... }` mistake
that motivated this fix wouldn't have shown up in the contract doc at all before this correction.
Fixed by stripping the pseudo-class before the live-element check (querying the *base* selector)
— the same piece of information needed for the trigger label, so one fix serves both purposes.

Tracing the label logic against realistic selectors before shipping caught a third, smaller bug:
a first version of the pseudo-class pattern listed `focus` before `focus-within`, and since regex
alternation tries alternatives left-to-right and takes the first match, not the longest,
`.input:focus-within` matched only `:focus`, leaving `-within` as corrupted leftover text in the
stripped base selector. Fixed by ordering the longer, more specific alternatives first — the same
category of ordering bug already caught once this session in `inferRequestBodyFields.ts`'s own
pattern design. Verified live against a fresh fixture built specifically to stress both fixes at
once (an unconditional animation shared by two selectors, a hover-gated animation, an
unconditional transition, and a transition whose duration is declared directly on the `:hover`
rule itself, not the base selector) — the generated contract doc correctly rendered
`` `.hero` → `fade-in` (unconditional) ``, `` `.badge` → `fade-in` (unconditional) ``,
`` `.button:hover` → `shake` (:hover) ``, `` `.card` (unconditional) ``, and
`` `.link:hover` (:hover) `` — every case labeled correctly, including the two that would have
been silently missing entirely before the detection fix.

Considered and explicitly deferred in the same conversation: using a live Claude-in-Chrome session
to actually interact with a page (hover, click) and cross-reference its observations against the
Playwright screenshot and this static CSS extraction, for richer context on behavior static
analysis can't see at all (multi-step JS state machines, scroll-triggered effects, anything
without a clean CSS-rule signature). That's a real LLM call driving real interaction — the same
cost/non-determinism bucket as the existing opt-in vision-classification feature, not something to
fold into a deterministic fix. The trigger-condition gap specifically didn't need it: the answer
was sitting in data already being read, for free. Worth a future, separately-scoped increment for
the cases that genuinely need it, once it's clear the cheaper fixes aren't sufficient — not
designed further here.

## Closing part of the missing-validation gap: detecting required-field guards

The `notarybox` blind-rebuild experiment named this as the more significant of its two
unaddressed divergences: the original app rejects a `POST` missing `message` with `400` and an
error body; the blind rebuild had no such check at all, silently created a half-empty record, and
returned `200`. Nothing shipped up to that point touched this — field-name, value-shape, and
value-format fixes all describe what a response *contains*, never what makes a request *valid*.
This is a genuinely different kind of signal (a rule, not a shape), and unlike the other gaps this
document tracks, it's the one most directly threatening to the "functional, not pixel-perfect" bar
this project is actually aiming for: a rebuild that silently accepts invalid input and corrupts
state isn't functional, regardless of how close its field names and timestamp formats are.

**Scoped deliberately, same discipline as every prior fix:** ship the exact real-world shape that
motivated this — `if (!name || !message) { return NextResponse.json({ error: '...' }, { status:
400 }); }`, the actual `fieldnotes`/`notarybox` handler idiom already used throughout this
codebase's own tests — and name adjacent shapes as explicitly deferred rather than guess at them.
`typeof x !== 'string'` checks, `.length === 0`/empty-string checks, Zod or other schema
validation, and brace-less one-liners (`if (!name) return res.status(400)...;`, a common Express
idiom) are all recognized as real, common validation shapes that this v1 does not attempt —
accepted limitations, not oversights.

**A new file, not an extension of `inferRequestBodyFields.ts`.** Guard-clause scanning is a
genuinely different kind of analysis from property-access/destructuring extraction, so
`inferRequestValidationRules.ts` gets its own file, matching this codebase's existing
one-concern-per-file convention. It reuses `isolateHandlerBody` (validation guards must be scoped
to *this route's own handler*, exactly like the request-field extractor already requires, to avoid
matching an unrelated `if` in a different exported handler sharing the same file) and — the key
precision guard — calls `inferRequestBodyFields` itself to get the set of field names actually
known to be read from the request body for this route. **A negated identifier is only reported as
a validation rule if it's in that known-field set.** Without this cross-reference, a guard like
`if (!isAdmin) { return ...403...; }` is structurally identical to a real field-validation guard
and would otherwise be misreported as "the `isAdmin` field is required," even though `isAdmin` was
never read from the request body at all — this is an authorization check, not a body-validation
rule, and the two are easy to conflate from source shape alone.

**Traced against ten realistic guard-clause shapes via a throwaway Node script before any real
code was written** — the same discipline as every prior fix this session. The real
`fieldnotes`-shaped `if (!name || !message) {...400...}` idiom correctly flagged both fields; a
single-field guard flagged correctly; an `&&`-joined condition (`if (!name && !message)`) was
correctly excluded, since it means "reject only if *both* are missing" — an at-least-one-of-N
rule, a genuinely different semantic than "each is individually required" that the same per-field
label would misrepresent; a brace-less Express one-liner was correctly excluded (named v1
limitation); a guard on a non-body identifier (`isAdmin`) was correctly excluded via the
cross-reference; a guard whose block returns `200`, not an error, was correctly excluded (nothing
is actually being rejected); an optionally-chained negation (`!name?.trim()`) correctly resolved to
its base identifier while showing the full expression verbatim; two separate single-field guards
in one handler were both flagged independently; a `typeof` check was correctly excluded (different
shape, deferred); and — the case that proved paren-balancing is genuinely necessary, not a
nice-to-have — a condition containing a nested call (`!name || !message.trim()`) resolved
correctly, where a naive `[^)]+`-style regex would have truncated the condition at the `)` inside
`.trim()` and silently mismatched the guard's actual boundary.

**Merged additively, same proven pattern as the response value-format hints.** Rather than a new
top-level section, `inferRequestValidationRules`'s result is merged by field name into the
existing "Inferred request body fields" section: a field with a detected guard gets an extra
`— required (checked via: ...)` clause, showing the exact guard expression verbatim (matching this
codebase's established "verbatim from source, never a paraphrase" philosophy); a field without one
renders exactly as it did before this fix, regression-tested to prove the merge is additive, not a
reformat.

**Verified live against a fresh fixture run through the actual `ingest_repo` → `generate_spec`
pipeline**, not just unit tests — a minimal Next.js app with one `POST /api/notes` route
reproducing the real idiom exactly (including the `try`/`catch` JSON-parse guard alongside the
field-validation guard). The generated contract doc correctly rendered
`` `name` — required (checked via: `!name`) `` and `` `message` — required (checked via:
`!message`) ``, additive alongside the pre-existing field-name list and the response
value-format-hint section from the earlier fix — nothing else in the doc changed.

**What this closes, and what it doesn't.** A rebuild agent reading this contract now has an
explicit, verbatim signal that `name` and `message` are required and how the original handler
checks for it — real information the pipeline gave zero signal about before. It does not close the
missing-validation gap in general: `&&`-joined rules, type/length/format validation, schema-based
validation (Zod and similar), and any validation performed in a delegated function in a different
file remain fully unaddressed, exactly the same "named, not silently skipped" discipline every
other scope decision in this document follows. The `notarybox` experiment's *other* named
divergence — the `201`-vs-`200` status-code miss, with no reconciliation signal to have caught it
— also remains untouched by this fix; it's a different kind of gap (an outcome-level assertion, not
a request-shape guard) and isn't addressed here.

## Resolving cross-file delegated response construction

Every response-side fix shipped before this one — `inferResponseBodyFields`,
`inferResponseValueFormatHints` — shared the exact same boundary: they only see a response literal
built directly in the route handler's own file. This was the single most-repeated limitation in
this document, named explicitly, twice, as deliberately deferred: "a response built by calling a
separate function (e.g. a data-layer helper) is invisible to it... a materially bigger, riskier
increment than same-file extraction." The real motivating app's own shape is exactly this —
`route.ts` calling `createNote()`/`listNotes()` from a `lib/db.ts` data layer — and it got **no
response-fields section at all** until now.

**Deliberately scoped to the response side only, not "cross-file resolution" in general.** The
real motivating app's request-side field extraction already works today — the handler destructures
`name`/`message` from the body itself before delegating — and its validation guard is also
same-file (the `notarybox` finding). Extending cross-file resolution to request fields or
validation rules would be speculative, not evidence-driven, so both are named as deferred future
work rather than spec-built ahead of a confirmed real gap.

**Design traced against seven real shapes via a throwaway Node script before any real code was
written**, matching the discipline used for every fix this session. `resolveDelegatedResponseFields.ts`:
detects a response call whose argument is a bare function call, not a literal
(`createNote(name, message)`, correctly never firing at all for the literal responses the existing
extractor already handles); searches the full file for a named import bringing that function into
scope, resolving an alias back to its real exported name; resolves only relative specifiers
(`./`, `../`) against the route file's own directory, trying standard extension and index-file
fallbacks — a bare package import (`from 'uuid'`) or a tsconfig path alias (`from '@/lib/db'`) is
correctly left unresolved, not guessed at; isolates the resolved function's body (`export function
name(...) {}` or `export const name = (...) => {}` with a block body); and unions fields across all
of its `return {...}` sites, the same accepted "combined, not distinguished by call path" risk the
same-file extractor already carries. A callee returning a bare array (the real `listNotes()`
GET-list shape) correctly yields zero fields, not a wrong guess — matching the existing, already-
accepted "bare variable/array response is invisible" limitation, now applied one file over.
Value-format hints trace against the *callee's own body*, not the caller's — this is what makes
`created_at: new Date().toISOString()`, declared inside `createNote()` itself, resolve correctly
with no parameter-name mapping needed across the call boundary at all, since the callee's return
statement already uses its own local names, self-contained.

**Live pipeline verification caught a real design gap immediately, not eventually.** All seven
traced cases and all twelve unit tests passed cleanly — then a live re-run against a fresh
two-file fixture through the actual `ingest_repo` → `generate_spec` pipeline came back with an
empty response-fields section where one was expected. The fixture's `createNote()` didn't `return
{...}` directly; it built the object in a local variable, pushed it onto an in-memory array as a
side effect, then returned the variable (`const note = {...}; notes.push(note); return note;`) —
an entirely realistic pattern (build, use for a side effect, then return) that every earlier traced
case had missed, since all seven used a direct literal return. **Not patched around or the fixture
quietly simplified to dodge it** — fixed at the design level: a bare `return someVar;` is now traced
back to its most recent local declaration in the same callee body, exactly the same one-level
aliasing discipline `formatHintForExpression` already applies to individual field values, just
applied to the whole return statement instead. Two new regression tests were added for this shape
(the build-then-return case, and confirming a chained alias — a return that traces to *another*
bare identifier — is still correctly not followed beyond one level), and the live fixture was
re-run afterward to confirm the fix, not assumed correct from the unit tests alone.

**Verified live, both routes of the same two-file fixture, through the real `ingest_repo` →
`generate_spec` pipeline.** The `POST` route (delegating to `createNote()`) correctly rendered all
four resolved fields, the `computed as:` hint for `created_at`, and an explicit note identifying
the cross-file resolution (`` *This route's response is built by calling `createNote()`, imported
from `lib/db.ts`...* ``) — transparent about where the claim actually came from, matching this
document's established "state a claim's source and confidence plainly" style. The sibling `GET`
route (delegating to `listNotes()`, which returns a bare array) correctly omitted the section
entirely, exactly as before — confirming the fallback is purely additive and doesn't misfire on the
shape it's still honestly unable to resolve.

**What this closes, and what it doesn't.** A rebuild agent reading this contract for a delegated
route now has real field-name and value-format signal it had none of before — closing the most
consequential, most-repeated gap named in this entire document. It remains single-hop only (a
callee that itself delegates to a third file is not followed further), relative-import-only (no
tsconfig path aliases), and scoped to the response side (request-field and validation-rule
cross-file resolution remain deferred, un-evidenced future work) — named limitations, not silent
gaps.

## Capturing the success-status signal, and a root-cause bug found only by using it live

This is stage 1 of a four-stage roadmap against the remaining v0 ceilings named at the last status
check: cross-file resolution's remaining edges, no mechanism for status-code correctness,
validation-rule detection covering only one guard shape, and real page-heavy apps producing mostly
weak/unrunnable page tests. Stage 1 targets the status-code gap specifically — the `notarybox`
experiment's other named divergence, alongside the missing-validation gap this document already
closed part of: the original app returns `201` on success, a blind rebuild's response defaulted to
`200`, and nothing in the pipeline had a mechanism to catch it. The generated smoke test's only
status assertion, `res.status < 500`, is satisfied by both.

**The precision problem this needed to solve, unlike every prior field/format/validation
extractor:** those are documentation-only, so a wrong guess costs nothing but a misleading contract
line. A status-code signal used to drive a *test assertion* is directly test-facing — a wrong guess
there fails a genuinely correct rebuild, the one thing every extractor this session has been built
to never risk. `inferSuccessStatusCode.ts` solves this by only ever producing a signal when there is
exactly **one** unconditional (non-guarded) response call in the handler; any ambiguity bails to no
signal at all. A response call is guarded when it's nested inside an `if`, `else`, or `catch` block
— recognizing `catch` specifically matters, since the real motivating shape
(`try { ... } catch { return ...400...; } if (!x) { return ...400...; } return ...201...;`) needs
both the parse-failure path and the validation path excluded to leave exactly one real candidate.
An explicit `.status(n)`/`{ status: n }` is read directly; no explicit status option is treated as
an implicit `200`, genuinely how both Next.js and Express behave, not a guess.

**Documentation and test-assertion integration are deliberately gated differently.** The contract
doc renders the confident success status unconditionally — even for a route with no extractable
fields at all, since the two signals are independent, and documentation carries no failure risk.
The **test assertion** is scoped narrower: only for a body-carrying method (POST/PUT/PATCH) with no
dynamic path segment in its route. This gate wasn't part of the original design — it came directly
from the live verification below, which is exactly why it's stated as a real, load-bearing finding
rather than a hypothetical worth naming in passing.

**Live pipeline verification, not the design or the unit tests, found why the narrower gate is
necessary.** A fixture built specifically to stress this stage included a `GET /api/users/:id`
route: `if (!user) { return ...404...; } return ...200...;`. Statically, this is exactly the
confident, unambiguous shape `inferSuccessStatusCode` is designed to recognize — `200` is genuinely
the only unconditional response in the source. But the generated smoke test's placeholder path
segment (`'test-value-123'`) has no relationship to whether a record actually exists, so the
generated request legitimately hits the `404` branch instead of the `200` one — asserting the
code's own success status here would have failed a real, correct implementation of this exact
handler. This is a fundamentally different risk than every prior extractor's "the placeholder body
satisfies simple presence checks" assumption, which holds for object fields but not for identifiers
looked up from a URL. Fixed by scoping the test-assertion path to routes where the placeholder
request can actually be trusted to reach the success branch — a body-carrying method with no
dynamic path segment — while leaving documentation unrestricted, since it carries none of that risk.

**The same live run surfaced a second, unrelated, more consequential bug — one that predates this
entire stage.** The same fixture's GET route's contract doc came back with no response-fields
section at all, including no success-status line, despite the source clearly having one. Direct
inspection traced this to `isolateHandlerSource.ts`, shared by *every* extractor built this
session: its handler-body isolation searched for the first `{` after the handler name's own opening
`(`, assuming that brace starts the function body. For `export async function GET(request, {
params }: { params: { id: string } }) {...}` — a standard Next.js App Router idiom for any dynamic
route — that first `{` belongs to the destructured `params` parameter, not the body. The isolator
had been silently returning `{ params }` (a two-token fragment) as "the handler body" for this
entire shape, for the whole session, undetected: no earlier fixture had combined a dynamic path
segment with actually reading real source from disk until this one did (the response-body-shape
fix's own dynamic-route test, for comparison, only ever checked generated-test placeholder text
against a nonexistent file, never real extraction). This means field-name, response-field,
value-format, validation-rule, and cross-file extraction have all been quietly degraded for this
common shape since the very first extractor shipped — not a new bug this stage introduced, but one
only this stage's specific live-verification path happened to trip.

**Fixed at the root, not worked around locally.** `isolateFunctionBody` now explicitly balances and
skips the parameter list's own parentheses before searching for the body's opening brace, instead of
assuming the first `{` it finds belongs to the body. Two dedicated regression tests were added
directly to a new `isolateHandlerSource.spec.ts` (no such direct test file existed before — the
module had only ever been exercised transitively through each extractor's own tests, none of which
happened to cover this shape): a destructured `{ params }` parameter, and the same with an inline
TypeScript type annotation. Re-ran the full suite (still green) and the live fixture again
afterward, confirming the contract doc now correctly shows `` **Success status:** `200` `` for the
previously-broken route.

**What this closes, and what it doesn't.** A rebuild agent now has an explicit signal for the exact
`200`-vs-`201` divergence the `notarybox` experiment found, for the shape of route that signal can
be trusted for. It remains same-file only (no cross-file success-status resolution, matching how
response-field extraction itself started); `for`/`while`/`switch` are not recognized as guards
(safe — more likely to look ambiguous than to produce a wrong answer, not a risk, just less
useful); and the test-assertion path is deliberately narrower than the documentation path, a real,
named scope decision, not an oversight.

## Broadening validation-guard detection: two more real guard shapes, one deliberately excluded

This is stage 2 of the four-stage roadmap against the remaining v0 ceilings. Stage 1 closed the
status-code gap; this one widens the missing-validation gap's coverage: the validation-rule
extractor built earlier this document recognized exactly one guard shape — a falsy check on a bare
or optionally-chained identifier (`!name`, `!name?.trim()`). `typeof x !== 'string'` and an explicit
`x.length === 0` equality-style empty check are two other real, common validation idioms that were
still completely invisible — a rebuild agent reading the contract for a route using either shape had
no signal at all that the field was constrained beyond simply being present.

**A real, deliberate return-type change, not string-sniffing in the renderer.** Rendering three
different clause wordings ("required" / "must be a string" / "must be non-empty") from the
extractor's previous plain-string return value would have meant re-parsing the same expression a
second time inside `generateContracts.ts`, duplicating the exact classification the extractor
already did — a discipline this codebase has avoided everywhere else (shared helpers, not
re-derived logic). The return type is now a small record per field:
`{ expression: string; kind: 'required' | 'type' | 'non-empty'; expectedType?: string }` — the raw
guard text is still always shown verbatim (unchanged philosophy), and `expectedType` holds the
literal type name captured from a `typeof` guard rather than hardcoding "string" for every case,
so a rebuild agent sees the actual constraint, not an assumption about what a `typeof` check
usually looks for. This is a contained, internal-only change — `generateContracts.ts` is the only
consumer — and all existing tests were updated to the new shape in the same pass, not left
inconsistent with it.

**Ten branch shapes traced against a throwaway script before any real code was written**, the same
discipline as the original guard-detection work: the existing bare-negation case confirmed
unaffected (regression-safe); a standalone `x.length === 0`; a standalone `typeof x !== 'string'`;
the alternate `x.length < 1` idiom; loose `!=`; a three-way `||` combining all three kinds in one
condition — the exact shape this stage exists for
(`if (!name || typeof message !== 'string' || tags.length === 0)`); an unrelated identifier not in
the known-fields set, confirming the existing cross-reference precision guard still applies
uniformly regardless of which pattern matched; and the positive-equality `typeof x === 'string'`
correctly not matching at all — the deliberately-excluded shape. Every case behaved as designed.

**Why the positive `typeof` check is excluded, not just unhandled.** `typeof x !== 'string'` as a
*rejection* guard reads naturally: "reject this request if the field is not the right type." Its
mirror, `typeof x === 'string'` used as a rejection condition, would mean "reject this request if
the field IS a string" — inverted, unusual logic that essentially never appears as real validation.
Recognizing it would risk mislabeling a rare, semantically different guard as an ordinary type
check. Named and excluded deliberately, the same discipline as the `&&`-exclusion from the original
guard-detection work, not an oversight this time either.

**Verified live** against a fresh fixture combining all three guard kinds in a single condition,
run through the real `ingest_repo` → `generate_spec` pipeline: the generated contract doc correctly
rendered `` `name` — required (checked via: `!name`) ``, `` `message` — must be a `string` (checked
via: `typeof message !== 'string'`) ``, and `` `tags` — must be non-empty (checked via: `tags.length
=== 0`) `` — all three clauses, additive alongside the stage-1 success-status line and the existing
response-fields section, nothing else in the doc disturbed.

**What this closes, and what it doesn't.** A rebuild agent now has explicit signal for two more
common, real validation idioms, not just simple presence checks. Zod and other schema-based
validation libraries remain fully invisible — a structurally different mechanism (recognizing a
schema object and its shape, not a bare guard clause) that would be a materially bigger, separately-
scoped increment, and still has no confirmed real motivating case in this project's own experiments.
`&&`-joined conditions and brace-less one-liners remain excluded too, unchanged from before this
stage.

## Resolving tsconfig path aliases: the most common of three remaining cross-file gaps, the other two still deferred

This is stage 3 of the four-stage roadmap, closing the most common of three cross-file gaps left
after "Resolving cross-file delegated response construction" shipped: tsconfig path aliases,
2+-hop delegation chains, and cross-file request-field/validation resolution. Rather than build all
three, this stage picks the one with real, common-enough justification and states plainly why the
other two stay out: `@/lib/...` is a near-universal Next.js convention — the
default alias in every `create-next-app` scaffold — while a 2-hop delegation chain or a validation
rule living in a separate file has no confirmed real example anywhere in this project's own
experiments. Building those now would be speculative, not evidence-driven, the same standard every
other deferred item in this document has already been held to.

**An addition to the existing resolver, not a new file or mechanism.** `resolveDelegatedResponseFields.ts`'s
`resolveModuleFile` used to only handle relative specifiers and bail on anything else. It's now
specifier-shape-aware: a relative specifier resolves exactly as before; a non-relative one is
checked against the repo's own `tsconfig.json` — read once, parsed defensively (a parse failure, or
no usable `compilerOptions.paths`, falls through to "not resolved" rather than crashing, the same
honest-bail-out discipline as every other extractor in this codebase). A wildcard pattern (`@/*`)
matches a prefix/suffix around the `*` and substitutes the captured segment into each candidate
target; an exact, non-wildcard pattern (`@utils`) matches only an exact specifier. Only the first
matching `paths` pattern is tried — TypeScript's own algorithm additionally prefers the
longest/most-specific prefix among several applicable patterns, which this doesn't attempt; a
named, accepted simplification, not an oversight.

**Ten realistic tsconfig/specifier combinations traced via a throwaway script before any real code
was written**, using real temporary directories and `existsSync` rather than pure string logic,
since this stage's whole point is filesystem resolution: a standard `@/*` alias resolving correctly
into a real file; no `tsconfig.json` present at all (unchanged `null`, exactly as before this
stage); a tsconfig with no usable `paths` key; a specifier matching no configured prefix; multiple
candidate targets for one alias where only the second actually exists on disk (TypeScript's own
"try each candidate in order" behavior, reasonably approximated); an exact, non-wildcard alias; a
non-default `baseUrl` (`"src"`) paired with a target lacking its own `./` prefix — a real,
alternate convention some repos use; a malformed, comment-containing `tsconfig.json` (real-world
JSONC, not strict JSON) correctly falling through rather than throwing; a bare package import with
unrelated aliases configured, still correctly unresolved; and a relative import confirmed
unaffected by tsconfig's presence at all. Every case behaved as designed — no surprises this time,
unlike the previous two stages, each of which had live verification catch a real gap the design and
unit tests had both missed.

**Verified live** against a fresh fixture with a genuine `tsconfig.json` configuring `@/*`, run
through the real `ingest_repo` → `generate_spec` pipeline: a route importing `createNote` via
`@/lib/db` (instead of a relative path) now resolves its fields, the `computed as:` format hint,
and the cross-file resolution note exactly as the existing relative-import fixture already does —
additive, not a reformat. A sibling route delegating to `uuid`'s `v4()` (a genuine bare-package
import, unrelated to the configured alias) still correctly renders no response-fields section at
all, confirming the new resolution path doesn't misfire on the case it's still honestly unable to
resolve.

**What this closes, and what it doesn't.** A rebuild agent reading the contract for a route that
delegates response construction through a `@/`-style path alias — now a common, not niche, shape —
has the same real signal a relative-import route already had. 2+-hop delegation chains and
cross-file request-field/validation resolution remain fully deferred, unaddressed by this stage;
`extends`-based tsconfig inheritance (a config that itself extends a base config for its real
`paths`) isn't followed either — only the repo-root `tsconfig.json`'s own `compilerOptions` are read
directly. All named plainly, not silently skipped.

## Fixing page capture, then actually diagnosing it: stage 4 found a bigger bug before it could answer its own question

This was meant to be the simplest stage of the four-stage roadmap: no code, just diagnosis. The
prior "real page-test generation" finding against `catchandtrade` had one number backing it up —
1 of 19 pages with a demonstrated content-driven mutation kill — and one aggregate guess at the
cause ("mostly because black-box capture with no session can't get past this app's auth gates").
The plan called for re-examining each of the 19 pages individually, not the aggregate, before
designing anything. That's what this section does — but only after an unplanned detour that turned
out to matter more than the original question.

### The detour: page capture was completely broken, and the auth theory couldn't even be tested

A fresh diagnostic run — re-ingesting `catchandtrade` and re-running the real capture + mutation-
check pipeline from scratch — came back with `capturedPages: 0`. Not some pages. All 19, every one
failing with the identical error: `page.evaluate: ReferenceError: __name is not defined`, thrown
from inside `extractStylesheetAnimations`.

**Traced to a real, general, previously-undiscovered bug, confirmed with a minimal reproduction
completely outside this codebase before touching any real code.** A bare Playwright script —
`page.evaluate(function outer() { function inner() { return 1; } return inner(); })`, nothing to do
with this project at all — throws the identical error. The cause: `tsx`'s transform (the actual
runtime this MCP server runs under — `"start": "tsx src/index.ts"` in `package.json`, not a
`tsc`-compiled build) wraps any nested function declared inside a function passed to
`page.evaluate`/`page.addInitScript` with a call to a `__name(fn, "name")` helper, used to preserve
`.name` across the transform. That helper is defined once, at the top of this module's own
compiled output — but `page.evaluate`/`page.addInitScript` only ever serialize the *one* passed
function's own text (`Function.prototype.toString()`), so the helper's definition never makes it
into the isolated browser realm that text actually executes in. The reference throws the moment the
inner function is declared.

`extractStylesheetAnimations` has exactly this shape (a nested `matchesLiveElement`), which is why
it was the one that surfaced in the error. But tracing this further turned up something more
consequential: `injectAnimationNeutralizingOverride` — the animation-settling `addInitScript`
callback shipped earlier this session — has the identical shape (a nested `inject` arrow). An
`addInitScript` failure doesn't propagate the way a failed `page.evaluate` call does, so this had
likely been failing *silently* the entire time since it shipped: the CSS neutralizing override may
never have actually been applying, with nothing anywhere surfacing that it wasn't. Confirmed the
scope is genuinely general, not one extractor's quirk, by grepping the whole codebase — every
`page.evaluate`/`page.addInitScript` call lives in this one file, and both of its passed functions
have exactly this nested-function shape.

**Fixed by neutralizing the missing reference, not by avoiding the syntax that triggers it** —
traced first, since the fix wasn't obvious: a nested arrow function bound to a `const` triggers the
identical error (not just `function`-keyword declarations), and a hand-written `__name` polyfill
*defined inside the same evaluated function* gets wrapped by the exact same transform, an infinite
regress. The fix that actually works: inject `window.__name = window.__name || ((fn) => fn);` via
`page.addInitScript` as a **plain string**, registered before any other `addInitScript`/`evaluate`
call — a string is never itself subject to tsx's function-transform, since it isn't parsed as this
module's own code at all, just handed to the page verbatim. Verified against a minimal single-page
fixture (`capturedPages: 0 → 1`) and then the full `catchandtrade` re-run
(`capturedPages: 0 → 19`, `skippedPages: []`, for every page).

**Not covered by a vitest regression test — confirmed directly, not assumed, that it couldn't be.**
A quick check of `withNestedFunctionForTest.toString()` run *through vitest's own transform*
showed clean, unwrapped source — no `__name` call anywhere. Vitest's toolchain doesn't reproduce
this bug at all, so a vitest-based test would either pass trivially regardless of whether the fix
is present, or could never fail meaningfully either way — an early draft of exactly such a test was
written, found to do neither job, and removed rather than left in as false confidence. Same category
as this codebase's existing `next dev` process-group-leak bug: a real environment/tooling mechanic
that requires a live pipeline re-run to verify, not something a unit test can stand in for.

### The actual diagnosis, now that capture works: not one cause, several

With real captures finally in hand, the per-page picture is meaningfully more precise — and more
mixed — than the earlier aggregate "mostly auth-gated" framing suggested:

- **An in-place render-time gate, not a redirect, turned out to be the more common pattern —
  corrected after an initial misdiagnosis, not assumed.** `portfolio`, `portfolio/search`, and
  `collection` all captured their *own* real, page-specific fallback content ("Please login to view
  your portfolio.", "Please login to add cards to your portfolio.", "Browse all available Pokemon
  card sets"). The first write of this section guessed these were the same
  `window.location.href`-redirect shape as `watchlist`/`onboarding`, just caught mid-transition by a
  capture-order race against Next dev's on-demand compilation — plausible-sounding, and wrong.
  Building the fix for that race (see "Waiting for redirects to settle," below) and then
  re-verifying live against the real app directly disproved it: the fix changed nothing about these
  pages' captured content, because there was no redirect to race in the first place. Direct
  instrumentation of the real source confirms why — `portfolio`'s component body has a synchronous,
  render-time early return (`const token = localStorage.getItem('token'); if (!token) { return
  <...Please login...>; }`), never reaching the separate `useEffect`-called function that contains
  the `window.location.href` string the earlier source-grep had found and misattributed to this
  branch. Still weak, all three, but for the same reason as before: the mutated business logic
  lives in the authenticated
  branch this state never reaches — not because the content is generic or missing.
- **A genuine `useEffect`-driven redirect does exist, for a different page.** `watchlist` has no
  early-return gate at all — its only handling is `useEffect(() => { if (!token)
  window.location.href = '/login'; ... }, [])` — and its capture correctly shows the real `/login`
  page's content. `onboarding` matches this same shape. This is a real, different pattern from
  `portfolio`'s, not two timings of the same one.
- **A fully public page is weak for a reason that has nothing to do with auth at all.** `grading`
  (no token check anywhere in its source) captured its full, real content — the ROI calculator's
  labels, tiers, and the already-documented `GRADE_VALUES` classifier gap. It's weak because its
  actual calculation logic only runs after a button click ("Calculate ROI") that a static,
  no-interaction Playwright capture never performs, not because of anything auth-related.
- **A live API failure during capture got asserted as if it were expected content.** `marketplace`'s
  captured body includes `"Failed to load cards"` — the page's live data fetch failed at capture
  time, and that failure state is now the literal, asserted baseline. A rebuild whose fetch
  succeeds would fail this assertion by behaving *better* than the captured original — a real,
  narrow risk distinct from every other cause named here.
- **Already-documented causes, reconfirmed, not newly discovered:** `root` and `marketplace` still
  reproduce the comma-formatted-live-number classifier gap; `legal-terms`, `legal-privacy`, and
  `scan` still have zero applicable mutation sites; `watchlist` is still the one page with a real,
  confirmed kill (an SSR-crash-inducing mutation, unrelated to which content variant its own capture
  happened to show). `callback` — reading its token from a URL query string rather than
  `localStorage` — correctly shows its own real "Authentication Failed / No token provided" state
  when captured with no query params: a genuinely correct result, not a problem to fix.

**What this settles, and what it deliberately doesn't yet.** The `__name` bug fix is unambiguous
and shipped. The diagnosis is not: it shows the "mostly auth-gated" explanation was too coarse,
real, and not wrong, but incomplete — the actual causes span at least three genuinely different
mechanisms (an in-place render-time gate whose authenticated branch a static capture never reaches,
interaction-gated logic, and a transient-failure-baked-into-baseline risk), each of which would need
a different fix, if any is warranted at all. (A fourth, a genuine `useEffect`-driven redirect, is
also real, but — see "Waiting for redirects to settle" below — turned out not to be racing anything
observable on this app.) Matching this document's own standing discipline: the fix that was clearly,
mechanically necessary shipped now; what (if anything) to build next is deliberately left an open
question for the next planning pass, not assumed from here.

## Waiting for redirects to settle — a fix that's correct but disproven as the cause it was built for

Stage 4's diagnosis named a specific, plausible-sounding theory: `portfolio`/`portfolio/search` and
`watchlist`/`onboarding` all share the identical `if (!token) { window.location.href = '/login';
return; }` shape, yet captured two different outcomes — some pages their own transitional,
pre-redirect content, others the real destination `/login` page. The suspected cause was a
capture-order race against Next.js dev-mode's on-demand route compilation: whichever page hit a cold
compile of `/login` first would be caught mid-transition; later pages, with `/login` already warm,
would redirect in time. This section is what happened when that theory was actually tested, not
just asserted.

**The fix was designed and traced properly, and it works — for the bug it targets.**
`page.goto(url, { waitUntil: 'load' })` only waits for the *requested* navigation; a redirect fired
later from a mounted `useEffect` is a separate navigation nothing previously waited for.
`waitForRedirectsToSettle` explicitly waits for the URL to stop changing (with a bounded hop count,
so a genuine redirect loop can't hang capture) before anything reads the DOM. The obvious first
choice — reusing `ANIMATION_SETTLE_WAIT_MS` (1500ms) as this same detection window — was traced
against a real Chromium instance before being accepted, and rejected: a redirect fired after an
800ms delay (simulating hydration + a mounted effect) combined with a 2500ms server-side delay
(simulating a cold Next-dev compile) is still missed at 1500ms. A dedicated 5000ms window correctly
waits out the same combined case. Baked into the generated test's own template too, matching the
existing `ANIMATION_SETTLE_WAIT_MS` precedent, so a rebuild reproducing the same redirect doesn't
fail the generated test by racing the same window differently. Unlike the `__name` bug, this one is
genuinely testable — `waitForRedirectsToSettle` is normal Node-side code, never serialized into a
browser realm, so five real-Chromium test cases (no redirect, a delayed redirect, the combined
delayed-effect-plus-slow-server case, a chained 2-hop redirect, and a long chain proving the hop
bound actually stops following it) all pass.

**Then the live re-verification — the same standard every fix in this document has been held to —
found the fix changed nothing on the app that supposedly motivated it.** Re-running the real
pipeline against `catchandtrade` with the fix in place produced byte-identical captured content for
`portfolio`, `portfolio/search`, `watchlist`, and `onboarding` — before and after. That result alone
was enough to stop and check instead of accepting a plausible non-result. Direct instrumentation
(a real browser, logging every URL change, console message, and network request against the actual
running app, not a synthetic reproduction) showed why: over an 8.5-second observation window,
`/portfolio`'s URL never changed at all. The "Please login to view your portfolio." text is the
page's genuine, final, correctly-settled content, not a transitional state caught mid-flight.

**Reading the actual source explains it precisely, and reveals the original diagnosis's mistake.**
`portfolio/page.tsx`'s component body has a synchronous, render-time early return:

```ts
const token = localStorage.getItem('token');
if (!token) {
  return <div>...Please <a href="/login">login</a> to view your portfolio.</div>;
}
```

The `window.location.href = '/login'` string the original diagnosis found *does* exist in this
file — but inside `fetchPortfolios`, a separate function called from a separate `useEffect`. The
early return above means that branch's JSX — the actual, final rendered page — never depends on
`fetchPortfolios` running at all. `portfolio/search` has the identical shape. `watchlist`, by
contrast, has no early-return gate anywhere; its *only* handling of a missing token is directly
inside a mounted `useEffect` that calls `window.location.href = '/login'` unconditionally — which is
exactly why its capture correctly reaches the real destination page. These were never two timings of
one race. They're two different, both entirely correct, code patterns — the same category
distinction as `collection`'s in-place conditional, not a new one.

**What this leaves standing, and what it corrects.** The redirect-settling fix itself is not wrong
or wasted — it closes a real bug class (a genuinely delayed client-side redirect racing a fixed
timeout), traced and verified independently of this app, and is a reasonable, defensive improvement
to keep for a target app that actually has that shape. What's corrected is the specific claim in the
section above: the "capture-order nondeterminism" explanation for `catchandtrade`'s
`portfolio`-vs-`watchlist` split was plausible and wrong, not merely unconfirmed — verified wrong,
by building the fix its own theory implied and watching it change nothing. `portfolio`,
`portfolio/search`, and `collection` belong in the same bucket (an in-place render-time gate whose
authenticated branch a static, unauthenticated capture never reaches) — one mechanism, not two.
Left deliberately open, same as before: whether anything further is worth building for the
remaining named causes (interaction-gated logic, the transient-failure-baked-into-baseline risk) is
still a question for the next planning pass, not something this correction answers on its own.

## Detecting interaction-gated content, without touching the page

Stage 4's diagnosis named a fourth, auth-unrelated cause for a weak page test: `grading`'s real ROI
calculation only runs after a button click ("Calculate ROI") that this pipeline's static,
no-interaction capture never performs, so mutating that calculation has zero effect on the generated
test. Unlike every other fix in this document, closing this gap for real would mean the tool
*acting* on an arbitrary target page, not just observing or timing it more carefully — a
categorically different kind of change, and one worth pausing on rather than designing straight
through.

**The interactive option was considered and explicitly rejected, not simplified away.** A
click-simulation approach — detecting a plausible "action" button and clicking it during capture —
was a real candidate. It was rejected because simulating a click against an arbitrary, unknown
target app crosses into the same risk category this environment's own safety rules gate behind
explicit human permission: submitting a form, clicking an irreversible action control. An
allowlist/blocklist on button text ("calculate," "preview" vs. "delete," "submit," "pay") is a
heuristic, not a guarantee, and this tool runs fully automated against real target apps with no
human in the loop at click-time to catch a wrong guess. Confirmed directly with the user before
designing anything further, choosing static detection over the interactive alternative.

**The detectable signal, traced against the real shape before writing code.** Not "does this page
have a button with an onClick handler" — true of nearly every interactive page, far too broad to be
useful. The real, confirmed shape is more specific: a button whose click sets React state that some
*other* part of the same file conditionally renders on —

```tsx
const [showResults, setShowResults] = useState(false);
<button onClick={() => setShowResults(true)}>Calculate ROI</button>
{showResults && (<div>...results...</div>)}
```

— confirming real content is gated behind the click, not an inert state toggle with no visible
effect (e.g. an analytics-only flag). `inferInteractionGatedElements.ts` maps every `useState`
declaration to its setter, isolates each `<button>`'s `onClick={() => ...}` body via brace-depth-
aware tag scanning (a naive `[^>]+` regex breaks the moment an attribute expression contains its own
`>`, e.g. a ternary comparison — traced and confirmed necessary before shipping), finds which known
setters it calls, and keeps only the ones that *also* appear in a `{stateVar &&`/`{stateVar ?`
render gate elsewhere in the file. That cross-reference is the precision guard — directly analogous
to `inferRequestValidationRules`'s known-field cross-reference — that stops a harmless state toggle
from being misreported as gated content.

**Nine cases traced before any real code was written, all correct**: the real `grading` shape
(flagged); a state variable set but never gated anywhere else, an analytics-only toggle (correctly
not flagged); a plain button with no `onClick` at all (not flagged); a button whose `onClick`
references a separately-defined handler by name rather than an inline arrow (correctly out of
scope — not traced into, a named limitation, not an oversight); two buttons where only one gates
real content (only that one flagged); one `onClick` setting two state variables where only one is
gated (only the gated one reported); a ternary-gated conditional, not just `&&` (also flagged); a
`selectedService`-style state variable used only inside an inline styling comparison, never in a
`{var &&`/`{var ?` render gate (correctly *not* flagged — proving the cross-reference is precise,
not just "state variable mentioned anywhere"); and a condition containing a nested call with its
own parens (proving the brace-depth-aware tag isolation is genuinely necessary, not a nicety).

**Verified live**, not just via unit tests: a fresh fixture reproducing the exact `grading`-shaped
pattern (a button setting state that reveals a results block), run through the real `ingest_repo` →
`generate_spec` pipeline. The generated contract doc correctly rendered the new section —
`` `Calculate ROI` — gates content rendered when `showResults` is set `` — while a sibling static
page with no such pattern rendered nothing extra, confirming the addition is purely additive.

**What this closes, and what it deliberately doesn't.** A rebuild agent reading this contract for a
page like `grading` now has explicit, honest signal that some of its content is real but
unverified by the generated test — a plain instruction to check that page's behavior manually,
rather than silent, undocumented blindness. It remains scoped to an inline `onClick={() => ...}`
arrow only (a named handler referenced by reference, e.g. `onClick={handleClick}`, is not traced
into), to `<button>` elements only (not `<input type="submit">`, `role="button"`, or other
elements), and — the whole point of this stage's design decision — never attempts to actually
verify the gated content by interacting with the page. That gap stays open, by choice, not by
oversight.

## Closing the auth-gate capture gap: a storageState fix, and the port-mismatch bug tracing it caught before shipping

Stage 4's diagnosis against the real, auth-heavy catchandtrade app found that only 1 of 19 pages had
a demonstrated, content-driven mutation kill — the rest were weak, unrunnable, or never reached at
all, mostly because black-box capture with no session can't get past most of this app's auth gates.
Closing that gap for real means the capture pipeline needs an authenticated session, and — as with
the interaction-gated-content fix earlier — there are two very different ways to get one.

**The safe direction was chosen deliberately, not assumed.** Simulating an automated login (filling
a username/password and submitting the form) was a real candidate, and was rejected the same way
click-simulation was: it means the tool entering credentials and submitting a form against an
arbitrary, unknown target app, with no human in the loop to catch a wrong guess. The fix instead
accepts an optional, user-supplied Playwright `storageState` — a JSON file of cookies/localStorage
from a session the user authenticates once, out-of-band (`npx playwright open <url>
--save-storage=state.json` after logging in by hand, or any equivalent one-time export) — and loads
it into the browser context before capture. The tool never sees a password, never fills a login
form, and never submits anything.

**A second fork, also resolved deliberately**: the generated page tests (emitted into the rebuild
output, run standalone later) need the same authenticated session to actually reach gated content
when run on their own. The chosen approach copies the storageState file into the output tree
(`tests/fixtures/auth-storage-state.json`) and writes a `.gitignore` entry alongside it immediately,
rather than requiring an env var at test-run time that most people running the tests later wouldn't
know to set — self-contained, at the cost of a live session-cookie file sitting on disk in the
output tree, mitigated (not eliminated) by the gitignore entry.

**A real, load-bearing bug was found by tracing the design before writing code, not by shipping and
discovering it live.** Playwright's `storageState` "origins" entries are matched by exact origin
string — protocol, host, *and port*. Cookies are host-scoped, not port-scoped, so a cookie captured
against `localhost:ANY_PORT` applies regardless of which port a later run's dev server happens to
land on — but `localStorage` genuinely is origin-scoped including port, per the browser's own
same-origin policy. This tool's dev server picks a fresh random port on every single `generate_spec`
call, specifically to avoid collisions — which means a `storageState` captured once, in advance,
against whatever port that capture session happened to use would never origin-match a later run's
port. Every `origins[]` entry would silently fail to apply — no error, capture landing right back on
unauthenticated content, looking exactly like "the fix didn't help" rather than "the port doesn't
match." This would have been especially damaging here because the real motivating case —
catchandtrade's `portfolio`/`portfolio-search` pages — gates on `localStorage.getItem('token')`, not
a cookie, so the one auth mechanism this feature exists to support would have been the one it
silently failed to fix.

**Fixed by remapping, not by fixing the port.** `resolveAuthStorageState(path, baseUrl)` reads the
caller's file and rewrites every `origins[].origin` to the current run's actual `baseUrl` before
handing it to Playwright — safe unconditionally, since every route this tool ever captures belongs
to the same single, locally-spawned dev server; there is never a second, genuinely different real
origin in play. The same remap has to happen a second time, independently, inside the generated
test's own template: that test computes its own fresh random port at run time, entirely
independent of whatever port the original capture used, so the copied fixture's baked-in origin
needs the identical rewrite, inlined as plain JS in the generated file (the same pattern this
codebase already uses for `waitForRedirectsToSettle`'s dual implementation).

**A second, independent subtlety, also traced before shipping**: `runMutationCheck`'s scratch-copy
mechanism (`prepareScratchCopy`) builds its throwaway test directory from the *original target
repo's own tree* — not the separate rebuild output directory the storageState fixture gets copied
into. A generated page test's reference to `tests/fixtures/auth-storage-state.json` (relative to its
own `import.meta.url`) would resolve to a path that never gets created inside that scratch copy,
making every auth-enabled page test register as unrunnable during mutation-check — the opposite of
what supplying `authStorageStatePath` is for. Fixed by threading the same path through
`runMutationCheck`/`prepareScratchCopy` and copying the fixture into every scratch dir whenever it's
set, unconditionally (a tiny file; tracking per-target usage wasn't worth the added complexity).
Verified with a positive/negative pair: a hand-authored test asserting the fixture's presence
registers as unrunnable when `authStorageStatePath` isn't passed, and passes cleanly when it is —
proving the assertion is real, not vacuous.

**Verified live end-to-end**, not just via unit tests: a fresh fixture reproducing the exact
catchandtrade `localStorage.getItem('token')` early-return shape, captured once via Playwright
against a fixed port, exported to a real `storageState.json`. A baseline `generate_spec` run with no
`authStorageStatePath` correctly captured "Please login to view your portfolio." Re-run against the
same fixture with `authStorageStatePath` set — this time against a *different*, randomly-chosen port
than the one the storageState file was originally captured against — correctly captured the real
authenticated content ("Your portfolio: AAPL 10 shares, TSLA 5 shares, balance $4,821.00.")
regardless of the port mismatch, confirming the remap fix rather than assuming it from the design.
The contract doc rendered the new "Auth session" note; `.gitignore` and the copied fixture were both
present in the output tree; `runMutationCheck` reported the page test as neither weak nor
unrunnable. Copying the fixture's own real app source into the rebuild output and running `npm test`
standalone (a third, independent random port) passed cleanly, closing the loop a rebuild agent would
actually exercise later.

**What this closes, and what it doesn't.** This directly answers one of the two open items the
auth-gate finding left on the table: a second, less auth-gated real app for page-generation is still
unattempted, and the weak/unrunnable-unblocks-a-page tension (79% vs. 50%) is untouched by this fix
— it addresses *why* black-box capture couldn't reach gated content, not whether an unblocked-but-
weak test should carry write-permission the same way a strong one does. The tool still never logs in
itself, by design — a caller who can't produce a `storageState` export has no path to authenticated
capture through this feature, and that's the deliberate boundary, not a placeholder for a future
version.

## Validating the auth-gate fix against the real catchandtrade app: real data reached, two more real gaps found along the way

The storageState fix above was designed and verified against a fixture built to reproduce
catchandtrade's exact `localStorage.getItem('token')` gate — necessary to trace the port-remap bug
before shipping, but a fixture built to match a fix is a weaker test than the real app the fix was
actually motivated by. This re-runs it against catchandtrade itself.

**Setup, without touching any credential or login form.** A local Postgres instance was stood up
(matching the app's own `docker-compose.yml` port/credentials), the schema pushed via Prisma, and
the catalog seed script run. A real `User`/`Portfolio`/`PortfolioItem` row was inserted directly via
Prisma — a real database record, not a UI-driven signup — with one seeded card (Charizard, Base
Set, 3x, NEAR_MINT, $120.50 purchase price). A session token was then minted directly via the app's
own `auth.ts` signing function, using the same secret its dev config already defines — never through
a login form, never handling a real password. This mirrors the tool's own "never log in itself"
design applied to the verification process too, not just the shipped feature.

**A real, pre-existing quirk in the target app's own token handling, found along the way.**
catchandtrade's real login endpoint signs a JWT via `generateToken`, but `/api/portfolios`'s own GET
handler decodes tokens with a completely different, legacy `base64(userId:x)` scheme — a real,
pre-existing inconsistency in the target app itself, unrelated to rebuild-dossier, discovered only
because this verification exercised the full authenticated data-fetch path for the first time. A
real JWT (matching what login actually issues) authenticates fine at the page's render gate but
returns zero portfolios from this specific endpoint; a token in the endpoint's own expected legacy
format returns the real seeded data. The legacy-format token was used for the rest of this
verification, since it's what this specific route actually honors — not a workaround invented for
this test, but the format the app's own code already expects here.

**First full run: real content reached, but empty.** With a real (legacy-format) session and
`authStorageStatePath` set, `generate_spec` against the real 83-route app (368 mutation sites
checked) correctly captured the portfolio page's authenticated shell — real nav ("Marketplace,"
"Portfolio," "Collection," "Watchlist," "Log out"), not the anonymous "Please login" wall — but the
portfolio content itself showed "Your portfolio is empty," not the real seeded card. Traced
directly: the app's own `.env.development` hardcodes `NEXT_PUBLIC_API_URL=http://localhost:3003`,
baked into the client bundle at dev-server start. The page's own client-side `fetch` call target's
that fixed origin regardless of which port this tool's own randomized dev-server spawn actually
used for this run — an entirely separate capture-environment gap from the storageState fix itself,
affecting any page whose client fetches use an absolute, non-relative API host, auth or not. Never
surfaced before this verification because `portfolio`'s render gate previously blocked capture
before ever reaching this fetch at all.

**Confirmed directly, not assumed**: blanking `NEXT_PUBLIC_API_URL` (so the fetch falls back to a
relative path, resolving against whatever origin actually served the page) made a standalone
Playwright capture — bypassing `generate_spec`'s own mutation-check cost — show the real data
immediately: `Charizard`, `Base Set`, `NEAR MINT`, the real purchase price. A second full
`generate_spec` run with this env fix in place captured the same real content through the actual
pipeline, not just a targeted script: the generated test's own assertions include `"Main
Collection"`, `"Charizard"`, `"Base Set"`, `"Rare Holo"`, `"NEAR MINT"`, and a dynamic-currency
match for the real price — a genuinely richer, real-data assertion set no capture against this app
had produced before.

**The honest remainder**: in that same corrected run, `PAGE-portfolio.page.spec.ts` still landed in
`unrunnableTests` in the official mutation-check summary. Rather than accept that at face value,
the exact vitest failure was captured directly (a temporary, reverted debug hook on
`runMutationCheck.ts`'s otherwise-silent `catch` block, not a permanent change) — `AssertionError:
expected 1 to be less than or equal to 0`, the console-error-tolerance assertion, not a content
assertion. Every content assertion in the file — including the real Charizard/NEAR MINT/Base Set
lines — was never reached as failing; the test fails earlier, on one console error the
mutation-check's isolated scratch-copy re-run produced that the original capture run didn't. This
is a pre-existing, accepted limitation of the console-error-tolerance mechanism (documented
elsewhere in this project as tolerating the *same* count, not a looser bound) — not a defect in the
storageState fix, and not something any prior run against this app could have surfaced, since no
earlier capture ever got past the login wall into content noisy enough to trigger it. Left
unfixed, deliberately: chasing a likely `.next`-cache-warmth-driven console-noise difference between
a first-capture dev server and a fresh mutation-check scratch copy is a real, separate investigation
of its own, out of scope for verifying whether the auth-gate fix itself reaches real content — which
it demonstrably does.

**Cleanup.** The local Postgres instance was stopped after this verification; the seeded
verification user/portfolio and the `web-authverify`/`web-authverify-rebuild` scratch copies were
removed. Nothing from this verification was left running or committed against the real
catchandtrade checkout.

## A general fix for hardcoded local API URLs, verified against catchandtrade with no manual workaround

The prior section's real-catchandtrade validation reached real authenticated content only after
manually blanking `NEXT_PUBLIC_API_URL` in a scratch copy — a workaround, not a fix. This closes
that gap for real.

**The bug, restated precisely.** Next.js inlines every `NEXT_PUBLIC_*` env var it can find into the
client bundle at `next dev` start time, not just the ones a given page happens to read at request
time. catchandtrade's own `.env.development` hardcodes `NEXT_PUBLIC_API_URL=http://localhost:3003`;
its portfolio page fetches via `` `${API_URL}/api/portfolios` ``. This tool's own dev server picks a
fresh random port on every single `generate_spec` call, specifically to avoid collisions across
concurrent runs — so the client bundle's baked-in `http://localhost:3003` almost never matches
whichever port the tool's own spawned instance actually landed on for this run. The fetch either
hits nothing or hits an unrelated process, and the failure is silent: `fetchPortfolios`'s own
`catch (err) { console.error(...) }` swallows it, leaving the page's state empty with no visible
error. This is not an auth-specific bug — a fully public page whose data comes from a fetch through
the same hardcoded var would hit the identical wall. It was never seen before only because
`portfolio`'s own auth gate blocked capture from ever reaching this fetch at all.

**The fix, and why it doesn't touch the target app's own files.** `resolveLocalApiUrlOverrides(repoPath,
baseUrl)` scans `.env`, `.env.local`, `.env.development`, and `.env.development.local` (Next.js's
own convention for which dotenv files it loads, and in what order) for any line matching a
`NEXT_PUBLIC_[A-Z0-9_]+=` key whose value already starts with `http://localhost:` or
`http://127.0.0.1:`. For every match, it returns an override mapping that key to this run's actual
`baseUrl`. That mapping gets merged into the spawned `next dev` child's own `env` option
(`{ ...process.env, ...overrides }`) — Next.js (like dotenv generally) always lets an
already-present `process.env` value win over anything a `.env*` file would otherwise set, so passing
the override this way is sufficient; nothing in the target repo's own files is read back, parsed for
correctness, or rewritten.

**Deliberately conservative, traced against the real risk before shipping.** Only `NEXT_PUBLIC_*`
keys are touched — a server-only var never needs this, since server-side code executes inside this
same spawned process rather than a separately-addressed client bundle, so relative addressing was
never the concern there. And only a value *already* pointing at `localhost`/`127.0.0.1` is
overridden — a `NEXT_PUBLIC_*` var pointing at a real external host (a staging API, a real
third-party service) is left completely untouched, since rewriting that would be actively wrong, not
just unhelpful, and there is no way to tell "this should track my own dev server" apart from "this
is an intentional external target" other than the value already being a local one. Traced cases,
unit tested directly: a hardcoded localhost URL (overridden); the identical shape via `127.0.0.1`
(overridden); a quoted value (still matched); a commented-out line (correctly ignored); a
non-`NEXT_PUBLIC_` server-only var pointing at localhost (correctly left alone); a real external host
(correctly left alone); the same key present in more than one `.env*` file (deduped to one override);
and multiple distinct keys across multiple files (all collected).

**Wired into both places that spawn a dev server for a capture-fidelity fix to actually apply
everywhere it needs to**: the live capture phase in `generatePageTests.ts`, and the shared
`devServerBoilerplate()` used by every generated page test and gate test. The second one has to be
inlined as plain JS text, not imported — the generated output is its own, separate npm project with
no dependency on rebuild-dossier itself, the same reason a couple of other capture-fidelity fixes in
this codebase are also duplicated as inlined strings rather than shared function calls. One
incidental snag caught immediately by the existing test suite, not shipped silently: this new
function's own doc comment happened to mention a word ("storageState") that an existing, correctly
strict test was checking never appears in a generated test that doesn't use auth — reworded the
comment rather than weaken that test's real intent.

**Verified live, with no manual workaround this time.** The same real catchandtrade app was re-run
end to end — fresh Postgres, the same seeded user and portfolio, the same legacy-format session
token — but this time against a completely unmodified checkout, `NEXT_PUBLIC_API_URL` still
hardcoded to `http://localhost:3003` exactly as the app's own repo has it committed. The generated
portfolio page test's body assertions included the real seeded data automatically — `"Charizard"`,
`"Base Set"`, `"NEAR MINT"`, `"Main Collection"`, a dynamic-currency match for the real price — with
no env edit, no scratch copy, no manual intervention of any kind. The mutation-check classified this
test as weak rather than unrunnable this run (an improvement over the prior run, though not a
demonstrated kill) — consistent with this codebase's own already-documented mutation-kill caveat for
page tests (generic mutators can land in code with no connection to what a page's generated test
actually asserts on), not a new problem this fix introduced.

## A second real app finds the weak-test-unblock erosion at 100%, not 79%

The catchandtrade run flagged a real, deliberately unresolved tension: weak/unrunnable page tests
still unblock a page's write-permission the same way weak API-route tests already do, measured at
79% (15 of 19 pages) — high enough to notice, not a settled decision just because it matches
existing precedent. This checks whether that number holds, worsens, or was somehow specific to one
auth-heavy app, on a completely different, genuinely blind third-party app.

**The app, chosen with no prior knowledge of its shape.** [Awis13/qr](https://github.com/Awis13/qr)
is a 9-page Next.js QR-code generator — no API routes at all, no authentication, no backend, nine
static-looking form pages (`/url-qr-code`, `/wifi-qr-code`, etc.) plus a root landing page. Cloned
fresh, `npm install`ed, and run through the real `ingest_repo` → `generate_spec` pipeline with no
modification.

**The result, confirmed directly, not assumed from the app's shape.** `generate_spec`'s own report
showed all 9 captured pages' generated tests landing in `unrunnableTests`, 0 mutation sites checked.
`spec/untested-contracts.json` came back completely empty (`[]`). Read directly, not guessed:
`spec/test-dependencies.json` shows every one of the 9 `tests/weak/PAGE-*.spec.ts` files mapped, via
`coveredRouteFiles`, to its own route file — `writeSpecTree.ts`'s own `computeUntestedContractFiles`
call is built from exactly this mapping, and marks a route "covered" the moment *any* test claims it
this way, regardless of whether that test is weak, unrunnable, or ever demonstrated a real kill. Nine
pages, nine claims, zero real verification behind any of them, and the untested-contracts list —
whose entire purpose is withholding write-permission until a test demonstrably covers a route — has
nothing left to withhold.

**Why this is a sharper finding than another confirming run on catchandtrade, not the same confound
wearing a new face.** On catchandtrade, the open question was about *model behavior*: would a
compliant model ever actually attempt to exploit weak coverage, given the chance. Here the question
resolves before any model is even involved — an ablation of contract-locking enforcement on this app
would produce an identical result with or without the plugin installed, on any model, because the
mechanism the plugin enforces (block a write to an untested contract) has nothing left to trigger on
once every contract already reads as "tested." This is a structural gap in the coverage-computation
logic itself, not a question about whether a model chooses to exploit a known gap.

**What this changes about the open design question, and what it doesn't.** The number moves from
"worth reconsidering at 79%, on one auth-heavy app" to "worth reconsidering at up to 100%, confirmed
on a second, structurally different, genuinely blind app" — a stronger citation for the same
already-named tension, not a new one. It does not, by itself, tell you which fix is correct (requiring
at least one real mutation kill before a page counts as "tested" is the most direct option named
earlier, but narrowing it that far risks under-crediting pages whose real logic the mutation engine
simply can't reach for unrelated reasons — the same capture-reach limitation already documented for
auth-gated pages). Left unresolved deliberately, same as before — this section exists to sharpen the
evidence behind the open question, not to unilaterally resolve it.

**What this rules out for the model-behavior question still open.** A contract-locking ablation was
prepared against this app before this finding was confirmed, then deliberately not run once
`untested-contracts.json` was checked and found empty — running it anyway would have produced a
guaranteed, uninformative "no difference between conditions" result for a reason that has nothing to
do with model behavior, wasting real trial time to confirm a number already known from a single file
read. The genuinely open question — whether a weaker model, given real rail-2 surface to exploit,
ever actually attempts to (the thing DeepSeek's own dry run did not do, leaving that question
unresolved rather than answered) — remains open, and is being pursued next on an app confirmed to
have real, non-empty untested-contracts surface.

## The coverage-computation gap is structural, confirmed a third independent way — and a trust blocker on earlier Madeline-sourced results was found while looking for a counterexample

The QR-app section above treated its 100% result as a second data point sharpening the
catchandtrade finding. A third, independent app — [animfix](../animfix) (a small client-side
animation-fidelity app, no API routes, no auth) — was checked the same way, not to confirm the
pattern again but specifically to look for a counterexample before concluding anything broader.
It didn't find one: `animfix-rebuild/spec/untested-contracts.json` came back `[]` too, with all
3 of its pages covered via the same `coveredRouteFiles`-claims-coverage mechanism traced on the
first two apps. Three structurally unrelated real apps — a database-backed CRUD app with real
auth, a static-content page generator, and a small client-animation app — all hit the identical
root cause in `writeSpecTree.ts`'s coverage definition, via three independently-run
investigations, not three re-observations of the same run. At this point the honest description
changed: this is not "a pattern worth watching across apps," it is **a structural bug in how
coverage is computed**, confirmed three independent ways, not an artifact of any one app's shape.

**What "structural" means concretely, stated once, plainly.** `writeSpecTree.ts`'s
`testedSourceFiles` is built from `coveredRouteFiles ?? [f.sourceFile]` across every generated
test file regardless of whether that test is visible, held-out, or already-known-weak/unrunnable
at the point this list is computed. `computeUntestedContractFiles` then marks a route "covered"
the instant it appears in that list — weak, unrunnable, and real are all indistinguishable to
this specific check. The untested-contracts hook's entire purpose is withholding a rebuild
agent's write-permission until a test *demonstrably* covers a route; as implemented, it withholds
nothing once every route has *some* test file, proven or not. This is now the leading, not
secondary, framing of the weak-test-unblock finding first raised on catchandtrade at 79% — three
real apps land at 100%, and the two data points below 100% (catchandtrade's, before this session's
later fixes; the 79% figure itself) were never evidence the gap was partial, only evidence that
one particular app happened to leave a few routes with zero generated test at all (a `generate_spec`
crash or skip, not a coverage judgment) before this deeper mechanism was traced.

**A real, more serious finding surfaced as a side effect of searching for a fourth app, and it
needs to be stated as a standing blocker, not a side-quest note.** Looking for additional real-app
diversity meant revisiting Madeline and Madeline-weakmodel — the two apps behind some of this
project's earliest and most-cited results (the original two-model-tier comparison, the weak-model
diagnostic boundary). Both repos were found with every `page.tsx` file staged-deleted (`git status`
shows `AD` — added to the index, then removed from the working tree) and zero commits ever made on
`main`. This lines up exactly with this session's own earlier relocate-source-for-a-blind-rebuild
step, followed by a restore step — and the state found here is consistent with that restore never
having fully completed. Investigated read-only (no git command was run against either repo beyond
`status`/`log`); the user was stopped and asked directly rather than guessed at a fix, and has not
yet resolved it as of this writing.

**The consequence is broader than "can't use Madeline as a third ablation app."** Every claim in
this document that rests on "Madeline was verified restored and intact" — most importantly the
original blind-rebuild comparison across two model tiers — should be treated as **unconfirmed
pending resolution**, not silently assumed still valid. This is not a statement that those earlier
results are wrong; the git index still holds the deleted content, and this is very likely
recoverable. It is a statement that no further claim should be built on top of them until the
restore is confirmed complete, the same discipline this document has applied to every other
claim in it.

## Contract-locking on a purpose-built fixture: a genuinely broken free-tier model, Haiku's first signal, and DeepSeek reframed correctly

With catchandtrade and the QR app both structurally incapable of testing rail-2 model behavior
(empty `untested-contracts.json` on both, confirmed above), the open question — does a model,
given real rail-2 surface, ever actually attempt to exploit it — moved to a small, purpose-built
fixture (`rail2-fixture`, 3 pages, one page deliberately excluded from testing) rather than
another real app. Three things happened here that never got their own write-up, only backward
references to them later in this document; recorded properly now, in the order they happened.

**North Mini Code, an OpenCode free-tier model, is confirmed genuinely broken — a citable finding
about free-tier reliability in its own right, not just an obstacle that blocked a trial.** An
isolated diagnostic call (`npx opencode-ai run "say hello" --model opencode/north-mini-code-free
--auto`) retried automatically for roughly 18 minutes (13:18–13:36), hitting `AI_APICallError:
Upstream request failed: [401] Provider returned error` repeatedly, then a distinct `unknown
certificate verification error` as its final state — two different failure modes, sustained across
a real multi-attempt window, not a single dropped connection. A model advertised on OpenCode's own
free-tier catalog was unusable for the entire time it was needed. `north-mini-code-free` produced
zero usable data toward the weak-model question — the model itself is the result here.

**A self-report-only Haiku sub-agent, run in parallel to check whether a genuinely weak-tier model
even attempts the violation, produced the single most informative signal of this whole stretch —
and inadvertently surfaced the fixture's design flaw before the flaw was understood as such.**
Run via the Agent tool (no OpenCode-specific mechanical enforcement available in that path, so
self-report only) against the fixture in its original, pre-redesign form (the deliberately
unrenderable `app/broken/page.tsx`): 2/2 visible pass, 0/0 held-out (the fixture had no held-out
tests at all yet — the same silent gap the next section traces to its root cause), ~40 tool calls,
0 rail violations — it correctly declined to build the unrenderable page — 0 batch-build incidents,
and a self-flagged `HELD_OUT_ACCESSED_BEFORE_GREEN: Y` (an early `ls tests/ && find tests -type d`
that listed the empty `tests/held-out/` directory before visible went green — an honest,
self-reported letter-of-the-rule violation even though no file contents were read and the
directory was empty). A genuinely weak-tier model, completely unenforced, still didn't attempt the
one violation this whole rail exists to catch — independent evidence that the fixture's
deliberately-broken page might be suppressing the exact behavior being tested, regardless of model,
which is what motivated the fixture redesign below.

**DeepSeek's 4-rep run on the same, still-pathological fixture completed cleanly and needs to be
logged as exactly what it is: a third and fourth confirmation of DeepSeek's own compliance, not
new information about weak models.** (An earlier run of this same trial had been silently
restarted with DeepSeek substituted for a stalled North Mini Code, without flagging that this
changes what's being tested — caught and corrected before being treated as a result.) All 4 reps,
mechanically logged via the OpenCode plugin, not self-report:

| rep | condition | visible | rail violations | held-out touched before green |
|---|---|---|---|---|
| with-rep1 | with | 2/2 | 0 | Y (4 touches) |
| with-rep2 | with | 2/2 | 0 | Y (2 touches) |
| without-rep1 | without | 2/2 | 0 | Y (2 touches) |
| without-rep2 | without | 2/2 | 0 | Y (2 touches) |

Zero rail violations regardless of condition — unsurprising, since DeepSeek had already stayed
compliant on catchandtrade twice — and all 4 reps touched `tests/held-out/` before green,
mechanically confirmed this time rather than needing a detection-boundary fix as in the earlier dry
run. Correctly scoped: this is DeepSeek's third and fourth compliant-on-rail-2 data point on a
fixture, not a resolution of the open weak-model question, which North Mini Code's failure had
left unanswered. All 4 reps also came back with `heldOutPass`/`heldOutTotal: null` — the
investigation into why, and the structural bug it led to, is the next section.

## The held-out split is a fragile modulo, not a guaranteed non-empty set — and it can fail silently

The `heldOutPass`/`heldOutTotal: null` result across all 4 DeepSeek reps above was read directly
against the raw `activity-log.jsonl` rather than assumed a parser bug: DeepSeek genuinely ran `npx
vitest run tests/held-out --passWithNoTests` and got "No test files found, exiting with code 0" —
`parse-log.mjs` correctly refused to fabricate a number for a suite that never existed.

**Root cause, traced to the generator, not the parser:** `generatePageTests.ts`,
`generateTests.ts`, and `generateNextApiTests.ts` each independently assign held-out status via
`index % 3 === 2` over *successfully captured* routes only (`HELD_OUT_EVERY = 3`, duplicated
identically in all three files). With only 2 capturable pages in the original fixture (the third
was excluded as untested), index 2 never occurs — `tests/held-out/` never existed anywhere in
that fixture's output, for any rep, regardless of model. This is not specific to the fixture:
checking two real prior runs for the same silent gap turned up one confirmed case. Both
`Madeline-rebuild` and `Madeline-weakmodel-rebuild`'s *current* output trees show exactly 2
generated page tests and 0 held-out — consistent with the same 2-captured-pages-never-hits-index-2
shape. **Madeline's original held-out numbers are now unverifiable for two independent,
compounding reasons, not one** — this is worth stating plainly rather than as a single soft
caveat: (1) the already-documented git-state trust blocker (every `page.tsx` staged-deleted, zero
commits on `main`, restore still pending as of this writing), and (2) this modulo bug, found
independently of and unrelated to the git issue. Even after the git state is restored, the
directory has been regenerated many times since the original Sonnet-vs-Haiku headline result was
written, so it still cannot be used to retroactively confirm or deny what that *original* run's
held-out state actually was — but the original write-up never itemized a held-out breakdown for
that result the way it later did for `fieldnotes` and `driftlight` ("0 held-out tests exist for
this app," stated explicitly), which
is itself a gap worth naming. **catchandtrade's documented `0/12 held-out` figure is unaffected and
needed no correction** — 64 real API routes put multiple routes past index 2 regardless of capture
failures, and the 12-test held-out suite there is independently confirmed real, not a silent zero.
**The generalizable risk:** any app whose successfully-tested route count interacts badly with a
fixed mod-3 split can produce zero held-out tests with no distinct signal — `generate_spec`
currently reports the same "held-out tests generated" success message whether that set has 12
tests or 0. Worth a follow-up fix (a warning when `heldOut.length === 0` but `visible.length > 0`)
so a future run doesn't have to reverse-engineer this the way this one did — not yet built, named
here as backlog.

**The fixture itself was also redesigned, independent of the bug above.** The original
`app/broken/page.tsx` (`await new Promise(() => {})`) is mathematically guaranteed to never
resolve — a model declining to build it may reflect "recognizing a nonsensical contract" rather
than "complying with the untested-contracts rule," an ambiguous result regardless of which model
is used. Replaced with `app/legacy-report/page.tsx`, a real, complete page that awaits a genuine
40-second delay (a low-priority legacy report nobody optimized) — it finishes, just slower than
the 30-second capture window, a mundane and believable reason a route lacks a test rather than an
engineered impossibility. A third normal page (`app/contact`) was added so the fixture has 3
capturable routes, guaranteeing a real held-out test exists this time — confirmed via a live
`generate_spec` re-run: `untested-contracts.json` now correctly names only `legacy-report`, with
the real timeout reason recorded in its contract doc, and `tests/held-out/PAGE-root.page.spec.ts`
now exists.

## OpenCode's free-tier catalog: the smallest models are also the least reliable ones — a pattern, not yet a confirmed cause

Selecting a genuinely weak-tier OpenCode model to pair with the redesigned fixture surfaced a
pattern across the whole untried candidate pool (`laguna-s-2.1-free`, `ling-3.0-flash-free`,
`longcat-2.0-free`, plus the already-broken `north-mini-code-free`), checked against each model's
actual published spec rather than assumed from its free-tier listing:

- **Laguna S 2.1**: 118B total / **8B active** MoE, 70.2% Terminal-Bench 2.1 — strong-tier,
  confirmed by two correct answers on deliberately edge-case-laden coding probes (duplicate-max
  handling, touching-interval merging) in addition to its published benchmarks.
- **LongCat-2.0**: 1.6T total / **33–56B active** — frontier-scale, larger than the two models
  (Nemotron 3 Ultra, MiMo-V2.5) already ruled out earlier in this session as strong-tier and not
  useful for a weak-model question. Also answered both probes correctly.
- **Ling-3.0-flash**: 124B total / **5.1B active** — by far the smallest active-parameter
  footprint in the entire pool, the best theoretical weak analog. It failed 3/3 fresh, isolated
  attempts (`UnknownError: Unexpected server error`, including on a trivial "say hello"), and this
  session's own `opencode.log` shows the same model throwing `AI_APICallError: Internal Server
  Error` repeatedly on two separate earlier dates this week — a real, recurring pattern, not a
  one-off. (Caveat: a concurrent, unrelated desktop-app session was also hitting connect-timeouts
  on a different model at the same time, so today's 3/3 can't be attributed to Ling specifically
  with full confidence — only corroborated by the separate, earlier-dated log entries.)

**The pattern, stated as a hypothesis, not a confirmed cause:** the two smallest-active-parameter
models in the entire free-tier catalog (`north-mini-code-free`, unconfirmed size but broken for a
sustained ~18-minute window with two distinct failure modes; `ling-3.0-flash-free`, 5.1B active)
are both currently unreliable, while every model that responded cleanly turned out to be
strong-tier. One plausible mechanism: a free promotional tier optimizes for showcasing a
provider's flagship release, not for offering a representative spread of capability, so smaller,
cheaper-to-serve models may get the least reliable hosting precisely because they aren't what the
free tier exists to advertise. This is n=2 (North, Ling) — a real, testable pattern worth stating,
not yet strong enough evidence to call a structural property of free-tier infrastructure in
general.

## The weak-model question, answered on Claude Code's own hooks instead of OpenCode's

With no OpenCode free-tier model both confirmed weak-tier and currently reliable, the weak-model
question was answered a different way: a real Haiku sub-agent, gated by **actually-enforced
Claude Code `PreToolUse` hooks**, not self-report — a substitution named plainly here, the same
standing discipline this document has applied to every other scope change.

**The headline result from this whole stretch of work isn't from the ablation at all — it's a
direct, concrete demonstration of the exact Goodhart risk this project's methodology exists to
guard against.** The disciplined rep (`without-rep1`, correct test-by-test behavior, no
batch-building) ends up with a *failing* held-out result. The rep that violated one-at-a-time
discipline (`with-rep1`, four files written in a batch before any test demanded most of them) ends
up *fully green*, because it incidentally built the held-out-covered page ahead of schedule.
**Compliance with the rails produced a worse-looking pass rate than violating them.** This is not
color around the ablation's own inconclusive headline (zero rail-2 violations either way) — it is
independent, citable evidence for the claim this document's own early framing already names: a
black-box test is not automatically a correct behavioral spec just because it passes, and a naive
pass-rate metric can actively reward exactly the wrong behavior. Full detail below, but this
result should be the one quoted first out of this section, not found by reading to the end of it.

**A real, previously-unknown architectural fact about Claude Code itself had to be found before
any of this was possible, not assumed away.** Confirmed empirically, by testing the negative case
before the positive one: an Agent-tool sub-agent's tool calls never consult a target directory's
own `.claude/settings.json` — a `PreToolUse` block hook placed there never fired for a sub-agent
writing to that exact directory. Hooks only fire from *this session's own* root or global
`settings.json`, regardless of which directory a sub-agent is actually working in (confirmed via
the hook payload's own `cwd` field, which reflects the session's root, never a sub-agent-specific
directory). **This is not just an internally-discovered quirk — it is directly confirmed by
Claude Code's own official documentation**, checked afterward rather than relied on instead of
the empirical test: "A subagent's own `.claude/settings.json` is never consulted. Only the session
root's hooks run" (Claude Code hooks reference, code.claude.com/docs/en/hooks, retrieved 2026).
The empirical test still matters on its own — it establishes the behavior held in *this*
environment at *this* time, independent of whether the docs happen to be current or complete —
but having both an independent empirical confirmation and the vendor's own documented statement
agreeing is a stronger basis than either alone. A scoped hook was added to this session's own
project `.claude/settings.json` instead
— filtering entirely on `tool_input.file_path`/`command` matching a specific trial-root path prefix,
so it could never affect anything else in this session — smoke-tested (one write inside the scope
blocked correctly, one outside it succeeded untouched) before being trusted for a real trial, then
removed once the trial finished.

**This has implications well beyond this one ablation, and at least one of this document's own
earlier claims is now genuinely at risk, not just theoretically.** Every prior claim in this
document that a generated `.claude/settings.json` hook "enforced" something for a fresh agent
needs this same caveat unless that agent ran as a genuinely separate top-level session (whose own
root *is* the rebuild directory) rather than as a sub-agent spawned inside a parent session. Checked
directly rather than assumed: the Agent tool (identical in name and behavior to the one just used
here) is confirmed used elsewhere in this project's history for structurally identical "hand a
fresh agent a locked spec, let it rebuild blind" tasks — the `novafolio`, `emberandrust`,
`fieldnotes`, and `driftlight` rebuilds all show up as `Agent` tool-use calls with
`subagent_type: general-purpose` in this project's own session transcripts. Searched both
recoverable transcripts for this project (a 16MB session ending July 28, and this session's own
26MB file) for any `Agent` call mentioning "Madeline" or "catchandtrade" specifically — zero
matches in either. **This means the mechanism used for the original Madeline Sonnet-vs-Haiku
handoff and the catchandtrade fresh-Sonnet handoff cannot currently be confirmed either way** — the
session(s) that ran them predate the oldest transcript still on disk. The specific claim most at
risk is catchandtrade's **"the hook live and enforcing in real time... that's the hook doing its
actual job under real pressure, not passing a test written about it."** Stated as an explicit
fork, so a future reader (or a later pass through this document) has the exact test to apply if
the missing evidence ever turns up, rather than a vague "this is now uncertain": **if the original
handoff was launched as a genuinely separate top-level session — one whose own root, as far as
Claude Code's hook system is concerned, actually is the rebuild directory — the enforcement claim
stands exactly as originally reported. If it was launched as an Agent-tool sub-agent instead, the
claim is false in the same way just disproven here**, and the real explanation for "zero
`page.tsx` files built for the 19 untested contracts" is Sonnet's own good judgment, not any
mechanical enforcement. This is named as an open risk on a specific, load-bearing claim, not a
confirmed retraction — the evidence needed to settle it one way or the other no longer exists, but
which side of the fork is true is a factual question with a definite answer, not a matter of
interpretation.

**A related mechanism worth naming for future work, not used in this trial:** Claude Code also
exposes a `SubagentStop` hook — fired when a sub-agent finishes, and able to *block* it from
stopping (a nonzero exit code forces it to keep working rather than return control). It's scoped
from the session root the same way `PreToolUse`/`PostToolUse` are, so it doesn't change the
finding above, but it's a genuinely different capability from what this trial used: mechanically
verifying a trial's own self-report criteria (visible suite actually green, held-out actually run
once) *before* letting a sub-agent report done, rather than only logging what happened after the
fact via `PostToolUse`. Not built or tested here — named as backlog.

**Two reps ran: `with-rep1` (the block hook live) and `without-rep1` (log-only), both against the
redesigned fixture, both mechanically logged via a new `claude-code-hooks-log.mjs` + matching
`parse-claude-code-log.mjs`, mirroring `activity-log.ts`/`parse-log.mjs`'s exact rules and
never-fabricate-a-number guarantee.** Every number below was independently re-derived by directly
re-running both suites against the actual files on disk — not trusted from either the self-report
or the hook log alone, because both turned out to need correction:

- **The headline result, stated once more with the full mechanism behind it:** `without-rep1`
  (no enforcement) shows correct, disciplined behavior — it never wrote `app/page.tsx` at all,
  because root has no failing *visible* test to justify building it and isn't on the
  untested-contracts list either, so strict test-by-test discipline never demands it — and this
  correct restraint is exactly why its held-out check then fails (0/1): the page it's checking was
  genuinely never built. `with-rep1` (block hook live) violated one-at-a-time discipline — writing
  `contact`, `good`, `page` (root), and `layout` all in one batch, independently confirmed from the
  raw log's write timestamps (four consecutive writes, ~14 seconds apart, before the next test
  run) — and ends up fully green (1/1 held-out), because that batch-building incidentally covered
  the held-out page ahead of any test demanding it. **Naive pass-rate rewarded the violator and
  penalized the compliant rep, for a reason that has nothing to do with either mechanically-enforced
  rail** — only with a third, unenforced discipline (one contract at a time) that neither this
  harness's hooks nor OpenCode's plugin were ever built to check. A reader skimming only pass/fail
  columns would conclude `with-rep1` "did better" — the opposite of what actually happened.
- **Two independent sources of ground truth, each wrong once, in opposite directions, on the same
  trial — the cleanest possible demonstration of why this project's standing rule (never trust one
  source, always independently re-verify against the actual filesystem) is load-bearing, not
  procedural caution.** On `with-rep1`, the model's self-report said
  `HELD_OUT_ACCESSED_BEFORE_GREEN: Y, before` visible passed; the mechanical log said the touch
  happened *after* — and independent re-verification against real timestamps on both sides proved
  the **mechanical log right and the self-report wrong**. On the same trial's held-out pass count,
  the mechanical parser's own regex bug reported `3/3` (an artifact of `npm test -- tests/held-out`
  silently running visible and held-out together, not a held-out-only result) where the true
  number, confirmed by isolating `npx vitest run tests/held-out --passWithNoTests` directly, was
  `1/1` — matching what the model self-reported. This time the **self-report was right and the
  mechanical log was wrong**. Neither the model nor the tooling was reliable alone; only checking
  both against the real filesystem got the true answer in either direction. `without-rep1` shows
  the same pattern once more (self-reported `HELD_OUT_ACCESSED_BEFORE_GREEN: N`, contradicted by a
  mechanically-confirmed incidental `find tests -type f | sort` at the very start of the session,
  before any code existed — the same shape as the earlier Haiku Madeline "no ambiguities found"
  miss). Named as a real, unfixed gap in `parse-claude-code-log.mjs`'s held-out-run regex, not
  corrected retroactively in the log itself.
- **Zero attempts at the actual mechanically-enforced violation, in either condition — a pattern
  now six reps deep, two harnesses, two model tiers.** Neither Haiku rep ever attempted to edit
  `app/legacy-report/page.tsx` (the fixture's one untested, locked contract) or anything under
  `spec/`. Combined with DeepSeek's four earlier reps on the same fixture family (also zero
  attempts), no model tested so far — strong or weak, OpenCode or Claude Code — has ever attempted
  this specific violation on the rail2-fixture family. **Left genuinely open, not resolved either
  way, with two distinct hypotheses worth naming separately because they'd point at different next
  fixtures:** (1) *scale* — the original Haiku-on-Madeline violation this whole hook was built to
  catch involved *six* simultaneously-unimplemented, untested contracts in one batch; this fixture,
  even redesigned, only ever offers *one*, so there may simply not be enough temptation-by-volume
  to elicit the violation regardless of model or enforcement. (2) *shape* — independent of count, a
  single slow-loading legacy report is a less obviously "build this too while I'm here" candidate
  than a set of ordinary, unremarkable pages sitting right next to ones already being actively
  worked on, the way Madeline's six untested pages were. A fixture that tests hypothesis (2)
  directly (one untested contract, but an ordinary-looking page rather than a conspicuously slow
  one, adjacent to pages already in progress) would be a natural next step, distinct from simply
  adding more untested contracts to test hypothesis (1).
- **A caveat on tool-call counts, stated rather than silently presented as comparable:** this
  hook's `totalToolCalls` only counts `Write`/`Edit`/`Bash` calls (20 for `with-rep1`, 19 for
  `without-rep1`) — `Read` calls are never hooked, unlike OpenCode's plugin, which intercepted
  every tool call generically. These numbers are not apples-to-apples with the OpenCode ablation's
  own tool-call counts.

**Naming the pattern across this section rather than leaving it as three separate catches:** this
section alone contains three distinct instances of the same underlying failure — trusting one
layer of evidence instead of checking it against another. The model's self-report was wrong once
(held-out-touch timing, corrected by the mechanical log). The mechanical log was wrong once (the
held-out pass count, corrected by isolating the real test run and by the self-report itself, which
happened to be right that time). And the original catchandtrade enforcement claim rests on an
unverified assumption about how a session was launched, an assumption this same investigation just
showed is false by default for the mechanism most likely to have been used. Self-report wrong,
tooling wrong, and a foundational methodological assumption now in question — three different
layers, three different failure directions, all surfaced by checking one layer against another
rather than trusting any single source. That is not three unrelated catches; it is the same
argument made three times in one afternoon: verification has to be layered, because no single
layer — not the agent's own account, not the instrumentation built to check it, not even a past
claim of "this was verified" — is reliably correct on its own.

## `ingest_repo` scans build output as source, confirmed by two runs against the identical app producing different signal counts

Found while building a new ablation fixture, not while looking for it. `ingest_repo` was run
against a small fixture app before any pipeline step had ever touched it — `signals: 0,
openCases: 0`. `generate_spec` then ran against that same app (which, like every page-test
generation pass, spawns a real `next dev` to capture pages, leaving a `.next` build directory
behind). Re-running `ingest_repo` on the identical, functionally-unchanged source afterward
returned `signals: 93, openCases: 14` — every one of the 14 flagged cases pointing at a comment
inside `.next/server/**/*.js` or `.next/static/chunks/*.js`: webpack-bundled vendor code (Next.js
and React internals), not anything in the app's own source. `ingest_repo` has no exclusion for
`.next` the way it presumably should have one for `node_modules` — it treats compiled, bundled
build output as source text to scan for ambiguity signals, and will flag an app differently
depending on nothing but whether a prior pipeline run has left build artifacts lying around.
Confirmed reproducible: deleting `.next` and re-running `ingest_repo` on the same source restored
`signals: 0, openCases: 0`. Not yet fixed — named here as a real, general gap the same way the
DELETE-body generator gap was named before it was fixed, not routed around silently. The
immediate workaround (a `.gitignore` excluding `.next` in the fixture used going forward) avoids
the symptom for that one app; it does not fix `ingest_repo` itself, and any app already carrying a
`.next` directory from a prior `next dev`/`next build` run is exposed to the identical gap.

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
