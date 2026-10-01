# Mutation trace: route selection, fixed before any mutation outcome was seen (2026-10-01)

The rules are applied to the golden master only (`evidence/fidelity-oracle/golden-original-54d7e65.json`,
visible-suite routes). No mutation result had been produced or inspected when this was written.

| Role | Rule | Route |
|---|---|---|
| Authentication | First visible route in path order with the modal pattern (A 401, B 401, C 500): no token → 401; a well-formed token reaches the database, which is absent → 500 | `GET /api/pokedex` |
| Input validation | The only visible route whose no-credential request (A) returns 400 | `POST /api/auth` |
| Static control | The only visible route whose no-credential request (A) returns 200 | `GET /api/wishlist` |

For each route we trace:
1. the original handler's behavior;
2. the generated contract;
3. the archived visible test, i.e. its assertion;
4. every mutant the current tool's engine applies to the original route file, and whether the
   archived test fails on it and *why*: a wrong status, an exception, an import or infrastructure
   error, or a timeout, taken from vitest's own failure message;
5. what each rebuild returned on that route, from the oracle results.

The environment matches the oracle's: no database (`DATABASE_URL` points at a closed port). A
backend comparison is run only if the kill causes implicate backend availability.

The original package (2026-07-24) was mutation-checked by an older tool version, whose per-mutant
records were not kept. This trace re-runs today's engine (`v0.2.18-paper` code, npm 0.2.15) on the
same original source and the same archived tests. It explains the mechanism with today's operators.
It does not replay the July run.
