# Operator's validation report (redacted), 2026-09-24

This is the outside operator's report, submitted to the author on 2026-09-24. The operator drafted
it with Claude and edited it before sending. It is reproduced as sent, except for these changes:

- **Company, app and vendor names removed:** the app is `[app]`, its data warehouse `[warehouse]`,
  the warehouse's agent service `[warehouse agent service]`, and a private package
  `[private design-system package]`.
- **Route paths and internal helper names replaced by the stable IDs in `routes.md`:** R1–R10 for
  routes, H1–H4 for helpers.
- **The operator's home directory replaced by `[operator]`.**
- **Bracketed author notes**, marked **[Author note: …]**, record the operator's own later
  corrections.

The operator approved using this material.

---

**Validation report: [app] with Claude Code**

Outcome: partial success. The tool correctly generated a spec, the case queue, and a working test
harness. A fresh Claude Code session, working from the package alone, built a server that passes
7/7 visible test files (8/8 tests). But two concrete findings matter more than that pass rate:
- the rebuild silently ships a `ReferenceError` on a code path none of the visible tests
  exercise;
- it gets a validation-ordering decision backwards on another path the visible tests also miss.

The held-out route (R5) was never attempted at all, by design, since nothing told the agent to
build it.

I ran this myself (not through an external validator), using rebuild-dossier against my own team's
real production app rather than a toy app, and inspected rebuild-dossier's evidence/case-queue
output directly rather than working blind. **[Author note: the operator later corrected this. The
app belongs to another team in the company, not the operator's own.]**

**rebuild-dossier version**
0.2.14, pinned via `claude mcp add rebuild-dossier -- npx -y rebuild-dossier@0.2.14`. It was scoped
to the working directory used for `ingest_repo`/`generate_spec` only. I confirmed it was not
registered inside `<repo>-rebuild/`, so the rebuild session had no access to it.

**Model and Claude Code version**
claude-sonnet-5, Claude Code CLI 2.1.282. Node v22.16.0, npm 10.9.2.

**Your app**
A much larger, real internal app than the earlier trial: an Express 4 (CommonJS) backend (one
server file, ~5,820 lines, 29 routes, all [warehouse]-backed) plus a CRA/TypeScript React frontend.
No existing tests. Everything reads from [warehouse] via a [warehouse agent service] proxy, and
nothing is mocked or seeded locally. So with no real [warehouse] token, the large majority of
routes can only ever be validated for "fails for the right reason", never for correct data.

**Where anything broke or confused you**

1. **The `apiTestNote` export-fix advice undersold what was needed.** Adding
   `module.exports = app` plus the `require.main` guard, exactly as `generate_spec`'s note
   describes, was necessary but not sufficient here.
   - The server file calls `validateEnvironment()` at import time, which does `process.exit(1)` if
     any of the four [warehouse] settings is unset.
   - The first `generate_spec` run correctly produced contracts (29 routes, 23 open cases), but all
     28 generated tests came back `unrunnable` with the identical reason
     `process.exit unexpectedly called with "1"`. That is a hard crash, not the graceful per-route
     "missing credential" failure the tool's own note anticipated.
   - I fixed this myself by adding a `.env` with obviously fake placeholder values.
   - This is not a rebuild-dossier bug, but it's worth flagging: "add the export guard" alone
     silently produces a 100% unrunnable result for any app that hard-exits on missing config at
     import time.
2. **The case queue's `topicKey` attribution is frequently wrong on a large monolithic file.**
   Roughly half of the 23 open cases attributed comments to the wrong route.
   - The heuristic appears to attach any `deliberately`/`intentionally` signal to the nearest
     preceding route definition. That's wrong whenever a large helper or comment block actually
     documents the next route, which is common in a 5,800-line file with big doc-comments before
     each handler.
   - Example: signals for one route's scoring logic were filed under the case for a different
     route. The five signals in the case labeled for the health route were all really about shared
     filter-building helpers between the health route and the next route, 1,500+ lines later.
   - This didn't block me, since the underlying comments were still real and verifiable; I just
     had to read further to find which route they applied to. It's worth fixing, though, because it
     will mislead anyone who answers case by case without reading past the `topicKey`.
3. **Resolving the case queue took real reading, not a keyword match.** I verified a representative
   sample of the 23 cases directly against the code:
   - cross-file agreement between the server's comments and the matching frontend docstring;
   - grep-checked claims such as "channel is deliberately absent from the division hierarchy"
     against the actual hierarchy array;
   - checked that specific cited numbers were used consistently.

   All 23 held up, with no mislabeled bugs found. This took real effort per case, which matches the
   tool's own intent (rejecting "deliberately" as a rubber stamp) rather than being a criticism.
4. **Headless (non-interactive) rebuild sessions get more friction than `docs/validators.md`
   assumes.** The guide's step 4 assumes a human sitting at an interactive `claude` session
   approving prompts. I drove the fresh session through `claude -p --permission-mode acceptEdits`
   instead, with no human at the keyboard. It stalled twice before writing a single line of code:
   - **First, `npm install` itself was denied**, because there was no interactive host to answer
     non-edit Bash approval requests under `acceptEdits`. The agent correctly stopped and asked
     rather than forcing anything through.
   - **Second, after I approved `npm install`, it failed for a real, unrelated reason.**
     `package.json` pins a [private design-system package] that is not on the public npm registry,
     and there's no private registry configured in `.npmrc`. The agent again stopped rather than
     editing the "locked" `package.json` without permission. It proposed a non-destructive local
     stub package plus a dependency-path fix; it first tried an `overrides` block, npm rejected
     that for a direct dependency, and the agent discovered this and adapted. I approved it, since I
     had no private-registry token to offer.

   Neither stall is a rebuild-dossier defect. Both come from validating headlessly against a real
   company app with a real private dependency. But they show that the "let it work without steering
   it" instruction in `docs/validators.md` needs a live human, or a fair amount of pre-approved
   infrastructure, for a real-world monorepo.

**Numbers**

- **`ingest_repo`:** instant. 29 routes, 0 existing tests, 44 signals, 23 open cases.
- **Case queue resolution:** about 2 minutes hands-on for 23 cases, all resolved `intentional`,
  each with a written verification note; several were verified directly against source, not just
  read.
- **`generate_spec`:**
  - First attempt, before the env-var fix: 28/29 unrunnable via a hard crash; wrote nothing
    usable.
  - Second attempt, after adding placeholder [warehouse] env vars: under 2 minutes, 1,424
    mutations checked.
- **Visible:** 7/7 test files passing (8/8 tests).
- **Held-out:** 0/1 test files passing (1/2 individual tests). R5 was never implemented (404),
  because no visible test ever exercised it. This reflects the tool's own by-design restraint
  against building ahead of the tests, not a crash or a missed contract; R5's contract was present
  and available to the agent throughout.
- **Heartbeat:** `.claude/.hook-heartbeat.json` → `{"count": 7, ...}`. Hooks ran.
- **Rebuild session cost:** ~$0.76, ~269s of API time, 3 resumes (2 for the infrastructure
  approvals described above, not design steering).

**Behavioral differences found comparing the two apps side by side**

Both servers were run with the same placeholder (non-functional) [warehouse] credentials, so any
route that actually reaches [warehouse] fails on both. The comparison that matters is how and
whether they fail the same way.

1. **R1 with a `channel` value: a real bug, not a credential issue.**
   - The original returns `500` with a genuine [warehouse] SQL API error (expected, since there's
     no real token).
   - The rebuild also returns `500`, but with `{"error":{"message":"H1 is not defined"}}`: a
     `ReferenceError` in the rebuild's own code.
   - The rebuild agent knew about this. It left a comment explaining that H1, H3, H4 and related
     view-name constants "were never captured verbatim in any contract" and were left undefined.
     It also noted that the visible test never exercises this path: the test calls the route with
     no query parameters at all, which 400s on a guard clause before ever reaching the missing
     function.
   - The same shape of bug hit R2 with a `channel` value (`H2 is not defined`).

   This is the single most useful finding. The contract-extraction step doesn't capture the
   transitive closure of helper functions a route depends on when those helpers live elsewhere in a
   large monolithic file, and the generated "responds without crashing" test is too weak to catch
   the gap it leaves behind.
2. **R3: different validation order.**
   - The original, given `{"message":"hi"}` for agent `test-value-123`, returns
     `400 {"error":"Messages array is required"}`: it validates the request body's shape before
     checking whether the agent exists.
   - The rebuild returns `404 {"error":"Unknown agent: test-value-123"}`: it checks agent
     existence first.
   - The single visible test for this route only asserts `status < 500`, while POSTing a body with
     an inferred and probably wrong field name (`getReader`), so it never distinguishes the two
     orderings.
   - Both are "reasonable" API designs in isolation, but they're genuinely different behavior that
     no test in the package would catch.
3. **R4 and R5: the original's JSON error vs. Express's default 404 page.**
   - For a route that exists but fails, the original returns its own JSON error shape, with
     friendly error text.
   - The rebuild returns Express's default HTML "Cannot GET ..." page, because the route was never
     implemented at all (neither had a visible test).
   - Not a bug in the rebuild given its mandate, but worth noting for anyone reading the two side
     by side and expecting parity.
4. **Everything with a visible test that could be checked without [warehouse] matched exactly:**
   - R8 (byte-identical shape, timestamp aside);
   - R9's unknown-metric 404;
   - R10's missing-parameter 400;
   - R2's missing-parameter 400.

   All had identical status and body between the original and the rebuild.

**What the agent did that surprised you (positively)**

- **It never fabricated the two undefined helper functions to force a green test.** It left them
  undefined, commented exactly why, and moved on once the visible suite it could see was green.
  That's arguably correct behavior given its mandate, but it does mean "visible tests all pass"
  said nothing about those two routes at all.
- **It refused to touch `package.json`'s dependency block without asking**, even though the fix
  was obvious and low-risk, because the file is spec-adjacent and marked locked by the package's
  own hooks and rules.
- **It adapted when its first fix failed.** Its first proposal (npm `overrides`) hit an npm
  restriction (`overrides` cannot target a package that's already a direct dependency). It
  correctly diagnosed npm's error and adapted, rather than fighting it or asking again.
- **It asked one honest, well-reasoned scope question** (whether to invent an
  agent-registry-lookup pattern for the two under-specified agent routes) instead of guessing
  silently, and flagged its eventual choice as inference in its own commentary.

**Notes on methodology deviations from `docs/validators.md`**

- **I ran the fresh rebuild session headlessly (`claude -p`) rather than interactively.** I had to
  resume it twice with narrowly scoped `--allowedTools` grants (`Bash(npm install:*)`, etc.) rather
  than a blanket permission bypass. A full `--permission-mode bypassPermissions` was in fact refused
  by Claude Code's own safety classifier when I tried it, which redirected me to the narrower
  approach. Worth noting in case other validators hit the same wall running headless.
- **I didn't test whether the agent would go looking for the hidden original.** The rebuild
  package directory and the sealed original were both under my own control the whole time (single
  machine, single user). Since I was operating both sides, I did not test whether an agent with
  shell access would try to find the original.

---

**[Author note: the operator's later answers (2026-09-24)]**
- The operator resolved the 23 cases personally.
- The app is owned by a team in sales, not the operator's team.
- The rebuilt R3 streams its reply, like the original.
- The paper may describe the operator as "an engineer at a healthcare staffing company".
