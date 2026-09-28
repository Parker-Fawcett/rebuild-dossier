# Fidelity oracle: protocol, frozen before scoring (2026-09-27)

This protocol was written and committed **before any rebuild snapshot was run against it**. It is
author-written, not independent, and is reported as such.

## Question
For the 30 frozen sealed-study rebuilds (catchandtrade; 20 Haiku, 10 Sonnet), does the code each
rebuild built behave like the original application, on requests whose outcome the original decides
without a database? This includes the extra routes that some discipline-arm runs built beyond visible
demand. Held-out completion only checks `status < 500`. This oracle checks the status code and the
response shape against the original.

## Original
`catchandtrade` at commit `54d7e65`: the last commit before the rebuild package was generated on
2026-07-24. Three later commits changed API routes, so HEAD is not used. `apps/web/package.json` and
`prisma/schema.prisma` are identical at `54d7e65` and HEAD, so HEAD's installed dependencies are
reused.

## Battery (`fidelity.spec.ts`, `routes.json`)
It covers the 32 method-level routes in the sealed study's visible (20) and held-out (12) suites,
with the same URLs and path parameters as those tests. Each route gets a fixed, generic battery that
is not tailored per route or per rebuild:
- **A:** no Authorization header, no body.
- **B:** a non-Bearer Authorization header.
- **C:** a well-formed Bearer token in the original's scheme (base64 of `userId:timestamp`).
- **D:** for body methods only, C plus a malformed JSON body.
- **E:** for body methods only, C plus `{}`.

That is 132 checks. Each records the outcome, the HTTP status, and the sorted top-level JSON keys.
The environment is identical for the original and every rebuild: `DATABASE_URL` points at a closed
local port (`connect_timeout=1`), with no other service credentials, and an 8 s per-request timeout.

## Golden master (`golden-original-54d7e65.json`)
Run twice on the original: the results were byte-identical. 55 checks return 500, because they
depend on the database. They are **excluded** from scoring, since a 500 on both sides says nothing
about fidelity. That leaves **77 scorable checks**: 54 × 401, 11 × 400, 12 × 200.

## Scoring rule (fixed now)
- **Status match:** the rebuild's status equals the original's.
- **Full match:** the status matches and so does the set of top-level JSON keys.
- **Built check:** the snapshot has the route file and exports the method, and the handler returns
  a response.
- Import errors, a missing file, a missing export, a throw or a timeout each count as that category,
  never as a match.

Per run, report:
1. built scorable checks and matches (status, and full) on them;
2. the same split by the route's suite (visible-demanded vs. held-out, i.e. built beyond demand);
3. scorable checks on routes not built.

Reported per arm, descriptively. No test statistic is planned.

## Execution
Each snapshot is extracted fresh from its archived `snapshot.tar` (sha256-checked against
`snapshot.sha256`). Its evaluation-time `node_modules` are linked read-only, and it is run with
`vitest run --globals`, with no config, as the sealed evaluator ran held-out. The sealed `.eval`
directories are not modified.
