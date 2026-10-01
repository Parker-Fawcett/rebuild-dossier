# Mutation trace: how mutation screening can keep tests that cannot see authentication (2026-10-01)

The routes were fixed by `SELECTION.md` (commit `c249515`) before any mutation ran. The run is
`trace.mjs`, and the raw output is `trace-results.json`. It uses today's mutation engine
(`v0.2.18-paper` code) on the original catchandtrade at `54d7e65`, with the sealed study's archived
visible tests, and no database (as in the oracle). No agent runs were involved.

## Chain per route

| | `GET /api/pokedex` (authentication) | `POST /api/auth` (validation) | `GET /api/wishlist` (static control) |
|---|---|---|---|
| **Original behavior** | No `Bearer` header → `401 {error}` (line 12); a token reaches Prisma | No `action` → `400 {error}` on every battery variant | `200`, JSON array, with or without credentials |
| **Generated contract** | Signature line only (11-line file); no auth, status, or body | Signature line only | Signature line only |
| **Generated test** (archived, visible) | `GET /api/pokedex`, **no headers** → `expect(res.status).toBeLessThan(500)` | `POST /api/auth`, **no body, no action** → `toBeLessThan(500)` | `GET /api/wishlist` → `toBeLessThan(500)` |
| **Baseline** (unmutated original) | passes (401 < 500) | passes (400 < 500) | passes |
| **Mutants applied** | 5 (`drop-null-check`) | 11 (`flip-comparison` ×5, `drop-null-check` ×6) | **0**: no applicable site |
| **Killed** | **1 of 5** | **1 of 11** | n/a (unassessed) |
| **Killed mutant and cause** | Line 12 guard inverted (`!authHeader?.startsWith(…)` → `authHeader?.startsWith(…)`). With no header the request falls through, and line 13 calls `.replace` on `null`, so a **TypeError** is thrown, which the handler's catch-all turns into **500** | Line 34 `action === 'refresh'` → `!==`. A request with no action enters the refresh branch, and `request.json()` **throws** on the empty body; the catch-all returns **500** | n/a |
| **Surviving mutants** | Lines 14, 21, 30, 41: never reached by a request without a token | 10 of 11: on branches the request never reaches, or that change only which non-5xx response is returned | n/a |
| **Rebuilds, variant A** (oracle results) | Haiku: 20/20 return **200** (keys vary: `success`, `ok`, `message`, `[]`, array…). Sonnet: 10/10 return **200** (array), so even the strong tier skipped auth here | Haiku: 20/20 return **200**. Sonnet: 9/10 return 400, 1/10 returns 200 | Haiku: 6/20 match (200 array). Sonnet: 10/10 match |

## What this establishes

1. **The kills were exceptions, not missing infrastructure.** Both kills come from the mutant making
   the handler *throw* before any database access. The catch-all then converts the throw into
   `500`, which is the only thing `status < 500` can detect. The hypothesis that kills happened
   because the backend was unavailable is **disproven** for these routes. Both kills would also
   happen with a working database, because the throws come first. So no backend comparison was
   needed.
2. **The assertion is blind to authentication by construction.** The test request carries no
   credentials, so the original's `401` and a rebuild's unauthenticated `200` both satisfy
   `< 500`. The mutant that inverts the guard was caught by the exception it caused: the next line
   dereferences `null`. The test's assertion never distinguished the original `401` from a
   non-crashing response.
3. **One kill is enough to retain a test.** The tool keeps a test as mutation-sensitive when it kills
   ≥ 1 mutant. Here that was 1 of 5 and 1 of 11, each kill caused by an exception, and the static
   route had no mutation site at all, i.e. it was unassessed. The screen certified tests that were
   sensitive to crashes, not to the guarded behavior.
4. **Consistent with the constant-200 baseline** (`../baselines/constant-200/`): a handler that does
   nothing passes all 32 archived tests.

## Limits

- Three routes, chosen by stated rules from one application.
- Today's operators, not a replay of the July run, whose per-mutant records were not kept.
- The rebuild column reports variant A only. The full battery is in
  `../fidelity-oracle/results/`.

## Reproduce

```
# 1. the original at 54d7e65, with dependencies installed (apps/web/package.json, npm ci)
git -C <catchandtrade> worktree add <dir> 54d7e65
# 2. the sealed study's visible tests, from an archived snapshot
mkdir -p /tmp/vis && tar -xzf evidence/runs/sealed-haiku/A-rep2/snapshot.tar.gz -C /tmp/vis ./tests/visible
# 3. run (needs the repo's dist/ build: npm run build)
ORIGINAL=<dir>/apps/web VISIBLE_TESTS=/tmp/vis/tests/visible node evidence/mutation-trace/trace.mjs
```
