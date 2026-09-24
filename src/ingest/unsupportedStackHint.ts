import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { EvidenceBundle } from './evidenceSchema.js';

// The one thing "0 routes" can actually diagnose: a stack this tool doesn't
// parse at all, as opposed to a real Next.js/Express app with a genuinely
// empty route table (rare, but not this function's business to rule out —
// it only speaks up when it has real evidence of an unsupported stack,
// never merely from a route count of zero).
//
// Found live: pointing this at a Python project fell through the 0-routes
// path with no diagnosis, and `generate_spec` went on to produce a
// valid-looking but silently empty package — its only complaint was
// `missingNodeModules`, whose fix ("run npm install") is actively
// misleading for a stack `npm install` can't help.
const PYTHON_PROJECT_MARKERS = ['requirements.txt', 'pyproject.toml', 'setup.py', 'Pipfile', 'manage.py'];
const SUPPORTED_FRAMEWORKS = ['next', 'express'] as const;

export function unsupportedStackHint(repoPath: string, evidence: EvidenceBundle): string | undefined {
  if (!existsSync(join(repoPath, 'package.json'))) {
    const pythonMarkers = PYTHON_PROJECT_MARKERS.filter((f) => existsSync(join(repoPath, f)));
    if (pythonMarkers.length > 0) {
      return (
        `This looks like a Python project (found ${pythonMarkers.join(', ')}), not a JavaScript/TypeScript one. ` +
        'This tool only supports Next.js (App Router) and Express, in JavaScript or TypeScript — it does not read Python.'
      );
    }
    return (
      'No package.json found — this tool only supports Next.js (App Router) and Express, in JavaScript or TypeScript. ' +
      "Point it at the actual app directory if this isn't it."
    );
  }

  const deps = { ...evidence.packageJson.dependencies, ...evidence.packageJson.devDependencies };
  if (!SUPPORTED_FRAMEWORKS.some((fw) => Object.hasOwn(deps, fw))) {
    return (
      'Found package.json, but neither `next` nor `express` is a dependency — this tool only supports ' +
      'Next.js (App Router) and Express today.'
    );
  }

  return undefined;
}
