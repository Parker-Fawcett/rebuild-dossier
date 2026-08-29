import * as z from 'zod/v4';
import { join } from 'node:path';
import type { ServerContext } from '@modelcontextprotocol/server';
import { ingestRepo } from '../ingest/ingestRepo.js';
import { evidencePath } from '../state/dossierPaths.js';
import { atomicWriteFile } from '../state/atomicWrite.js';
import { buildCases } from '../reconciliation/buildCases.js';
import { enforcePathAllowlist } from '../security/pathAllowlist.js';
import { findCandidateAppDirs } from '../ingest/detectMonorepoHint.js';

export const ingestRepoInputSchema = z.object({
  path: z.string().describe('Absolute path to the repo to ingest'),
  interactive: z
    .boolean()
    .optional()
    .describe(
      'When true and 0 routes are found at a monorepo-shaped path, ask via elicitation which candidate directory is the real app, then ingest that instead'
    )
});

export const ingestRepoOutputSchema = z.object({
  routes: z.number().int(),
  existingTests: z.number().int(),
  signals: z.number().int(),
  buildConfig: z.array(z.string()),
  openCases: z.number().int(),
  savedTo: z.string(),
  monorepoHint: z
    .object({
      message: z.string(),
      candidates: z.array(z.string())
    })
    .optional(),
  // Only present when the interactive elicitation branch re-ingested a
  // chosen candidate on the caller's behalf — see ingestRepoHandler below.
  resolvedMonorepoChoice: z.string().optional()
});

export const ingestRepoConfig = {
  title: 'Ingest repo',
  description:
    'Parse package.json, tailwind/vite config, route files, and existing tests via static analysis. No LLM call.',
  inputSchema: ingestRepoInputSchema,
  outputSchema: ingestRepoOutputSchema,
  annotations: {
    title: 'Ingest repo',
    // Writes evidence.json to the repo's own .dossier/ scratch dir, so not
    // read-only — but re-ingesting the same path deterministically overwrites
    // it with equivalent content (static AST analysis, no external state),
    // never destroys anything the caller didn't already ask to regenerate,
    // and touches only the local filesystem, never a network resource.
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false
  }
};

const MONOREPO_CHOICE_SCHEMA = {
  type: 'object' as const,
  properties: {
    path: { type: 'string' as const, title: 'Candidate app directory (paste one of the paths listed above, exactly)' }
  },
  required: ['path']
};

// Deliberately asks rather than silently picking one — the same
// "surface ambiguity, don't silently resolve it" principle reconciliation
// already follows for silent signal agreement. A real monorepo can have
// multiple candidate apps; there's no principled basis to auto-pick one, and
// EvidenceBundle itself models exactly one app (one packageJson, one routes
// array) — aggregating several apps' worth of evidence into one ingest would
// be a bigger, riskier change than asking, and would conflate decisions
// across genuinely separate applications. Mirrors get_case_queue's own
// interactive/scripted-fallback split rather than introducing a new pattern.
async function elicitMonorepoChoice(repoPath: string, candidates: string[], ctx: ServerContext): Promise<string | null> {
  try {
    const response = await ctx.mcpReq.elicitInput({
      mode: 'form',
      message: `0 routes were found at ${repoPath} — this looks like a monorepo root, not the app itself. Which of these is the real app?\n${candidates.map((c) => `- ${c}`).join('\n')}`,
      requestedSchema: MONOREPO_CHOICE_SCHEMA
    });
    if (response.action !== 'accept') return null;
    const chosen = String(response.content?.path ?? '').trim();
    // Only acts on an exact match to a real candidate — never blindly trusts
    // free text (a typo or hallucinated path would otherwise fail confusingly
    // deeper in the pipeline instead of falling back to the hint here).
    return candidates.includes(chosen) ? chosen : null;
  } catch {
    return null; // elicitation unsupported by this client — fall back to the hint
  }
}

// Explicit return type is required, not stylistic: this function calls
// itself recursively (the monorepo-elicitation branch below), and TS can't
// infer a recursive function's return type from its own body.
export async function ingestRepoHandler(
  args: z.infer<typeof ingestRepoInputSchema>,
  ctx?: ServerContext
): Promise<{ content: [{ type: 'text'; text: string }]; structuredContent: z.infer<typeof ingestRepoOutputSchema> }> {
  enforcePathAllowlist(args.path);
  const bundle = await ingestRepo(args.path);
  atomicWriteFile(evidencePath(args.path), JSON.stringify(bundle, null, 2));
  const cases = buildCases(args.path);

  // 0 routes is the exact, cheap symptom a real monorepo-wrapper root
  // produces (a thin package.json with no routes/build config of its own,
  // the real app one level down under apps/ or packages/) — surface it
  // directly rather than silently returning 0 and leaving someone to
  // debug their way to "point at the nested app instead."
  const monorepoCandidates = bundle.routes.length === 0 ? findCandidateAppDirs(args.path) : [];

  if (args.interactive && monorepoCandidates.length > 0 && ctx) {
    const chosen = await elicitMonorepoChoice(args.path, monorepoCandidates, ctx);
    if (chosen) {
      const result = await ingestRepoHandler({ path: join(args.path, chosen) }, ctx);
      const resolvedSummary = { ...result.structuredContent, resolvedMonorepoChoice: chosen };
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(resolvedSummary, null, 2) }],
        structuredContent: resolvedSummary
      };
    }
  }

  const summary = {
    routes: bundle.routes.length,
    existingTests: bundle.existingTests.length,
    signals: bundle.signals.length,
    buildConfig: bundle.buildConfig.map((c) => c.tool),
    openCases: cases.filter((c) => c.status === 'open').length,
    savedTo: evidencePath(args.path),
    ...(monorepoCandidates.length > 0
      ? {
          monorepoHint: {
            message:
              '0 routes were found at this exact path. This looks like a monorepo root, not the app itself — try re-running ingest_repo pointed at one of the candidates below instead.',
            candidates: monorepoCandidates
          }
        }
      : {})
  };

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(summary, null, 2) }],
    structuredContent: summary
  };
}
