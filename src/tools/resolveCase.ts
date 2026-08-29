import * as z from 'zod/v4';
import { resolveCaseInternal } from '../reconciliation/resolveCase.js';
import { enforcePathAllowlist } from '../security/pathAllowlist.js';
import { caseSchema } from '../reconciliation/types.js';

export const resolveCaseInputSchema = z.object({
  repoPath: z.string().describe('Repo path whose .dossier/ this case belongs to'),
  id: z.string().describe('The case id to resolve, as returned by get_case_queue (e.g. "case:...")'),
  decision: z.string().describe('Free-text decision, e.g. "intentional" or "bug" — stored verbatim, not a fixed enum'),
  note: z.string().optional().describe('Optional free-text note explaining the decision')
});

export const resolveCaseConfig = {
  title: 'Resolve case',
  description: 'Resolve one open case with a human decision. Always available, no elicitation capability required.',
  inputSchema: resolveCaseInputSchema,
  outputSchema: caseSchema,
  annotations: {
    title: 'Resolve case',
    // Overwrites a case's decision regardless of its current status (see
    // README) — a genuine destructive update, not a pure append, so
    // destructiveHint is true even though nothing outside the case store is
    // touched. Still idempotent: calling it again with the same id/decision/
    // note converges to the same stored state rather than accumulating
    // additional effects. Local state only.
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false
  }
};

export async function resolveCaseHandler(args: z.infer<typeof resolveCaseInputSchema>) {
  enforcePathAllowlist(args.repoPath);
  const resolved = resolveCaseInternal(args.repoPath, args.id, args.decision, args.note, 'resolve_case_tool');

  if (!resolved) {
    return {
      content: [{ type: 'text' as const, text: `No open case found with id "${args.id}"` }],
      isError: true
    };
  }

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(resolved, null, 2) }],
    structuredContent: resolved
  };
}
