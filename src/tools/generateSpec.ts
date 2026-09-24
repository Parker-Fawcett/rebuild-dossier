import * as z from 'zod/v4';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';
import { loadCases } from '../state/caseStore.js';
import { loadEvidenceBundle } from '../state/evidenceStore.js';
import { writeSpecTree } from '../spec/writeSpecTree.js';
import { enforcePathAllowlist } from '../security/pathAllowlist.js';
import { findCandidateAppDirs } from '../ingest/detectMonorepoHint.js';
import { unsupportedStackHint } from '../ingest/unsupportedStackHint.js';
import { VISION_PAGE_PACING_DELAY_MS } from '../spec/visionClassifier.js';

export const generateSpecInputSchema = z.object({
  repoPath: z.string().describe('Repo path that was ingested; output is written to a sibling <repoPath>-rebuild/ directory'),
  authStorageStatePath: z
    .string()
    .optional()
    .describe(
      'Optional path to a Playwright storageState JSON file (cookies/localStorage from an already-authenticated session against ' +
        'the target app) — load it once with `npx playwright open <url> --save-storage=state.json` after logging in by hand, or ' +
        'any equivalent one-time export. When set, page capture uses it to reach auth-gated pages instead of only ever seeing a ' +
        'login screen; this tool never logs in itself or handles credentials. The file is copied into the rebuild output ' +
        '(tests/fixtures/auth-storage-state.json, gitignored) so generated page tests can reach the same pages when run standalone.'
    )
});

const skippedPageOutputSchema = z.object({
  routeFile: z.string(),
  reason: z.string()
});

export const generateSpecOutputSchema = z.object({
  outputDir: z.string(),
  mutationsChecked: z.number().int(),
  weakTests: z.array(z.string()),
  unrunnableTests: z.array(z.string()),
  capturedPages: z.number().int(),
  skippedPages: z.array(skippedPageOutputSchema),
  visionClassificationEnabled: z.boolean(),
  // Present only when the target repo has no node_modules of its own — see
  // the missingNodeModules check below.
  warning: z.string().optional(),
  // Present only when skippedPages is non-empty.
  pageCaptureNote: z.string().optional(),
  // Present only when visionClassificationEnabled is true.
  visionClassificationNote: z.string().optional(),
  // Present only when one or more captured pages fell back to the regex
  // classifier despite vision being enabled.
  pageVisionFallbacks: z.array(skippedPageOutputSchema).optional(),
  pageVisionFallbackNote: z.string().optional(),
  // Present only when Express API routes exist but none got a generated test.
  apiTestNote: z.string().optional(),
  // Present only when unrunnableTests is non-empty: the first error line per file.
  unrunnableReasons: z.record(z.string(), z.string()).optional(),
  unrunnableNote: z.string().optional(),
  // Present only when no generated test survived as visible.
  noVisibleTestsNote: z.string().optional()
});

export const generateSpecConfig = {
  title: 'Generate spec',
  description:
    'Write CLAUDE.md, .claude/, spec/, tests/, and kickoff-prompt.txt to <repo>-rebuild/. Only callable once the case queue is empty. ' +
    'Optional: if the target is a Next.js app with page routes, set GROQ_API_KEY and REBUILD_DOSSIER_ENABLE_VISION_CLASSIFICATION=1 ' +
    'before calling this tool to enable vision-assisted page-content classification (sends each captured page\'s screenshot and source ' +
    'code to Groq to judge static vs. dynamic content more accurately than plain regex matching) — ask the user for a Groq API key if ' +
    'they want more reliable generated page tests and this isn\'t already configured. Off by default; nothing changes if unset. ' +
    'Optional: pass authStorageStatePath to reach auth-gated pages during capture — see that field\'s own description for how to ' +
    'produce it.',
  inputSchema: generateSpecInputSchema,
  outputSchema: generateSpecOutputSchema,
  annotations: {
    title: 'Generate spec',
    // Writes an entire tree to a sibling <repo>-rebuild/ directory —
    // overwriting whatever a previous run (or anything else) left there, so
    // destructive, not just additive. Not idempotent: page capture spawns a
    // real `next dev` + Chromium instance, and the mutation check runs the
    // target's own tests against deliberately-broken copies of its code —
    // neither is guaranteed to reproduce byte-identical output run to run.
    // openWorldHint is true because, when vision classification is enabled,
    // this tool sends captured page screenshots and source code to Groq's API
    // — a real external system outside this tool's own control.
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true
  }
};

