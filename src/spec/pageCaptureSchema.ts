import * as z from 'zod/v4';

// Transient, in-memory-only shape produced by a single `generate_spec` call's
// on-demand browser capture (see generatePageTests.ts) — unlike
// evidenceSchema.ts's EvidenceBundle (persisted, static ingest-time state) or
// crawlEvidenceSchema.ts's CrawlEvidence (persisted `crawl_site` output), a
// PageCapture is never written to `.dossier/`. Capture happens fresh inside
// every generate_spec call, so there is nothing to keep in sync with a
// previous run.

export const dynamicShapeSchema = z.enum(['currency', 'iso-date', 'relative-time', 'uuid', 'number']);
export type DynamicShape = z.infer<typeof dynamicShapeSchema>;

export const domTextNodeSchema = z.object({
  selectorHint: z.string(),
  text: z.string(),
  kind: z.enum(['static', 'dynamic']),
  dynamicShape: dynamicShapeSchema.optional()
});
export type DomTextNode = z.infer<typeof domTextNodeSchema>;

// Per-usage, not a flat name/selector list: the same keyframe can legitimately
// be used by more than one selector (e.g. both a hero section and a card use
// the same entrance keyframe), and each usage can have its own trigger
// condition — 'unconditional' or a state pseudo-class like ':hover'. Real,
// live-triggered finding this schema shape exists to capture: a blind rebuild
// reproduced a keyframe NAME correctly but wired it to `:hover` instead of
// the original's unconditional application: without recording trigger
// condition per usage, a rebuild agent has no way to tell those two cases
// apart from the contract doc alone.
export const keyframeUsageSchema = z.object({
  selector: z.string(),
  keyframeName: z.string(),
  trigger: z.string()
});
export type KeyframeUsage = z.infer<typeof keyframeUsageSchema>;

export const transitionUsageSchema = z.object({
  selector: z.string(),
  trigger: z.string()
});
export type TransitionUsage = z.infer<typeof transitionUsageSchema>;

// Absent when nothing was detected — never an empty-arrays object — mirrors
// screenshotAssetId's own optionality just below.
export const stylesheetAnimationSummarySchema = z.object({
  keyframeUsages: z.array(keyframeUsageSchema),
  transitionUsages: z.array(transitionUsageSchema)
});
export type StylesheetAnimationSummary = z.infer<typeof stylesheetAnimationSummarySchema>;

export const pageCaptureSchema = z.object({
  routeFile: z.string(),
  path: z.string(),
  capturedAt: z.string(),
  consoleErrors: z.array(z.string()),
  domOutline: z.array(domTextNodeSchema),
  screenshotAssetId: z.string().optional(),
  stylesheetAnimations: stylesheetAnimationSummarySchema.optional()
});
export type PageCapture = z.infer<typeof pageCaptureSchema>;
