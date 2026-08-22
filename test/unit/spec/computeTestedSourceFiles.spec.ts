import { describe, expect, it } from 'vitest';
import { computeTestedSourceFiles } from '../../../src/spec/computeTestedSourceFiles.js';
import type { GeneratedTestFile } from '../../../src/spec/generateTests.js';

function file(overrides: Partial<GeneratedTestFile>): GeneratedTestFile {
  return { filename: 'test.spec.ts', content: '', sourceFile: 'route.ts', ...overrides };
}

describe('computeTestedSourceFiles', () => {
  it('excludes a route whose only covering test landed in the weak set', () => {
    const tests = [file({ filename: 'weak-test.spec.ts', sourceFile: 'src/app/api/health/route.ts' })];
    expect(computeTestedSourceFiles(tests, new Set(['weak-test.spec.ts']))).toEqual([]);
  });

  it('includes a route covered by a test that is not in the weak set', () => {
    const tests = [file({ filename: 'good-test.spec.ts', sourceFile: 'src/app/api/health/route.ts' })];
    expect(computeTestedSourceFiles(tests, new Set())).toEqual(['src/app/api/health/route.ts']);
  });

  it('maps a non-weak test to every route in its coveredRouteFiles, not just sourceFile', () => {
    const tests = [
      file({
        filename: 'gate-test.spec.ts',
        sourceFile: 'app-shell.tsx',
        coveredRouteFiles: ['page.tsx', 'home/page.tsx']
      })
    ];
    expect(computeTestedSourceFiles(tests, new Set())).toEqual(['page.tsx', 'home/page.tsx']);
  });

  it('drops all of a weak test\'s coveredRouteFiles, not just its sourceFile', () => {
    const tests = [
      file({
        filename: 'gate-test.spec.ts',
        sourceFile: 'app-shell.tsx',
        coveredRouteFiles: ['page.tsx', 'home/page.tsx']
      })
    ];
    expect(computeTestedSourceFiles(tests, new Set(['gate-test.spec.ts']))).toEqual([]);
  });
});
