# Second-application audit: protocol, frozen before the rebuild was run (2026-10-01)

**App:** `abdoulayebinta/mini-express-recipes-api` at `857d02fb`. It's an Express 4 server with 8
contracted routes, passport-JWT auth, and JSON-file storage. The local copy differs from `857d02fb`
only by the export guard added to `src/index.js` for the validator run.

**Rebuild audited:** the preserved build-from-contracts rebuild in `~/codex-e2e/recipes-api-rebuild`
(files written 2026-09-24 15:18–15:19 local). That matches the **Codex** build-from-contracts run
(findings log, "Build-from-contracts rebuild on Codex, Hyrum's setup", ~21:21Z). The Claude Code
rebuild from earlier that day used the same directory and was overwritten, so it is not audited.
Its package (0.2.13 era) carries handler source in contracts plus three owner-flagged bug
decisions.

**Prior exposure, disclosed:** the author wrote this battery after reading the findings log. That
log already records the rebuild's known differences: JSON error shape, no seed data, flagged bugs
fixed. So checks R02 (seed count) and the error-shape comparisons were written knowing a mismatch
was likely. This is an audit of known-category behavior, not a blind test.

**Battery (`battery.mjs`).** Each run gets a fresh copy of the app (so data files start from their
preserved state), real HTTP, and `JWT_SECRET=audit-secret`. There are 19 checks, R01–R19:
- the redirect;
- the list, plus the seed count;
- a seeded item;
- 401s without a token or with a garbage token, on POST, PUT and DELETE;
- signup new and duplicate;
- login correct, wrong password, and unknown email;
- create with a token, plus an empty-body create;
- get created, update created, delete created;
- malformed JSON;
- a missing id.

**Golden (`golden-original-857d02f.json`):** run twice on the original, identical both times.

**Scoring rule (fixed now):**
- **Expected answer:** the original's answer, except for the three owner-flagged checks, where the
  package told the rebuild *not* to reproduce the bug, so the expected answer is the flagged
  intent:
  - R11: login with a wrong password → **401**;
  - R16: PUT created recipe → **200** with `data`;
  - R17: DELETE created recipe → **204**.
- **Match:**
  - The status must be equal, and so must the top-level JSON keys (`non-json`/`empty` compared
    literally).
  - R01 additionally needs the same `Location`.
  - R03, R13 and R15 additionally need the same `data` keys.
  - Flagged checks: status only, plus `data` present for R16.
- **R02 seed:** scored separately, as the list length equal to the original's 12.
- **R19:** the original crashes, giving no response. That is an unflagged original defect, so R19
  is reported descriptively and not scored.
- **Reporting:** the whole battery, check by check, grouped as auth, data and shape, errors, and
  flagged.

## Results (run after the freeze in `51cb25d`; `results-rebuild-codex.json`, `score-output.txt`)

**Rebuild:** the Codex CLI 0.153.4, `gpt-6-astra` at medium effort, built from the 0.2.13 package.
Every contract carried the handler source; three bugs were flagged; there were 0 visible tests.

**Result:** 18 scored checks, **11 full matches, 15 status matches.**

| Group | Full | Status | Divergence |
|---|---|---|---|
| Flagged bugs (R11, R16, R17) | 3/3 | 3/3 | All fixed as instructed: wrong password → 401, PUT → 200, DELETE → 204 |
| Data and shape (R01–R03, R08, R10, R13, R15) | 6/7 | 6/7 | R03: no seed data. The list is empty (0 items vs. 12), so recipe 1 → 404 |
| Errors (R09, R12, R14, R18) | 0/4 | 4/4 | Error body `{message}` vs. the original's `{status, statusCode, message}` (error middleware) |
| Auth (R04–R07) | 2/4 | 2/4 | **R06/R07: unauthenticated PUT/DELETE on a missing id → 404, where the original returns 401** |
| R19 (unscored) | | | The original crashes on a missing id; the rebuild returns 404 |

**Mechanism behind R06/R07, read from the rebuild's source:** the rebuild moved the original's
`recipeExist` check from the handler chain (`auth.authenticate()` then `recipeExist`) into
`router.param('id')`. Express runs that before any route middleware, so existence is checked
before authentication. For an id that doesn't exist, an unauthenticated caller learns that,
where the original rejects them first. The same relocation is what removed the original's
unflagged missing-id crash (R19).

**The earlier side-by-side missed it.** The 14-request comparison in the findings log
(2026-09-24) recorded "401 without a token" as matched, because it used ids that existed.

**The package's own gate saw none of this:**
- 0 visible tests (all 8 downgraded to weak);
- 2 held-out tests (`status < 500`), both passing on the rebuild;
- the weak tests are hints and gate nothing.

**Limits:**
- One rebuild of one small app, built by a different model and CLI than the sealed study.
- An author-written battery with disclosed prior exposure.
- Data and error-shape gaps were expected; the auth-ordering divergence was not.
