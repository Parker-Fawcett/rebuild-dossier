# Independent reproduction report — S. N. Ahmed, 2026-08-30

Author of AgentModernize (cited in this project's paper). Verified independently, not at
the project author's request beyond an invitation to reproduce the artifact.

Reproduction performed exactly against the pinned `v0.2.6-paper` tag, following the
project README's own documented steps.

## Commands executed

```bash
git clone https://github.com/Parker-Fawcett/rebuild-dossier.git parker-rebuild-dossier
cd parker-rebuild-dossier
git checkout v0.2.6-paper
npm install
npx playwright install chromium
npm test
npm run typecheck
```

## Results, as reported

- `npm install`: succeeded (162 packages)
- `npx playwright install chromium`: succeeded
- `npm test`: succeeded — 518 passing
- `npm run typecheck`: succeeded, clean

All tests passed on `v0.2.6-paper`. No blocking issues.

## Discrepancy noted and reconciled

- Paper's own evaluation snapshot (`v0.2.2-paper`) reports "512 passing (83 test files)."
- This reproduction, at `v0.2.6-paper`, found 518 passing (85 test files).
- Reconciliation: the paper's cited figure is pinned to the earlier `v0.2.2-paper` tag;
  `v0.2.6-paper` is a later snapshot with 6 additional tests across 2 additional files —
  a minor, expected version-to-version difference, not an inconsistency.

## Attribution

Reported by S. N. Ahmed via direct correspondence with the project author, quoted here
with his permission to be named and cited.
