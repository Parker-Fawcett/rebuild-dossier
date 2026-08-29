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

### Pull Requests

- Keep them small and focused
- Include tests for any new behavior
- Update docs if behavior or usage changes
- Reference the paper if your change touches the core design

## First-Time Contributors?

This is a great place to start. Look for issues tagged `good first issue` or `help wanted`. If you don't see anything that fits, open an issue asking what would be most useful — I'm happy to pair on something.

## Academic Alignment

This project exists to validate a specific design hypothesis: that locking interface contracts before tests run, with strict one-test-at-a-time retries, improves behavioral equivalence in agent rebuild pipelines. If your contribution touches the core pipeline or evaluation logic, make sure it doesn't silently weaken that hypothesis.

## Questions?

Open an issue. I respond within 24 hours during the workweek.