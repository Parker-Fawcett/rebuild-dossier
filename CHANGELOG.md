# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.13] - 2026-09-24

Found by a stand-in validator run through the OpenAI Codex CLI, on an unfamiliar Express app with routers, JWT auth and JSON-file storage.

### Added
- **Codex support.** Every package now also ships `AGENTS.md` (the same rules as `CLAUDE.md`, which Codex doesn't read) and `.codex/hooks.json`, which runs the same write guard and heartbeat. The guard now reads Codex's `apply_patch` edits by their `*** Add/Update/Delete File:` and `*** Move to:` headers, unwraps argv-array shell commands, and locks `.codex/`. Checked live on Codex CLI 0.153.4: 4 of 4 protected writes were blocked and an ordinary write was allowed. **Codex runs a project's hooks only after you trust them** (the startup review prompt); untrusted, nothing is guarded, and nothing says so. The validator guide covers both CLIs.
- **`unrunnableReasons`** in `generate_spec`'s output: the first error line for each test that failed against the unmodified app, plus a note on the usual cause (the app can't start in a scratch copy: a missing `.env` value, a service, a Node version). Before this, a package could come back entirely unrunnable with no clue why.

- **Contracts now carry the handler's code, not just its registration line.** For each Express route, the handler is followed from the registration, including by name through `require`/`import` into controller files, and its source is written into the contract verbatim, plus the local functions it calls (one level: services, file-persistence helpers). The same resolved code now feeds the extractors (request fields, success status, response fields, validation), and the mutation check mutates the handler's file instead of the router. Before this, `router.put('/:id', auth, updateRecipe)` produced a contract with no behavior, tests that looked trusted only because the router file had nothing to mutate, and a Codex rebuild that correctly refused to guess. With it, the same agent read the behavior and reported three real bugs in the original app before building.

### Fixed
- **Express routes chained with `router.route('/x').get(…).post(…)` were invisible.** They're now one route per method.
- **Router mount prefixes were ignored.** `app.use('/api/v1/users', usersRouter)` now makes `usersRouter`'s `/signup` into `/api/v1/users/signup`. Mounts resolve through `require`/`import` bindings, inline `require(...)`, middleware arguments, and nested routers. Before this, generated tests hit paths that 404 (which still passes "status < 500"). On the cold-run app, routes found went from 3 of 8 to 8 of 8.
- Route detection accepts any router variable declared from `express()`/`Router()`, not only `app`/`router`, and still ignores lookalikes such as `axios.get('/x')`.
- **The blocklist could deadlock an Express rebuild.** When the file that exports the app (or a router it loads at startup) had only weak tests, it went on `untested-contracts.json`. Every API test imports the app, so the agent couldn't create the one file all of them need; a Codex rebuild stopped and asked, correctly. Files in the exported app's static import closure are no longer blocklisted. The cost is that untested routes inside them go unguarded, the same file-level limit a single-file app already has.
- **Every deliberate block also said the guard "did not run cleanly".** The hook command's fallback ran on any non-zero exit, including an intentional block, so agents were told a working guard was broken. It now runs only when the guard itself fails.
- The generated `CLAUDE.md` said `TypeScript` for JavaScript apps, and pointed to `rules/` instead of `.claude/rules/`.
- The "delete the `<repo>-rebuild/` folder" advice now says "delete or move aside", since Codex refuses `rm -rf`.

## [0.2.12] - 2026-09-24

Found by a second cold run of `docs/validators.md`, on an unfamiliar Express app.

### Fixed
- **Express apps exported with `module.exports = app` got tests that could never pass.** The generated test used `import { app }`, which binds `undefined` for a CommonJS module whose export is the app itself. The test server had no handler, and every request hung to a timeout. It's now a default import. On the cold-run app, this took mutation sites checked from 0 to 130. The old unit test only string-matched the import; a new one executes it.
- **Section comments were read as TODOs.** The detector matched the word "todo" anywhere, so a todo-list app's `// Add todo for user by index` headers became bug-admitting cases in the queue. It now requires a marker: uppercase `TODO`/`FIXME` anywhere, or a lowercase marker as the comment's first word (`// todo: …`).
- **A header comment was filed under the route above it.** A comment ending on the line directly above a route registration now belongs to that route.

### Changed
- **An Express app that isn't exported is no longer silent.** Before, `generate_spec` produced zero API tests without saying why, and blocklisted every route file. It now returns an `apiTestNote` that says what to add (`module.exports = app;` plus a `require.main === module` guard around `listen`), and that the existing `<repo>-rebuild/` must be deleted before re-running.

## [0.2.11] - 2026-09-24

Upgrade required if you installed with `npx`: from 0.2.9 through 0.2.10 the mutation check could not run at all.

### Fixed
- **Every generated test was marked `unrunnable` under `npx`.** 0.2.9 moved `vitest` to devDependencies to fix an npm arborist crash on cold installs, but the mutation check runs vitest itself, and npx never installs devDependencies. Every test failed its baseline, and `generate_spec` reported 0 mutation sites with no error. The tool now finds vitest in its own install, or installs a pinned `vitest@4.1.10` once into `~/.cache/rebuild-dossier/` with `--legacy-peer-deps` (which avoids the crash). If neither works, `generate_spec` stops with a clear error instead of silently degrading. Override with `REBUILD_DOSSIER_VITEST_ENTRY` or `REBUILD_DOSSIER_RUNNER_DIR`.

- **The kickoff prompt now ships the wording fix the paper reports.** Step 6 read "Only once the full visible suite is green, move to the next test", which deadlocks when read literally, because tests for routes not yet reached keep the suite red. A pre-registered randomized test found gpt-6-astra stalled on it 5/5, and 0/5 on the revision (0/4 at higher effort). Until now, the revision existed only in the experiment's prompt file. The generated `kickoff-prompt.txt` is now byte-identical to the tested file, and a unit test pins it.

### Changed
- The first `generate_spec` on a machine downloads that runner from the npm registry (about 34 MB), the only network fetch the default path makes beyond `npx` itself.

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
