# Architecture

How the pieces wire together, so a first-time contributor can find where a change lives.

## The pipeline, from repo to spec

```
                 persist                read
 original app ──────────▶ .dossier/ ◀───────── rebuild spec generator
     │   ▲                     │                    │
     │   │  ingest_repo        │  get_case_queue     │  generate_spec
     │   └─────────────────────┼─────────────────────┘
     │   crawl_site  (optional)│
     ▼                         │
  crawl/ evidence              │
```

The whole thing is a straight pipeline feeding one scratch directory,
`<repo>/.dossier/`, and ending in a sibling `<repo>-rebuild/` tree. Nothing is
shared or uploaded; everything runs locally against the shoulder directory
`<repo>/.dossier/`.

## The two phases

**Phase 1 — ingest & reconcile** (`ingest_repo`, `crawl_site`, `flag_known_bug`,
`get_case_queue`, `resolve_case`). These build up evidence in `.dossier/` and
winnow it into a case queue of genuine ambiguities. The invariant:
`generate_spec` refuses to run while any case is open.

**Phase 2 — spec generation** (`generate_spec`). Reads settled evidence, runs a
real mutation check against a scratch copy of the original, and writes the full
self-contained `<repo>-rebuild/` tree: `CLAUDE.md`, `.claude/` (rules, hooks,
subagents, skill), `spec/` (contracts, locked decisions), and a mutation-tested
test suite.

## Directory map (`src/`)

| Directory | Responsibility | Key files |
|---|---|---|
| `tools/` | The six MCP tool handlers + their zod schemas | `ingestRepo.ts`, `crawlSite.ts`, `flagKnownBug.ts`, `getCaseQueue.ts`, `resolveCase.ts`, `generateSpec.ts` |
| `ingest/` | Static analysis: routes, build config, existing tests, comment signals, structural smells | `ingestRepo.ts` (orchestrator), `routeDetectors/` (Express + Next App Router), `smellDetectors/` (e.g. `clientSideSecretGate.ts`) |
| `crawl/` | Headless Playwright crawl of reachable routes, with progress heartbeats | `crawler.ts`, `crawlEvidenceSchema.ts` |
| `reconciliation/` | Turns signals into open/auto-resolved cases. **The non-negotiable rule lives here.** | `buildCases.ts`, `classifyCase.ts`, `matchKnownBug.ts`, `nearDuplicateComponents.ts`, `signalDetectors/` |
| `spec/` | Everything `generate_spec` writes into `<repo>-rebuild/` | `writeSpecTree.ts` (orchestrator), `generateContracts.ts`, `generateTests.ts`, `generateGateTests.ts`, `generatePageTests.ts`, `generateSettingsJson.ts`, `pinDependencyVersions.ts` |
| `mutation/` | The mutation check: break the original in a scratch copy, confirm tests catch it | `engine.ts`, `runMutationCheck.ts`, `mutators/` (flip comparison, drop null check, off-by-one) |
| `state/` | Atomic persistence of evidence, cases, and known bugs in `.dossier/` | `evidenceStore.ts`, `caseStore.ts`, `knownBugs.ts`, `atomicWrite.ts` |
| `security/` | Local-only guards for the HTTP transport | `pathAllowlist.ts`, `urlAllowlist.ts`, `timingSafeEqualString.ts` |

## The non-negotiable rule

`src/reconciliation/classifyCase.ts` implements the invariant from the README:
**silent signal agreement is never enough to auto-resolve.** An ambiguity becomes
`auto_resolved` only when signal agreement coexists with an affirmative intent
signal (a stated comment, a TODO admitting a bug, or a direct human answer).
Silent agreement always surfaces as an open question, no matter the confidence.
If you change how cases reconcile, this file is where it happens — and its own
unit tests guard it.

## Where a change for each kind of work goes

- **New route detector** (another framework): add under `ingest/routeDetectors/`, register in `ingestRepo.ts`.
- **New structural smell**: add under `ingest/smellDetectors/`, wire into `ingestRepo.ts`; if it can produce ambiguity, it also needs reconciliation handling.
- **New spec artifact** (write something new into `<repo>-rebuild/`): add under `spec/` and call it from `writeSpecTree.ts`.
- **New mutator**: add under `mutation/mutators/`, register in `mutation/engine.ts`.
- **New signal type for reconciliation**: add under `reconciliation/signalDetectors/`.
- **Transport / auth / gating**: `security/`, plus `httpServer.ts` and `src/server.ts`.

## Backlog

Tracked in `docs/v0-findings.md` and the README ("what's deliberately not built
yet"). The design for asset-manifest extraction already exists in
`src/spec/assetManifestSchema.ts`; the other deferred items are scoped but
unbuilt. Good first contributions live there and in the `good first issue`
tag on GitHub.
