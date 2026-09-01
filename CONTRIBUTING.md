# Contributing to rebuild-dossier

First off, thanks for taking the time to contribute! 🎉

This is an academic/research project, so contributions should align with the design described in the paper ([arXiv:2608.23616](https://arxiv.org/abs/2608.23616)). The goal is to make rebuild specs mechanically enforceable — anything that strengthens that goal is welcome.

## Getting Started

```bash
# Clone the repo
git clone https://github.com/Parker-Fawcett/rebuild-dossier.git
cd rebuild-dossier

# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test
```

## Development Workflow

- **TypeScript** for all source code in `src/`
- **Vitest** for tests — `npm test` runs the full suite
- **tsconfig** for type checking — `npm run build` compiles everything

### Making Changes

1. Fork the repo and create a branch from `main`
2. Make your changes — keep them focused. One thing per PR.
3. Write or update tests for any behavioral change
4. Run `npm test` before opening a PR
5. Update any docs that are now wrong

### Reporting Issues

Use the bug report or feature request templates. Include:

- **For bugs:** what you expected, what actually happened, steps to reproduce, and the version you're running
- **For features:** the problem you're solving, what you'd like to happen, and why it matters

### Issue Labels

- **`bug`** — the tool did something undocumented and unexpected; no existing "known limitations" comment in the relevant source file already disclaims it.
- **`enhancement`** — the gap is already named as an accepted, in-scope-later limitation (check the source file's own "Known, named limitations" comment block before filing — if it's already there, this is the right label, not `bug`).
- **`question`** — the right fix depends on a product/scope decision (e.g. whether the tool should ever touch a target app's live data), not just an implementation choice.
- **`good first issue`** — self-contained, one function, a concrete repro and a specific fix already spelled out in the issue.
- **`help wanted`** — real and worth doing, but needs more context on the surrounding pipeline than `good first issue` implies.
- **`duplicate`** / **`invalid`** / **`wontfix`** — standard GitHub meanings.

A tracking issue that catalogs several related gaps (see #3) stays open as the coordinating overview even after individual items get split into their own issues — check its comments for links to whatever it split into before assuming it's stale.

### Pull Requests

- Keep them small and focused
- Include tests for any new behavior
- Update docs if behavior or usage changes
- Reference the paper if your change touches the core design
- **Merging into `main` requires both CI matrix jobs (Node 20.x and 22.x) green and at least one approving review** — branch protection enforces this for everyone but the repo owner, so don't expect a same-day merge without either.

## First-Time Contributors?

This is a great place to start. Look for issues tagged `good first issue` or `help wanted`. If you don't see anything that fits, open an issue asking what would be most useful — I'm happy to pair on something.

## Academic Alignment

This project exists to validate a specific design hypothesis: that locking interface contracts before tests run, with strict one-test-at-a-time retries, improves behavioral equivalence in agent rebuild pipelines. If your contribution touches the core pipeline or evaluation logic, make sure it doesn't silently weaken that hypothesis.

## Questions?

Open an issue. I respond within 24 hours during the workweek.