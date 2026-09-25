# External production case (paper §V-C): record and provenance

**Date of run:** 2026-09-24. **Tool:** `rebuild-dossier@0.2.14` from the npm registry
(`npx -y rebuild-dossier@0.2.14`). **Rebuild agent:** `claude-sonnet-5`, Claude Code 2.1.282.

**Operator:** an engineer at a healthcare staffing company, not involved in the tool's development
and not on the team that owns the application. The operator cleared the run with their company
before starting and approved publishing this material in this redacted form. The author works at
the same company. The application is an internal analytics app owned by another team there.

## Who did what

| Step | Done by |
|---|---|
| Instructions: `docs/validators.md`, plus a step-by-step message pinning 0.2.14 and naming the export fix | Author |
| Cloning a fresh copy; adding `module.exports = app` and the `require.main` guard; adding placeholder warehouse settings | Operator |
| `ingest_repo`; resolving all 23 cases (spot-checked against the code) | Operator |
| `generate_spec` (twice; the first run was all-unrunnable, see report) | Operator |
| Sealing: moving the original away, running a fresh top-level session with `kickoff-prompt.txt` | Operator |
| Three session resumes: two to approve dependency installation (one stubbing a private package); the operator reports none as design steering | Operator |
| Re-running visible and held-out suites; side-by-side HTTP comparison | Operator |
| Report (drafted with Claude, edited by the operator) | Operator |
| Checking the claims below against the operator's logs and the generated spec | Author |

An earlier attempt the same day did **not** follow the guide and is not counted: the operator's
agent batch-resolved the cases on keywords, `generate_spec` made no tests (no exported app), and the
agent only checked that the original boots. It is recorded in `docs/v0-findings.md`.

## Files

- `operator-report.md`: the operator's report, redacted (see its header for the redaction rules).
- `routes.md`: stable route IDs (R1–R10) with each route's input class and what happened.
- `operator-logs/`: the operator's raw outputs, redacted the same way:
  - `hook-heartbeat.json`: count 7.
  - `visible-vitest-output.txt`: 7/7 files, 8/8 tests.
  - `heldout-vitest-output.txt`: 0/1 files, 1/2 tests. R5 returned 404 where 200 was expected.
  - `generate-spec-output.json`: 1,424 mutations checked, 21 unrunnable with reasons. Its last
    block is the operator's annotation, not tool output.

## What the author verified, and how

| Claim | Check | Result |
|---|---|---|
| Visible 7/7 files, 8/8 tests; held-out 0/1 files, 1/2 tests; heartbeat 7 | Operator's raw vitest output and heartbeat file | Match |
| 7 visible + 1 held-out + 21 unrunnable = 29 | The spec package the operator sent, and the `generate_spec` output | Match |
| 5 of 29 contracts have no Handler section (R3–R7) | Grep of the 29 generated contracts for `## Handler` | Confirmed: exactly those 5 |
| The cause is the bracket matcher treating a lone quote in a comment as a string | Ran `resolveExpressHandler` (0.2.14) on the app's server file, and on a copy with only the quote characters removed from `//` lines | Original: R3–R7 unresolved. Quote-stripped: all 5 resolve, and R2's direct callee H2 reappears |
| R1's missing helper is two calls below the handler | R1's contract lists its SQL builder as a one-level callee; H1 is called only inside that builder | Confirmed |
| Both R1 and R2 fail on every request past their 400 guard | Read both handlers: each calls the builder (R1) or H2 (R2) unconditionally after the guard | Confirmed |
| The private-package stub cannot explain the `ReferenceError`s | Searched the server file for any reference to the stubbed package | 0 references: the server never imports it |
| Nothing changed on the app's repository | Checked the repository's branches, commits and PRs after the first attempt | No new branch, commit, PR or fork |
| After the fix (0.2.15), every handler resolves | Ran the fixed `resolveExpressHandler` on the unmodified server file | 29/29 resolve; R2's callees include H2 |

## Minimal reproducer (public)

The two extraction behaviors behind the headline are reproduced on small synthetic Express files in
`test/unit/spec/resolveExpressHandler.spec.ts`:
- `resolves a handler whose body has an apostrophe in a // comment`
- `keeps a direct helper whose definition has a lone quote in a line or block comment`

Both fail on 0.2.14 and pass on 0.2.15.
- `captures helpers one level deep, not the helpers they call` documents the one-level scope
  limit (by design; unchanged).

## Withheld, and why

Withheld: the application's source; the generated spec package (its contracts quote the handlers'
source verbatim); the rebuilt code; and the unredacted route paths and helper names. All of it is
the company's proprietary code, and publishing it is not the operator's decision to make. Without
warehouse credentials, production-path equivalence was never evaluated. The side-by-side comparison
covers only failure behavior and the four checks that run without the warehouse.
