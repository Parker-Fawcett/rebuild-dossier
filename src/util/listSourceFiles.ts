import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ignore from 'ignore';
import { toPosixRelative } from './paths.js';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
// Kept as a fast, always-on baseline even where a repo's own .gitignore
// doesn't mention these (or has no .gitignore at all) — real .gitignore
// awareness (below) is additive, not a replacement.
// .next is build output (webpack-bundled vendor code, not app source) left behind by any
// prior `next dev`/`next build` run — including this tool's own page-capture step. Without
// this, ingest_repo's signal count depends on whether a build has ever happened to run,
// not on the app's own source (docs/v0-findings.md, "ingest_repo scans build output as source").
const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.dossier', 'coverage']);

// Real, observed gap: the exact-match-only ignore list let a directory that
// wasn't literally named "node_modules" (a rename, a stray backup dir, a
// build-output folder a repo's own .gitignore already excludes by pattern)
// get scanned as if it were real source — surfacing dead scaffolding and
// third-party package comments as if they were live decisions. Only reads
// the repo-root .gitignore (not nested per-directory ones) — the
// overwhelming majority of real repos only have one, and this is the
// smallest change that closes the actual observed gap.
function loadGitignore(repoPath: string) {
  const ig = ignore();
  const gitignorePath = join(repoPath, '.gitignore');
  if (existsSync(gitignorePath)) {
    ig.add(readFileSync(gitignorePath, 'utf-8'));
  }
  return ig;
}

export function listSourceFiles(repoPath: string): string[] {
  const files: string[] = [];
  const ig = loadGitignore(repoPath);

  function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      if (IGNORED_DIRS.has(entry)) continue;
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      const relPath = toPosixRelative(repoPath, fullPath);
      if (ig.ignores(stat.isDirectory() ? `${relPath}/` : relPath)) continue;

      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (SOURCE_EXTENSIONS.has(entry.slice(entry.lastIndexOf('.')))) {
        files.push(fullPath);
      }
    }
  }

  walk(repoPath);
  return files;
}