function siblingRebuildDir(repoPath: string): string {
  return join(dirname(repoPath), `${basename(repoPath)}-rebuild`);
}

// Pure, exported so the computed pacing estimate is unit-testable without a
// real browser or writeSpecTree call (matches this codebase's convention of
// extracting anything with actual logic — see applyVisionClassification,
// redactObviousSecrets — for exactly this reason).
export function buildVisionClassificationNote(capturedPageCount: number): string {
  const pacingSeconds = VISION_PAGE_PACING_DELAY_MS / 1000;
  const estimatedAddedSeconds = Math.round((Math.max(0, capturedPageCount - 1) * VISION_PAGE_PACING_DELAY_MS) / 1000);
  return `Vision-assisted DOM-text classification is enabled — each captured page's screenshot and (redacted) source code is sent to the configured Groq model. This adds one API call per page, plus a deliberate ${pacingSeconds}s pacing delay between pages (to stay under the free tier's per-minute token budget) — roughly ${estimatedAddedSeconds}s of added time for this run's ${capturedPageCount} captured page(s), on top of the existing capture cost. Page content leaves this machine when this is enabled.`;
}

export async function generateSpecHandler(args: z.infer<typeof generateSpecInputSchema>) {
  enforcePathAllowlist(args.repoPath);
  // The sibling <repo>-rebuild/ output dir is a write target in its own
  // right, and — unlike ingest_repo's reads — isn't necessarily inside
  // repoPath itself (it's a sibling, not a child), so an allowlist scoped to
  // one exact repo rather than its parent directory wouldn't otherwise cover it.
  enforcePathAllowlist(siblingRebuildDir(args.repoPath));

  // Fails loudly here, before any capture work starts, rather than letting a
  // missing/stale/malformed file silently degrade capture back to an
  // unauthenticated session — that would look identical to "the fix didn't
  // help" instead of "the file you pointed at is wrong."
  if (args.authStorageStatePath) {
    enforcePathAllowlist(args.authStorageStatePath);
    if (!existsSync(args.authStorageStatePath)) {
      return {
        content: [{ type: 'text' as const, text: `authStorageStatePath does not exist: ${args.authStorageStatePath}` }],
        isError: true
      };
    }
    try {
      JSON.parse(readFileSync(args.authStorageStatePath, 'utf-8'));
    } catch {
      return {
        content: [
          { type: 'text' as const, text: `authStorageStatePath is not valid JSON: ${args.authStorageStatePath}` }
        ],
        isError: true
      };
    }
  }

  const openCases = loadCases(args.repoPath).filter((c) => c.status === 'open');
  if (openCases.length > 0) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Cannot generate spec: ${openCases.length} case(s) still open. Resolve them via get_case_queue/resolve_case first.`
        }
      ],
      isError: true
    };
  }

  const evidence = loadEvidenceBundle(args.repoPath);
  if (!evidence) {
    return {
      content: [{ type: 'text' as const, text: `No evidence found for ${args.repoPath} — run ingest_repo first.` }],
      isError: true
    };
  }

  // Real bug, found via a live fresh-agent handoff: ingest_repo's own
  // monorepoHint correctly steers a user to re-ingest the actual app
  // directory, but generate_spec had no equivalent guard — if it's then
  // called against the monorepo ROOT path (whose own, separate evidence.json
  // still has 0 routes from the original ingest), it silently produced a
  // valid-looking but completely empty spec instead of refusing.
  if (evidence.routes.length === 0) {
    const candidates = findCandidateAppDirs(args.repoPath);
    if (candidates.length > 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Cannot generate spec: 0 routes were ingested for ${args.repoPath} — this looks like a monorepo root, not the app itself. Re-run ingest_repo and generate_spec pointed at one of these candidates instead: ${candidates.join(', ')}`
          }
        ],
        isError: true
      };
    }

    // Real, live-triggered finding: pointing this at an unsupported stack
    // (a Python app was the case that surfaced it, but any repo lacking
    // next/express) fell through this same 0-routes branch with no monorepo
    // candidates, and generated a valid-looking but silently empty spec
    // whose only complaint was `missingNodeModules` — "run npm install" is
    // actively misleading advice for a stack `npm install` can't help. This
    // is the one case the tool can actually diagnose instead of guessing.
    const stackHint = unsupportedStackHint(args.repoPath, evidence);
    if (stackHint) {
      return {
        content: [{ type: 'text' as const, text: `Cannot generate spec: 0 routes were ingested for ${args.repoPath}. ${stackHint}` }],
        isError: true
      };
    }
  }

  const outputDir = siblingRebuildDir(args.repoPath);
  const cases = loadCases(args.repoPath);
  const { mutationReport, capturedPages, skippedPages, visionClassificationEnabled, pageVisionFallbacks, apiTestNote } = await writeSpecTree({
    repoPath: args.repoPath,
    outputDir,
    evidence,
    cases,
    authStorageStatePath: args.authStorageStatePath
  });

  // Real finding: a target repo with no node_modules of its own makes every
  // generated test fail to even import its dependencies inside the
  // mutation-check scratch copy — every test lands in tests/weak/ as
  // "unrunnable," with nothing in the output explaining why. This was
  // initially misdiagnosed as a database/infrastructure problem; the actual
  // cause (missing `npm install`) is much simpler and worth stating plainly.
  const missingNodeModules = !existsSync(join(args.repoPath, 'node_modules'));
  // Found live: an auth-protected Express API ended with every test weak or
  // unrunnable, and the rebuild agent, told to start from a failing visible
  // test, had none and could only stop and ask.
  const visibleDir = join(outputDir, 'tests', 'visible');
  const visibleCount = existsSync(visibleDir) ? readdirSync(visibleDir).filter((f) => f.endsWith('.ts') || f.endsWith('.js')).length : 0;

  const result = {
    outputDir,
    mutationsChecked: mutationReport.results.length,
    weakTests: mutationReport.weakTestFiles,
    unrunnableTests: mutationReport.unrunnableTestFiles,
    // Mirrors weakTests/unrunnableTests above: a generate_spec call
    // that captured only some pages (a Playwright/next-dev hiccup on
    // one route) must never look identical to one that captured all
    // of them — see generatePageTests.ts's skipped-page visibility
    // requirement.
    capturedPages: capturedPages.length,
    skippedPages,
    // Always present, not conditional — whether vision classification
    // ran at all must never be silently ambiguous from the response.
    visionClassificationEnabled,
    ...(missingNodeModules
      ? {
          warning:
            'No node_modules found in the target repo — mutation-check results are unreliable without the target\'s own real dependencies installed. Run `npm install` in the target repo, then re-run generate_spec.'
        }
      : {}),
    ...(skippedPages.length > 0
      ? {
          pageCaptureNote:
            'One or more page routes could not be captured (see skippedPages) — those pages have no generated test and stay in spec/untested-contracts.json. Note that page-test generation also spawns a real `next dev` + Chromium instance, which makes generate_spec noticeably slower for apps with many pages.'
        }
      : {}),
    ...(visionClassificationEnabled ? { visionClassificationNote: buildVisionClassificationNote(capturedPages.length) } : {}),
    ...(pageVisionFallbacks.length > 0
      ? {
          pageVisionFallbacks,
          pageVisionFallbackNote:
            'One or more pages could not be vision-classified and fell back to regex-based classification for that page (see pageVisionFallbacks) — those pages\' dynamic-vs-static assertions may be less accurate.'
        }
      : {}),
    ...(apiTestNote ? { apiTestNote } : {}),
    ...(visibleCount === 0
      ? {
          noVisibleTestsNote:
            'No generated test survived as a visible test (see weakTests and unrunnableTests), so the rebuilding agent has no failing test to start from and will likely stop and ask. The contracts in spec/contracts/ still carry each handler\'s code. When it asks, telling it to build from the contracts one route at a time, treating tests/weak/ as hints, is a fair answer; note that you gave it.'
        }
      : {}),
    ...(Object.keys(mutationReport.unrunnableReasons).length > 0
      ? {
          unrunnableReasons: mutationReport.unrunnableReasons,
          unrunnableNote:
            'Each unrunnable test failed against your unmodified app, so it was set aside, not trusted (see unrunnableReasons for the first error from each). When most or all fail with the same error, the app usually cannot even be imported in a scratch copy: a missing environment variable its .env normally supplies, a service it connects to at startup, or a Node version its dependencies do not support. Fix that in your copy, delete or move aside the <repo>-rebuild/ directory this run wrote, and re-run generate_spec.'
        }
      : {})
  };

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    structuredContent: result
  };
}
