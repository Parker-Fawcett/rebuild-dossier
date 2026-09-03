# Contributing to rebuild-dossier

Thanks for taking the time to contribute. This is an academic/research project (arXiv:2608.23616) that makes rebuild specs mechanically enforceable. Anything that strengthens that goal is welcome.

## Getting started (under 10 minutes)

```bash
git clone https://github.com/Parker-Fawcett/rebuild-dossier.git
cd rebuild-dossier
npm install
npm run build
npm test
```

That's the whole local loop. No database, no API keys, no env vars.

## Daily commands

```bash
npm test          # vitest run — the full suite (this is what CI runs)
npm run test:watch  # vitest in watch mode, while you develop
npm run typecheck # tsc --noEmit
npm run build     # tsc -p tsconfig.build.json (compiles dist/)
```

## Where the code lives

- `src/spec/` — the core: field inference, contracts, test and spec generation. Most issues touch this.
- `src/ingest/` — route detection, package.json parsing, evidence schema.
- `src/mutation/` — the mutation-testing engine.
- `src/tools/` — the six MCP tool entry points.
- `test/unit/` — mirrors `src/` one-to-one, all `*.spec.ts` (vitest, node env).
- `test/fixtures/sample-repo/` — fixture repos used by integration tests.

## Tests: the one convention that matters

The test layout mirrors `src/` exactly:

```
src/spec/inferRequestBodyFields.ts      →  test/unit/spec/inferRequestBodyFields.spec.ts
src/ingest/evidenceSchema.ts            →  test/unit/ingest/evidenceSchema.spec.ts
```

Tests for the inference modules call the public function directly with **inline source strings** (no fixture files), through a small `route()` helper. Open an existing spec before writing yours — copy its shape.

If your change modifies behavior, you add or update tests and run `npm test`. It must be green.

## Issue labels (what to pick up)

- **`good first issue`** — self-contained, one function, the issue names the exact file, function, and the shape of the fix. Best starting point.
- **`help wanted`** — real and worth doing, but needs more context on the surrounding pipeline than a first issue implies.
- **`bug`** — the tool did something undocumented and unexpected, not already disclaimed in the source's "Known, named limitations" comment block.
- **`enhancement`** — a gap already named as an accepted, in-scope-later limitation.
- **`question`** — the right fix depends on a product/scope decision, not just an implementation choice.

Check the top of a source file for its "Known, named limitations" comment block before filing. If the gap is already listed there, it's an `enhancement`, not a `bug`.

## Making changes

1. Fork the repo, branch from `main`.
2. Keep it focused. One thing per PR.
3. Write or update tests. Run `npm test` before opening the PR.
4. Update any docs that are now wrong.
5. Open the PR. Reference the issue number.

**Merging into `main`** requires both CI jobs (Node 20.x and 22.x) green and one approving review. Branch protection enforces this for everyone but the repo owner, so give review a couple of days.

## Working on the core inference logic

Read this before touching `infer*`/`reconcile*` internals.

**The one non-negotiable rule:** auto-resolving an ambiguity requires both signal agreement *and* an affirmative signal that someone actually decided (a stated comment, a TODO admitting a bug, or a direct human answer). Silent agreement alone — code and observed behavior simply matching, with no one having said why — always becomes a question, never an auto-resolution, no matter how confident it looks.

A contribution that makes the tool silently auto-resolve on agreement alone weakens the paper's hypothesis and will be sent back. If you're unsure whether a change touches this, ask in the issue before writing code.

## First-time contributor?

Start with a `good first issue`. If none fit, open an issue asking what would be most useful. I'm happy to pair on something.

## Questions?

Open an issue. I respond within 24 hours on weekdays.
