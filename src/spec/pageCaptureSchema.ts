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

export const pageCaptureSchema = z.object({
  routeFile: z.string(),
  path: z.string(),
  capturedAt: z.string(),
  consoleErrors: z.array(z.string()),
  domOutline: z.array(domTextNodeSchema),
  screenshotAssetId: z.string().optional()
});
export type PageCapture = z.infer<typeof pageCaptureSchema>;
