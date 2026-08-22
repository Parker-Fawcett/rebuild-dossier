import type { GeneratedTestFile } from './generateTests.js';

// A test that landed in weak/unrunnable caught nothing (or never ran at
// all) — it provides no real verification, so the route(s) it nominally
// covers should still count as untested for the PreToolUse hook's purposes.
// Excluding weak filenames here, before falling back to coveredRouteFiles or
// sourceFile, is what makes "covered" mean "covered by a test that actually
// proves something" rather than "a test file exists for it" — see
// writeSpecTree.ts's own call site for the incident this fixes.
export function computeTestedSourceFiles(tests: GeneratedTestFile[], weakFilenames: Set<string>): string[] {
  return tests.filter((f) => !weakFilenames.has(f.filename)).flatMap((f) => f.coveredRouteFiles ?? [f.sourceFile]);
}
