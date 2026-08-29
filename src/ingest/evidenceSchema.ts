import * as z from 'zod/v4';
import { signalSchema } from '../reconciliation/types.js';

export const buildConfigKindSchema = z.enum(['vite', 'tailwind', 'next', 'unknown']);
export type BuildConfigKind = z.infer<typeof buildConfigKindSchema>;

export const buildConfigEntrySchema = z.object({
  tool: buildConfigKindSchema,
  configFile: z.string(),
  fields: z.record(z.string(), z.unknown()),
  unresolved: z.array(z.string())
});
export type BuildConfigEntry = z.infer<typeof buildConfigEntrySchema>;

export const routeKindSchema = z.enum(['page', 'api', 'component']);
export type RouteKind = z.infer<typeof routeKindSchema>;

export const routeEntrySchema = z.object({
  path: z.string(),
  method: z.string().optional(),
  file: z.string(),
  kind: routeKindSchema,
  startLine: z.number().int().optional()
});
export type RouteEntry = z.infer<typeof routeEntrySchema>;

export const existingTestEntrySchema = z.object({
  file: z.string(),
  framework: z.string(),
  testNames: z.array(z.string())
});
export type ExistingTestEntry = z.infer<typeof existingTestEntrySchema>;

export const packageJsonSummarySchema = z.object({
  name: z.string().optional(),
  // The original app's own module system — undefined when the field is
  // absent or not one of these two literal values (Node's own accepted
  // values), never guessed at. Used to mirror the original's real module
  // system into the generated rebuild's package.json instead of forcing
  // one unconditionally.
  type: z.enum(['module', 'commonjs']).optional(),
  scripts: z.record(z.string(), z.string()),
  dependencies: z.record(z.string(), z.string()),
  devDependencies: z.record(z.string(), z.string())
});
export type PackageJsonSummary = z.infer<typeof packageJsonSummarySchema>;

export const evidenceBundleSchema = z.object({
  repoPath: z.string(),
  generatedAt: z.string(),
  packageJson: packageJsonSummarySchema,
  buildConfig: z.array(buildConfigEntrySchema),
  routes: z.array(routeEntrySchema),
  existingTests: z.array(existingTestEntrySchema),
  signals: z.array(signalSchema)
});
export type EvidenceBundle = z.infer<typeof evidenceBundleSchema>;
