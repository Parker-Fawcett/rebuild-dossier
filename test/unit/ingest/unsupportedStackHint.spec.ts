import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unsupportedStackHint } from '../../../src/ingest/unsupportedStackHint.js';
import type { EvidenceBundle } from '../../../src/ingest/evidenceSchema.js';

const now = new Date(0).toISOString();

function minimalEvidence(overrides: Partial<EvidenceBundle> = {}): EvidenceBundle {
  return {
    repoPath: 'irrelevant',
    generatedAt: now,
    packageJson: { scripts: {}, dependencies: {}, devDependencies: {} },
    buildConfig: [],
    routes: [],
    existingTests: [],
    signals: [],
    ...overrides
  };
}

// Real, live-triggered finding: pointing this at a Python project produced 0
// routes with no diagnosis, and generate_spec went on to silently produce an
// empty-looking package whose only complaint ("run npm install") is actively
// misleading for a stack npm can't help at all.
describe('unsupportedStackHint', () => {
  it('names Python explicitly when Python project markers are present and there is no package.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-stack-'));
    try {
      writeFileSync(join(dir, 'requirements.txt'), 'fastapi\n');
      writeFileSync(join(dir, 'main.py'), 'from fastapi import FastAPI\napp = FastAPI()\n');

      const hint = unsupportedStackHint(dir, minimalEvidence());

      expect(hint).toContain('Python');
      expect(hint).toContain('requirements.txt');
      expect(hint).toContain('Next.js');
      expect(hint).toContain('Express');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('lists every Python marker found, not just the first', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-stack-'));
    try {
      writeFileSync(join(dir, 'pyproject.toml'), '[project]\nname = "x"\n');
      writeFileSync(join(dir, 'manage.py'), '');

      const hint = unsupportedStackHint(dir, minimalEvidence());

      expect(hint).toContain('pyproject.toml');
      expect(hint).toContain('manage.py');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('gives a generic no-package.json message when no Python markers exist either', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-stack-'));
    try {
      writeFileSync(join(dir, 'README.md'), '# nothing recognizable here\n');

      const hint = unsupportedStackHint(dir, minimalEvidence());

      expect(hint).toContain('No package.json found');
      expect(hint).not.toContain('Python');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('flags a package.json with neither next nor express as a dependency', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-stack-'));
    try {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', dependencies: { react: '^19.0.0' } }));

      const hint = unsupportedStackHint(dir, minimalEvidence({ packageJson: { scripts: {}, dependencies: { react: '^19.0.0' }, devDependencies: {} } }));

      expect(hint).toContain('neither `next` nor `express`');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns undefined when express is a real dependency, even with 0 routes ingested', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-stack-'));
    try {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', dependencies: { express: '^4.19.0' } }));

      const hint = unsupportedStackHint(dir, minimalEvidence({ packageJson: { scripts: {}, dependencies: { express: '^4.19.0' }, devDependencies: {} } }));

      expect(hint).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns undefined when next is only a devDependency (a real, valid shape)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-stack-'));
    try {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', devDependencies: { next: '^16.0.0' } }));

      const hint = unsupportedStackHint(dir, minimalEvidence({ packageJson: { scripts: {}, dependencies: {}, devDependencies: { next: '^16.0.0' } } }));

      expect(hint).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
