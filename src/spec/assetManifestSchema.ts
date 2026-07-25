import * as z from 'zod/v4';

// Shared, persisted manifest for any binary asset a generated rebuild spec
// references — written to <repo>-rebuild/spec/assets-manifest.json.
// Deliberately shaped to serve two producers under one schema/convention
// rather than inventing a second, incompatible one later:
//   - 'screenshot': captured today by generatePageTests.ts's on-demand
//     Playwright capture.
//   - 'source-asset': reserved/unused today — reserved for the still-
//     backlogged "asset-manifest extraction" feature (binary source-repo
//     files copied verbatim + hash, locked contract tier; see
//     docs/v0-findings.md) so it can append entries to this same array later
//     without a migration.
export const assetManifestEntryKindSchema = z.enum(['screenshot', 'source-asset']);
export type AssetManifestEntryKind = z.infer<typeof assetManifestEntryKindSchema>;

export const assetManifestEntrySchema = z.object({
  id: z.string(),
  path: z.string(), // relative to the rebuild output dir, e.g. spec/assets/screenshots/PAGE-root.png
  hash: z.string(), // sha256, hex-encoded
  kind: assetManifestEntryKindSchema,
  metadata: z.record(z.string(), z.unknown())
});
export type AssetManifestEntry = z.infer<typeof assetManifestEntrySchema>;
