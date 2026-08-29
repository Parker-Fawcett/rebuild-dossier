import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { PackageJsonSummary } from './evidenceSchema.js';

const EMPTY_SUMMARY: PackageJsonSummary = { scripts: {}, dependencies: {}, devDependencies: {} };

export function readPackageJson(repoPath: string): PackageJsonSummary {
  const filePath = join(repoPath, 'package.json');
  if (!existsSync(filePath)) {
    return { ...EMPTY_SUMMARY };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return { ...EMPTY_SUMMARY };
  }

  if (typeof raw !== 'object' || raw === null) {
    return { ...EMPTY_SUMMARY };
  }

  const pkg = raw as Record<string, unknown>;
  return {
    name: typeof pkg.name === 'string' ? pkg.name : undefined,
    type: pkg.type === 'module' || pkg.type === 'commonjs' ? pkg.type : undefined,
    scripts: isStringRecord(pkg.scripts) ? pkg.scripts : {},
    dependencies: isStringRecord(pkg.dependencies) ? pkg.dependencies : {},
    devDependencies: isStringRecord(pkg.devDependencies) ? pkg.devDependencies : {}
  };
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
