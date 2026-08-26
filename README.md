# rebuild-dossier

[![DOI](https://zenodo.org/badge/1308271634.svg)](https://doi.org/10.5281/zenodo.22036801)
[![arXiv:2608.23616](https://img.shields.io/badge/arXiv-2608.23616-b31b1b.svg)](https://arxiv.org/abs/2608.23616)

An MCP server that reverse-engineers a trustworthy **rebuild spec** — a locked `CLAUDE.md`,
`.claude/` config, and a mutation-tested test suite — out of an existing app, so any coding
agent can rebuild it cleanly against that spec instead of guessing.

**It does not rebuild the app.** It produces the spec, contracts, and tests a coding agent
consumes to do that separately. This boundary is deliberate — see [Why](#why) below.

> **Status: v0.** The core loop works and has been validated end-to-end against one real,
> messy repo, including two independent fresh-agent handoffs on two model tiers. Read
> [docs/v0-findings.md](docs/v0-findings.md) for the honest result, including what broke.

## Why

Prior research ([AgentModernize, arXiv:2605.17535](https://arxiv.org/abs/2605.17535)) found
that a rebuild pipeline scores **0%** behavioral equivalence with no verified feedback loop,
and only **9–19%** with a coarse one. The bet behind this tool: locking interface contracts
*before* running tests, plus a strict one-test-at-a-time retry loop instead of batch
regeneration, does meaningfully better.

The riskiest part of any such pipeline is silently validating a bug as intentional — four
sources of evidence can quietly agree on the same mistake with nobody ever having said why.
So the single non-negotiable rule in this tool: **auto-resolving an ambiguity requires both
signal agreement *and* an affirmative signal that someone actually decided** (a stated
comment, a TODO admitting a bug, or a direct human answer). Silent agreement alone — code and
observed behavior simply matching, with no one ever having said why — always becomes a
question, never an auto-resolution, no matter how high the apparent confidence.

## How it works

Six MCP tools, run from inside a normal Claude Code (or any MCP-compatible) session:

| Tool | What it does |
|---|---|
| `ingest_repo(path)` | Static analysis only, no LLM call: routes, `package.json`, build config (via AST, never executed), existing tests, and structural-smell detectors (e.g. a client-side-only credential check with no server-side verification) that surface real ambiguity even when nobody ever commented on it. |
| `crawl_site(url)` | Headless Playwright crawl of reachable routes, with progress notifications so long crawls don't get killed as unresponsive. |
| `flag_known_bug(description)` | Free text, stored verbatim. Always overrides auto-resolve for anything it matches — the cheapest, most authoritative signal in the system. |
| `get_case_queue()` / `resolve_case(id, decision)` | The ambiguity queue. Surfaces open questions via MCP elicitation when the client supports it; `resolve_case` is always available as a scripted fallback. |
| `generate_spec()` | Only callable once the case queue is empty. Writes `CLAUDE.md`, `.claude/rules/`, `.claude/settings.json` (hooks that *mechanically* enforce the discipline — see below), `spec/contracts/*.md`, `tests/visible/` + `tests/held-out/`, and `kickoff-prompt.txt` to a clean sibling `<repo>-rebuild/` directory — never into the original repo. Runs a real mutation check before finalizing tests: deliberately breaks the original code and confirms each generated test actually catches it, downgrading any that don't. |

### Rails that are mechanically enforced, not just written down

A comparison run across two model tiers found that a weaker model will happily read
`CLAUDE.md`, understand "only build what's currently failing, don't batch-regenerate," and
then quietly violate it anyway — because nothing *checked* it. Two rules in this tool are now
enforced by real hooks, not prose, for exactly that reason:

- **`spec/` is locked.** A `PreToolUse` hook blocks any edit under `spec/`.
- **Contracts without tests don't get built ahead of schedule.** `generate_spec` writes
  `spec/untested-contracts.json` (every route/contract with no covering test), and a second
  `PreToolUse` hook blocks writes to anything on that list — the same enforcement shape as the
  `spec/`-edit block, closing a gap that used to be advisory only.

A `PostToolUse` hook runs the visible test suite after every edit.

## Quick start

```bash
git clone https://github.com/businessfawcett-cloud/rebuild-dossier.git
cd rebuild-dossier
npm install
npx playwright install chromium   # needed for crawl_site
```

Add it as an MCP server in Claude Code (or any MCP-compatible client), then in a session:

```
ingest_repo({ path: "/path/to/some-app" })
get_case_queue({ repoPath: "/path/to/some-app", interactive: true })
# ...resolve whatever the queue surfaces...
generate_spec({ repoPath: "/path/to/some-app" })
```

This writes a clean `some-app-rebuild/` sibling directory. `cd` into it, start a **fresh**
Claude Code session (nothing else should be in scope), and paste the contents of its
`kickoff-prompt.txt`.

## Operating guide

The full lifecycle, in order — each step's actual behavior, not just the call signature.

### 1. Ingest the repo

```
ingest_repo({ path: "/absolute/path/to/some-app" })
```

Static analysis only — no LLM call, nothing executed. Parses `package.json`, route files
(Express and Next.js App Router today — see [scope](#current-scope-and-whats-deliberately-not-built-yet)),
build config (Tailwind/Vite/Next, via AST, never executed), existing tests, and scans for
comment/TODO signals plus structural smells (e.g. a hardcoded client-side credential check with
no server-side verification — the kind of thing nobody ever comments on, which is exactly why
it needs its own detector rather than relying on comments existing). Everything lands in
`<repo>/.dossier/` — this tool's own scratch state, inside the *original* repo, never shared or
uploaded anywhere. You'll get back a summary:

```json
{
  "routes": 8,
  "existingTests": 0,
  "signals": 3,
  "buildConfig": ["tailwind", "next"],
  "openCases": 3,
  "savedTo": "/absolute/path/to/some-app/.dossier/evidence.json"
}
```

`openCases` here already reflects reconciliation — comment/TODO signals and structural smells
that didn't auto-resolve become case-queue entries automatically.

If `routes` comes back `0`, check for a `monorepoHint` field before assuming the app has none —
`ingest_repo` needs to be pointed at the actual app directory, not a monorepo's root wrapper
(a `package.json` with `apps/*`/`packages/*` next to it, common with Turborepo/Nx/workspace
layouts, including ones that never actually declare a `workspaces` field). The hint lists real
candidate directories found under `apps/`/`packages/` so you don't have to hunt for the real app
yourself — re-run `ingest_repo` pointed at one of those instead.

If your client supports MCP elicitation, you can skip the manual re-run entirely: pass
`interactive: true` and, when a monorepo root with candidates is detected, `ingest_repo` asks
which one is the real app and ingests it directly — it never silently guesses on its own, the
same way `get_case_queue`'s interactive mode always asks rather than resolving anything without
you. Declining, an unsupported client, or an answer that isn't one of the real candidates all
fall back to the plain hint above, unchanged.

### 2. (Optional) Crawl the live site

```
crawl_site({ url: "http://localhost:3000", repoPath: "/absolute/path/to/some-app" })
```

Only useful if the app is actually running somewhere. Headless Playwright crawl of reachable
routes, emitting progress notifications periodically — long crawls get auto-backgrounded by
most MCP clients, and a silent multi-minute call risks being killed as unresponsive without them.

### 3. (Optional, but do this before step 4) Flag anything you already know is broken

```
flag_known_bug({
  repoPath: "/absolute/path/to/some-app",
  description: "The login gate secret check runs entirely client-side and is bypassable"
})
```

The cheapest, most authoritative signal in the whole system — a direct human statement always
outranks inference. It overrides auto-resolve for anything it matches, *even if* every other
signal quietly agrees the behavior looks intentional. Do this before resolving the queue, since
it changes what shows up there (and can seed a case entirely on its own, with zero other
evidence — see [docs/v0-findings.md](docs/v0-findings.md) for why that matters).

Matching is plain token overlap against each open case's file path and claim text, not fuzzy or
semantic — so one bug description can match (and auto-resolve) more open cases than you intended
if your codebase has several similarly-named components. In the validated example, one bug about
"the login gate" matched and closed all three of Madeline's near-duplicate gate components in a
single call, before any of them were reviewed individually. `resolve_case` overwrites a case's
decision regardless of its current status, so if that's not what you meant, call it directly on
the ones it swept up too broadly — don't assume every case it touched was actually the same
decision.

### 4. Resolve the case queue

```
get_case_queue({ repoPath: "/absolute/path/to/some-app", interactive: true })
```

`interactive: true` walks each open case via MCP elicitation — a real interactive prompt in
your client, showing the evidence side by side, if your client supports it. If not (or you're
scripting this), resolve cases one at a time instead:

```
resolve_case({ repoPath: "/absolute/path/to/some-app", id: "case:...", decision: "intentional", note: "..." })
```

**This step doesn't have a shortcut.** `generate_spec` refuses to run while any case is still
open, by design — there's no partial or in-progress spec to hand a rebuild agent with caveats;
phases 1–2 are literally what produce `spec/` in the first place.

### 5. Generate the spec

```
generate_spec({ repoPath: "/absolute/path/to/some-app" })
```

Only callable once the queue is empty. Writes `CLAUDE.md`, `.claude/` (rules, hooks, a
spec-auditor subagent, and a verify-against-spec skill — all derived from *this* project's actual
contracts and tests, not boilerplate), `spec/` (contracts, locked decisions,
`test-dependencies.json`, `untested-contracts.json`), and `tests/` to a clean sibling
`some-app-rebuild/` directory — never into the original repo. Two more `.claude/` artifacts are
generated only when they'd earn their keep: a `test-verifier` subagent, only if there are
held-out tests to guard; a `parallel-test-fix` workflow, only if the generated tests split into
two or more independent clusters (by shared route files) worth fixing concurrently. A small app
with a couple of tests covering the same routes — like the validated example above — gets
neither; that's not a bug, it's the generator refusing to hand a rebuild agent tooling it has
nothing real to do with. This step also runs a real mutation check: it deliberately breaks
the original code (flips a comparison, drops a null check, off-by-ones a loop bound) in a
scratch copy and confirms each generated test actually catches it — anything that doesn't gets
moved to `tests/weak/` instead of shipped as if it were trustworthy. You'll get back:

```json
{
  "outputDir": "/absolute/path/to/some-app-rebuild",
  "mutationsChecked": 8,
  "weakTests": [],
  "unrunnableTests": []
}
```

Both `weakTests` and `unrunnableTests` land in the same `tests/weak/` directory instead of
`tests/visible/`, but for different reasons worth telling apart: a weak test ran fine and just
never caught anything a mutation broke; an unrunnable test never passed even against the
original, unmutated code (a broken import, a missing environment variable, infrastructure the
bare repo doesn't have) — before this distinction existed, an unrunnable test looked
indistinguishable from a 100%-effective one, since it "fails" identically whether or not the
code under test was mutated. Neither is an error — it's the tool telling you honestly that a
specific test didn't earn its place in `tests/visible/`, and why.

If every generated test lands in `tests/weak/` with `mutationsChecked: 0`, check for a `warning`
field before assuming something's structurally wrong — the far more common cause is that the
target repo hasn't had `npm install` run in it, so the mutation-check scratch copy has none of
the target's own real dependencies (`next`, `@prisma/client`, whatever the app actually needs)
and every generated test fails to even import them. `generate_spec` checks for this directly and
says so, rather than leaving you to debug a confusing all-unrunnable result.

#### Optional: vision-assisted page-content classification

For a Next.js target, page routes get real Playwright-captured tests (a screenshot plus DOM-text
assertions) alongside the API-route tests described above. Whether a piece of captured text gets
an exact-match assertion (`static`) or a loose shape check (`dynamic`) is decided by a small
regex classifier by default — reliable most of the time, but confirmed capable of getting it
backwards in both directions on a real app (a hardcoded dropdown legend read as live data; a
live, comma-formatted database count read as fixed).

Setting **both** `GROQ_API_KEY` and `REBUILD_DOSSIER_ENABLE_VISION_CLASSIFICATION=1` before
calling `generate_spec` sends each captured page's screenshot and (secret-redacted) source code
to a Groq vision model instead, which can see *where* a value actually comes from — a literal
array in the source vs. a `fetch`/`useState` call — rather than only guessing from what the
rendered string looks like. Both variables are required together on purpose: an ambient
`GROQ_API_KEY` left over from some unrelated tool must never silently start sending this target
repo's code to a third party. Neither variable set (the default) means zero behavior change and
zero network calls beyond what `generate_spec` already does.

This is real added cost, not free: one Groq API call per captured page, plus a deliberate ~20s
pacing delay between pages (Groq's free tier has a tight per-minute token budget, and firing
requests back to back exhausts it fast) — `generate_spec`'s own response states the exact added
time for that run. A page that can't be classified this way for any reason (rate limit, network
issue, an invalid response) falls back to the regex classifier for that page only, reported in
`pageVisionFallbacks` — never a silent gap or a failed run. Groq's free tier (no credit card
required, at [console.groq.com](https://console.groq.com)) is enough to try this.

### 6. Hand it off

```bash
cd /absolute/path/to/some-app-rebuild
claude   # or oh-my-pi, opencode — any coding agent, a genuinely fresh session
```

Paste the contents of `kickoff-prompt.txt` verbatim. Nothing else should be in that session's
context — the directory is fully self-contained on purpose (see [How it works](#how-it-works)),
so there's nothing else for a rebuild agent to read, drift toward, or edit in place instead of
building cleanly. Read [docs/v0-findings.md](docs/v0-findings.md) for what actually happens
when you do this against a real app, including exactly where it got stuck.

## Connecting from other tools (oh-my-pi, opencode, etc.)

Two ways to run this, both entirely local — there is no hosted/shared instance, and none is
required:

**stdio (default)** — each tool spawns its own copy of the server as a local subprocess. This
is the standard way every MCP client (Claude Code, [oh-my-pi](https://github.com/can1357/oh-my-pi),
[opencode](https://opencode.ai)) adds a local MCP server — point it at `npx tsx src/index.ts`
(or a built `node dist/index.js`) from this repo's directory. No extra setup, no auth, nothing
in this section applies.

**HTTP (optional)** — one persistent server on `localhost` that multiple tools/sessions
connect to instead of each spawning their own. Useful if you want oh-my-pi and opencode (or
several Claude Code sessions) sharing one running instance. Still fully local — `MCP_ALLOWED_HOSTS`
only needs to include the hostname you'll actually connect to (`localhost`), not a real domain,
unless you deliberately choose to expose this beyond your own machine.

```bash
npm run build
PORT=8080 \
MCP_AUTH_TOKEN=$(openssl rand -hex 32) \
MCP_ALLOWED_HOSTS=localhost,127.0.0.1 \
REBUILD_DOSSIER_ALLOWED_PATHS=/absolute/path/to/your/projects \
npm run start:http:prod
```

All three env vars are required — the server refuses to start without them, on purpose:
`MCP_AUTH_TOKEN` gates every `/mcp` request (bearer auth), `MCP_ALLOWED_HOSTS` guards against
DNS-rebinding, and `REBUILD_DOSSIER_ALLOWED_PATHS` (comma-separated absolute directories) is
the only paths `ingest_repo`/`generate_spec`/etc. are allowed to touch — set it to whatever
parent directory holds the repos you actually want to rebuild.

**oh-my-pi** (`.omp/mcp.json` or `~/.omp/agent/mcp.json`):

```json
{
  "mcpServers": {
    "rebuild-dossier": {
      "type": "http",
      "url": "http://localhost:8080/mcp",
      "headers": { "Authorization": "Bearer ${REBUILD_DOSSIER_TOKEN}" }
    }
  }
}
```

**opencode** (`opencode.json`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "rebuild-dossier": {
      "type": "remote",
      "url": "http://localhost:8080/mcp",
      "enabled": true,
      "oauth": false,
      "headers": { "Authorization": "Bearer {env:REBUILD_DOSSIER_TOKEN}" }
    }
  }
}
```

`oauth: false` disables opencode's automatic OAuth discovery on a `401` — this server only
supports the static bearer token above, not a real OAuth flow. Set the referenced env var
(`REBUILD_DOSSIER_TOKEN` in both examples) to the same value as `MCP_AUTH_TOKEN` above.

## Development

```bash
npm test        # full suite
npm run typecheck
```

Small, single-purpose functions; TDD throughout (tests are written before the implementation
they cover, including for the reconciliation logic itself — this is a tool that generates
tests, so its own correctness matters as much as any feature).

## Current scope, and what's deliberately not built yet

v0 is scoped to prove the core loop, not to be feature-complete. Deliberately deferred, and
tracked as real backlog rather than silently skipped:

- Reconciliation on API-shaped ambiguity (a validation rule, an error-response shape) is still
  genuinely untested — the one differently-shaped real app validated so far (catchandtrade)
  happened to have zero comment/TODO signals to reconcile, so this specific question has no
  answer yet either way. See [docs/v0-findings.md](docs/v0-findings.md).
- Video/screen-recording ingestion and the video-LLM flagged-window review.
- Original-CLAUDE.md / auto-memory as an evidence source.
- Live Chrome MCP capture for auth-gated/multi-account flows a headless crawler can't reach.
- Asset-manifest extraction (binary files copied byte-verbatim + a hash manifest, locked
  contract tier) — real design exists, not yet built.
- A mutator that no-ops a handler entirely (the current three — flip comparison, drop null
  check, off-by-one — can't produce a "this branch never ran" mutant).

See [docs/v0-findings.md](docs/v0-findings.md) for the full, honest write-up: the real bugs
found and fixed during validation, the comparison across model tiers, and what's still open.

## License

[MIT](LICENSE)
