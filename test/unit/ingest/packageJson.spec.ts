import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readPackageJson } from '../../../src/ingest/packageJson.js';

describe('readPackageJson', () => {
  it('extracts name, scripts, dependencies, and devDependencies', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-pkg-'));
    try {
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({
          name: 'sample-app',
          scripts: { test: 'vitest run', build: 'vite build' },
          dependencies: { express: '^4.19.0' },
          devDependencies: { vitest: '^4.0.0' }
        })
      );

      const summary = readPackageJson(dir);

      expect(summary.name).toBe('sample-app');
      expect(summary.scripts.test).toBe('vitest run');
      expect(summary.dependencies.express).toBe('^4.19.0');
      expect(summary.devDependencies.vitest).toBe('^4.0.0');
      expect(summary.type).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('extracts a declared "type": "module"', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-pkg-'));
    try {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module', scripts: {}, dependencies: {}, devDependencies: {} }));
      expect(readPackageJson(dir).type).toBe('module');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('extracts a declared "type": "commonjs"', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-pkg-'));
    try {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'commonjs', scripts: {}, dependencies: {}, devDependencies: {} }));
      expect(readPackageJson(dir).type).toBe('commonjs');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ignores an invalid "type" value rather than passing it through', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-pkg-'));
    try {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'esnext', scripts: {}, dependencies: {}, devDependencies: {} }));
      expect(readPackageJson(dir).type).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns an empty summary when package.json is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-pkg-'));
    try {
      const summary = readPackageJson(dir);
      expect(summary).toEqual({ scripts: {}, dependencies: {}, devDependencies: {} });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('tolerates malformed JSON without throwing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-pkg-'));
    try {
      writeFileSync(join(dir, 'package.json'), '{ not valid json');
      const summary = readPackageJson(dir);
      expect(summary).toEqual({ scripts: {}, dependencies: {}, devDependencies: {} });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
