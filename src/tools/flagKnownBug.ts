import * as z from 'zod/v4';
import { addKnownBug } from '../state/knownBugs.js';
import { buildCases } from '../reconciliation/buildCases.js';
import { enforcePathAllowlist } from '../security/pathAllowlist.js';

export const flagKnownBugInputSchema = z.object({
  repoPath: z.string().describe('Repo path whose .dossier/ this known bug belongs to'),
  description: z.string().describe('Free-text description of a known bug, stored verbatim')
});

export const flagKnownBugConfig = {
  title: 'Flag known bug',
  description:
    'Record a known bug. Always overrides auto-resolve for any case it matches, regardless of other evidence.',
  inputSchema: flagKnownBugInputSchema,
  annotations: {
    title: 'Flag known bug',
    // Appends a new bug entry with a fresh id every call — never overwrites
    // or removes an existing one (purely additive), but also never dedupes,
    // so calling it twice with the same description records it twice; that
    // makes it not idempotent, even though it's not destructive. Local state
    // only, no external system involved.
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false
  }
};

export async function flagKnownBugHandler(args: z.infer<typeof flagKnownBugInputSchema>) {
  enforcePathAllowlist(args.repoPath);
  const bug = addKnownBug(args.repoPath, args.description);
  // Recompute cases immediately so this override takes effect right away,
  // rather than waiting for the next unrelated ingest/crawl call.
  const cases = buildCases(args.repoPath);

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          { bug, openCases: cases.filter((c) => c.status === 'open').length },
          null,
          2
        )
      }
    ]
  };
}
