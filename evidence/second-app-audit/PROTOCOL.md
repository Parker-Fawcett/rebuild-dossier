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
