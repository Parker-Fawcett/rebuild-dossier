import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listSourceFiles } from '../../../src/util/listSourceFiles.js';

function baseName(p: string): string {
  return p.split(/[\\/]/).pop()!;
}

describe('listSourceFiles', () => {
  it('lists source files, excluding the hardcoded baseline dirs even with no .gitignore present', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-listsrc-'));
    try {
      writeFileSync(join(dir, 'index.ts'), 'export {};');
      mkdirSync(join(dir, 'node_modules', 'some-pkg'), { recursive: true });
      writeFileSync(join(dir, 'node_modules', 'some-pkg', 'index.js'), '// TODO fake');

      const files = listSourceFiles(dir).map(baseName);

      expect(files).toContain('index.ts');
      expect(files).not.toContain('index.js');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('respects a real .gitignore at the repo root — a plain directory name', () => {
    // The exact real bug: a directory that isn't literally named
    // "node_modules" (a rename, a build-output dir, whatever a repo's own
    // .gitignore actually excludes) was scanned anyway, because the walker
    // only ever checked a small hardcoded exact-match list.
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-listsrc-'));
    try {
      writeFileSync(join(dir, '.gitignore'), 'cardvault-fresh/\n');
      writeFileSync(join(dir, 'index.ts'), 'export {};');
      mkdirSync(join(dir, 'cardvault-fresh'), { recursive: true });
      writeFileSync(join(dir, 'cardvault-fresh', 'stale.ts'), '// TODO stale scaffolding');

      const files = listSourceFiles(dir).map(baseName);

      expect(files).toContain('index.ts');
      expect(files).not.toContain('stale.ts');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('respects glob patterns in .gitignore, not just exact directory names', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-listsrc-'));
    try {
      writeFileSync(join(dir, '.gitignore'), '*.generated.ts\nscratch-*/\n');
      writeFileSync(join(dir, 'index.ts'), 'export {};');
      writeFileSync(join(dir, 'routes.generated.ts'), '// generated, should be ignored');
      mkdirSync(join(dir, 'scratch-debug'), { recursive: true });
      writeFileSync(join(dir, 'scratch-debug', 'temp.ts'), '// scratch');

      const files = listSourceFiles(dir).map(baseName);

      expect(files).toContain('index.ts');
      expect(files).not.toContain('routes.generated.ts');
      expect(files).not.toContain('temp.ts');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('respects negation patterns (real git semantics, not just simple exclusion)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-listsrc-'));
    try {
      writeFileSync(join(dir, '.gitignore'), 'generated/*\n!generated/keep-me.ts\n');
      mkdirSync(join(dir, 'generated'), { recursive: true });
      writeFileSync(join(dir, 'generated', 'skip-me.ts'), '// ignored');
      writeFileSync(join(dir, 'generated', 'keep-me.ts'), '// explicitly un-ignored');

      const files = listSourceFiles(dir).map(baseName);

      expect(files).not.toContain('skip-me.ts');
      expect(files).toContain('keep-me.ts');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not scan into a directory git-tracked-but-lookalike-named, when no .gitignore covers it', () => {
    // Confirms the fix doesn't over-reach: a directory that ISN'T actually
    // gitignored (genuinely tracked mess, the OpenCode user's real case)
    // still gets scanned — this is correct behavior on messy real repos,
    // not something to also suppress.
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-listsrc-'));
    try {
      mkdirSync(join(dir, 'cardvault-fresh'), { recursive: true });
      writeFileSync(join(dir, 'cardvault-fresh', 'dupe.ts'), '// TODO duplicate scaffolding, genuinely tracked');

      const files = listSourceFiles(dir).map(baseName);

      expect(files).toContain('dupe.ts');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('excludes .next build output even with no .gitignore covering it', () => {
    // The exact real bug: generate_spec's own page-capture step spawns a real `next dev`
    // and leaves a .next directory behind; ingest_repo then scanned its webpack-bundled
    // vendor code as if it were app source, flagging different signal counts on the
    // identical app depending on nothing but whether a prior pipeline run happened.
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-listsrc-'));
    try {
      writeFileSync(join(dir, 'index.ts'), 'export {};');
      mkdirSync(join(dir, '.next', 'server'), { recursive: true });
      writeFileSync(join(dir, '.next', 'server', 'chunk.js'), '// TODO webpack vendor comment');

      const files = listSourceFiles(dir).map(baseName);

      expect(files).toContain('index.ts');
      expect(files).not.toContain('chunk.js');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('works fine with no .gitignore file at all (most fixtures, many real repos)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-listsrc-'));
    try {
      writeFileSync(join(dir, 'index.ts'), 'export {};');
      expect(listSourceFiles(dir).map(baseName)).toEqual(['index.ts']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
