import * as z from 'zod/v4';
import type { ServerContext } from '@modelcontextprotocol/server';
import { loadCases } from '../state/caseStore.js';
import { resolveCaseInternal } from '../reconciliation/resolveCase.js';
import type { Case } from '../reconciliation/types.js';
import { enforcePathAllowlist } from '../security/pathAllowlist.js';


export const getCaseQueueInputSchema = z.object({
  repoPath: z.string().describe('Repo path whose .dossier/ case queue to read'),
  interactive: z
    .boolean()
    .optional()
    .describe('When true, walk open cases via MCP elicitation instead of just listing them')
});

export const getCaseQueueConfig = {
  title: 'Get case queue',
  description: 'Return unresolved ambiguity cases from reconciliation.',
  inputSchema: getCaseQueueInputSchema,
  annotations: {
    title: 'Get case queue',
    // With interactive:false this is a pure read. But interactive:true walks
    // open cases via elicitation and calls resolveCaseInternal on each one —
    // the same overwrite-a-decision write resolve_case performs — so the
    // hints below describe the tool's worst case across its own valid inputs,
    // not just the default. Not idempotent: which cases get resolved, and how,
    // depends on what a human answers to each elicitation prompt, not just the
    // arguments. Elicitation is a request back through the same MCP client,
    // not an external system, so openWorldHint stays false.
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false
  }
};

const ELICITATION_SCHEMA = {
  type: 'object' as const,
  properties: {
    decision: { type: 'string' as const, title: 'Your decision (e.g. "intentional" or "bug")' },
    note: { type: 'string' as const, title: 'Optional note explaining the decision' }
  },
  required: ['decision']
};

async function walkCaseViaElicitation(repoPath: string, kase: Case, ctx: ServerContext): Promise<'resolved' | 'skipped' | 'stop'> {
  const conflictNote = kase.conflict ? `\nConflict: ${kase.conflict.detail}` : '';
  const relatedNote =
    kase.relatedCaseIds && kase.relatedCaseIds.length > 0
      ? `\nNote: this case's source file is a near-duplicate of ${kase.relatedCaseIds.join(', ')} — your decision here may need to apply there too, not be decided independently.`
      : '';
  const response = await ctx.mcpReq.elicitInput({
    mode: 'form',
    message: `Case ${kase.id} (${kase.topicKey}) is unresolved.${conflictNote}${relatedNote}\nWhat's the correct behavior?`,
    requestedSchema: ELICITATION_SCHEMA
  });

  if (response.action === 'cancel') {
    return 'stop';
  }
  if (response.action === 'decline') {
    return 'skipped';
  }

  const decision = String(response.content?.decision ?? '');
  const note = response.content?.note !== undefined ? String(response.content.note) : undefined;
  resolveCaseInternal(repoPath, kase.id, decision, note, 'elicitation');
  return 'resolved';
}

export async function getCaseQueueHandler(args: z.infer<typeof getCaseQueueInputSchema>, ctx: ServerContext) {
  enforcePathAllowlist(args.repoPath);
  let open = loadCases(args.repoPath).filter((c) => c.status === 'open');

  if (args.interactive) {
    for (const kase of open) {
      let outcome: 'resolved' | 'skipped' | 'stop';
      try {
        outcome = await walkCaseViaElicitation(args.repoPath, kase, ctx);
      } catch {
        // Elicitation unsupported by this client (capability not declared, or
        // it throws on this protocol era) — resolve_case remains the always-
        // available fallback path, so just stop walking and report what's left.
        break;
      }
      if (outcome === 'stop') break;
    }
    open = loadCases(args.repoPath).filter((c) => c.status === 'open');
  }

  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ open: open.length, cases: open }, null, 2) }]
  };
}
