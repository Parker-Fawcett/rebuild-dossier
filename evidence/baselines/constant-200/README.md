# Constant-200 baseline (2026-10-01)

**Question:** how much semantic assurance did the sealed study's acceptance gate provide?

**The stub:** `stub/src/app/api/**/route.ts`, 21 files exporting the 32 methods the archived suites
import. Each method ignores its input and returns `NextResponse.json({}, { status: 200 })`.

**Run:** the stub was run against the **unchanged** archived suites, using the same
`node_modules` as sealed run `A-rep2`'s evaluation, and the same vitest invocation as the sealed
evaluator (`run-sealed-trial.sh`):

```
cp -R <sealed eval>/tests/visible stub/tests/visible               # 20 files
cp -R evidence/study-level/sealed-heldout-suite/held-out stub/tests/held-out   # 12 files
npx vitest run tests/visible  --passWithNoTests --reporter=json ...
npx vitest run tests/held-out --passWithNoTests --reporter=json ...
# fidelity battery: evidence/fidelity-oracle/fidelity.spec.ts, same env as PROTOCOL.md
```

## Result

| Gate | Stub |
|---|---|
| Visible suite | **20/20 files, 20/20 tests passed** (`stub-visible.log`) |
| Held-out suite | **12/12 files, 12/12 tests passed** (`stub-heldout.log`) |
| Fidelity oracle, 77 scorable checks | **0/77** full matches (`stub-fidelity-results.json`) |

Breaking down the 0/77:
- **Authentication (54 checks; original returns 401):** status match 0.
- **Validation (11; original returns 400):** status match 0.
- **Static responses (12; original returns 200):** status match 12, but the response keys
  differ (`{}`), so 0 full matches.

**What this shows:** a handler that does nothing passes every visible and held-out test in the sealed
study. Those suites therefore certify only that each method exists and doesn't crash on the request
they send. On authentication and validation checks, the weak-tier rebuilds score exactly what the
stub scores (0/720 and 0/180 visible-route checks). Their only full matches (18) are on static
responses.

## Reproduce (tested from a clean directory, 2026-10-01)

```
E=<repo>/evidence; W=$(mktemp -d); cd $W
# the sealed study's own manifest, lockfile, and visible tests, from an archived snapshot
tar -xzf $E/runs/sealed-haiku/A-rep2/snapshot.tar.gz ./package.json ./package-lock.json ./tests/visible
npm ci
cp -R $E/baselines/constant-200/stub/src ./src                     # the stub, in place of a rebuild
cp -R $E/study-level/sealed-heldout-suite/held-out tests/held-out
find . -name '._*' -not -path './node_modules/*' -delete            # macOS AppleDouble files, if any
npx vitest run tests/visible  --passWithNoTests                     # 20 files, 20 tests passed
npx vitest run tests/held-out --passWithNoTests                     # 12 files, 12 tests passed
```
