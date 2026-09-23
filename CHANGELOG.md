# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.10] - 2026-09-23

Upgrade strongly recommended: earlier releases did not enforce the untested-contracts rail at all.

### Fixed

- **The untested-contracts write block never worked in any earlier release.** Its inline
  `node -e` hook command contained a regex the shell collapsed into a syntax error, so it exited
  with a non-blocking error on every call and allowed every write. The spec/ lock survived only
  partially (it missed Windows-style paths).
- **The mutation check's per-run timeout is now actually enforced.** It relied on
  `execFileSync`'s timeout, which was observed not to fire (one run went ~97 minutes) and never
  killed grandchildren. Each run is now supervised in its own process group and SIGKILLed at the
  cap (120 s; `REBUILD_DOSSIER_MUTATION_TIMEOUT_MS` overrides), and stragglers are reaped.
- Version metadata is back in sync (`server.json` had drifted to 0.2.7, the lockfile to 0.2.8).

### Changed

- Both write rails now live in one generated guard script, `.claude/hooks/rebuild-guard.mjs`,
  hooked on `Edit|Write|MultiEdit|NotebookEdit|Bash`. It resolves symlinks, `..` and (macOS/Windows)
  case before matching, parses write-shaped shell commands, protects itself and `settings.json`,
  and fails closed on unreadable input, blocklist, or a missing guard. Shell parsing is heuristic:
  a write routed through a script the agent wrote earlier is not seen.
- README handoff: run the rebuild as a fresh top-level Claude Code session (subagents never load
  the hooks), seal `tests/held-out/` until the agent is done, and check the heartbeat afterward.

### Added

- `docs/validators.md`, a step-by-step protocol for external validators, and a *Validation
  report* issue template.

### Added

- GitHub Packages publish workflow (`publish-github-packages.yml`) — publishes `@parker-fawcett/rebuild-dossier` on tag push and `workflow_dispatch`.
- Root `.mcp.json` for Open Plugins auto-detect.
- Copy-paste stdio MCP config block in the README quick start section.

### Changed

- README first-run friction reduced: clearer install path, direct npx command, and Claude Code integration steps.
- `server.json` bumped to version 0.2.6 for consistency with the npm package.

## [0.2.6] - 2026-09-04

### Changed

- CI finalized for Node 24 OIDC trusted publishing to npm (`publish.yml`).
- Added node shebang to `src/index.ts` so the npm binary runs correctly.
- CI matrix: Node 20.x and 22.x with typecheck, build, test, and Playwright browser caching.

### Added

- Distribution assets: awesome-mcp-servers row, HN and r/mcp post drafts, Glama badge in README.
- Directory submission drafts for Glama, Smithery, PulseMCP, and mcp.so.
- CONTRIBUTING.md rewritten for first-time contributors with a "under 10 minutes" local loop, label taxonomy, and the non-negotiable auto-resolution rule.
- Issue-label taxonomy documented in CONTRIBUTING.md.
- PR merge requirements documented in CONTRIBUTING.md.
- First independent third-party reproduction of paper Section 7 numbers logged.
- npm publish workflow via OIDC trusted publishing (`publish.yml`).
- Package made publishable to npm with contributor docs.

## [0.2.5] - 2026-08-29

### Added

- Published to the Official MCP Registry.
- `mcpName` field in `package.json` linking to the MCP Registry namespace.
- CI concurrency cancellation, Playwright browser cache, minimal permissions, and job timeout.
- Retired `master` branch; standardized on `main` as the sole branch.
- Demo GIF showing `ingest` → `generate_spec` flow and normalized cross-platform paths.
- Dropped Node 18 from CI matrix and `engines` field (vitest 4 requires Node 20.12+).
- Typecheck, build, and test on push/PR against `main` and `master`.
- Added `MCP outputSchema + structuredContent` to all six MCP tools.

### Changed

- Marked rebuild-dossier as published on npm; documented trusted-publisher setup.
- CI: use Node 24 for npm publish (trusted publishing needs npm >= 11.5.1).
- Debugged OIDC subject to diagnose npm trusted-publisher 404.

## [0.2.3]

### Added

- Initial public release with core functionality: `ingest_repo`, `crawl_site`, `flag_known_bug`, `get_case_queue`, `resolve_case`, `generate_spec`.
- arXiv paper reference (arXiv:2608.23616) and Zenodo DOI (10.5281/zenodo.22036801).
- MIT license.
