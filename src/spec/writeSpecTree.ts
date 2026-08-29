import { existsSync, mkdirSync, writeFileSync, renameSync, rmSync, copyFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, dirname, basename } from 'node:path';
import type { EvidenceBundle } from '../ingest/evidenceSchema.js';
import type { Case } from '../reconciliation/types.js';
import { generateClaudeMd } from './generateClaudeMd.js';
import { generateTestingRule } from './generateRules.js';
import { generateSettingsJson } from './generateSettingsJson.js';
import { generateContracts } from './generateContracts.js';
import { generateTests } from './generateTests.js';
import { generateNextApiTests } from './generateNextApiTests.js';
import { generateGateTests, generateSecretEntryTests } from './generateGateTests.js';
import { generatePageTests, AUTH_STORAGE_STATE_FIXTURE_RELATIVE_PATH, type SkippedPage } from './generatePageTests.js';
import { computeUntestedContractFiles } from './computeUntestedContractFiles.js';
import { computeTestedSourceFiles } from './computeTestedSourceFiles.js';
import { generateTestDependencies, type TestPlacement } from './generateTestDependencies.js';
import { pinDependencyVersions } from './pinDependencyVersions.js';
import { generateSpecAuditorAgent, generateTestVerifierAgent } from './generateAgents.js';
import { generateParallelTestFixWorkflow } from './generateWorkflow.js';
import { generateVerifyAgainstSpecSkill } from './generateSkill.js';
import { clusterTestsByFile } from './clusterTests.js';
import { KICKOFF_PROMPT } from './generateKickoffPrompt.js';
import { runMutationCheck, type MutationCheckReport } from '../mutation/runMutationCheck.js';

export interface WriteSpecTreeInput {
  repoPath: string;
  outputDir: string;
  evidence: EvidenceBundle;
  cases: Case[];
  authStorageStatePath?: string; // pre-authenticated Playwright storageState — see generatePageTests.ts
}

export interface WriteSpecTreeResult {
  mutationReport: MutationCheckReport;
  capturedPages: string[]; // page route files whose Playwright capture succeeded
  skippedPages: SkippedPage[]; // page route files visibly skipped, with why — see generatePageTests.ts
  visionClassificationEnabled: boolean; // whether vision-assisted classification was attempted this run — see generatePageTests.ts
  pageVisionFallbacks: SkippedPage[]; // captured pages that fell back to the regex classifier despite vision being enabled, with why
}

// The generated tests are always vitest, regardless of what test runner the
// original repo used (we don't reuse the original's runner — we generate our
// own). So the rebuild's own package.json.scripts.test is always a concrete,
// directly-runnable command; "npm test" (used in prose and the PostToolUse
// hook) is always safe to say separately because it delegates to that script
// rather than being stored as its value — storing "npm test" as scripts.test
// itself would make `npm test` recurse into itself.
//
// Scoped to tests/visible/ specifically, not a bare `vitest run` — a real
// fresh-agent handoff found that the bare form picks up tests/held-out/ and
// tests/weak/ too (they all live under the same tests/ tree vitest scans by
// default), which mechanically undermines "do not touch tests/held-out/
// until every visible test passes, run it once at the end": the PostToolUse
// hook would show held-out failures on every single edit instead of only
// signaling on the suite it's actually supposed to gate. --passWithNoTests
// keeps this from failing outright for an app whose test generators matched
// nothing (an empty tests/visible/ is a real, valid state, not an error).
const REBUILD_TEST_SCRIPT = 'vitest run tests/visible --passWithNoTests';
const RUN_TESTS_COMMAND = 'npm test';

function buildStackLines(evidence: EvidenceBundle): string[] {
  const deps = { ...evidence.packageJson.dependencies, ...evidence.packageJson.devDependencies };
  const framework = Object.hasOwn(deps, 'next')
    ? 'Next.js'
    : Object.hasOwn(deps, 'express')
      ? 'Express'
      : Object.hasOwn(deps, 'react')
        ? 'React'
        : 'unknown';
  return [`lang: TypeScript / ${framework}`];
}

// TypeScript's own toolchain (the `typescript` package itself, plus any
// `@types/*` type-declaration packages) — never assumed present, only
// carried over when the ORIGINAL app's own package.json actually declares
// it. A real regression: the generated package.json previously never
// included these at all for a TypeScript project, so a fresh rebuild
// agent's own `npm install` was free to resolve whatever `typescript`
// major npm's registry currently serves — which silently broke `next dev`
// under Next.js 14.2.5 when that happened to be a major newer than Next
// itself supports (confirmed live: pinning `typescript` back down alone
// fixed the boot, with no other change). Pinned via the same
// pinDependencyVersions mechanism as `dependencies`, for the same reason:
// a bare semver range doesn't guarantee landing on the version the
// original app actually ran with.
const TYPESCRIPT_TOOLING_PATTERN = /^(typescript|@types\/.+)$/;

function typescriptToolingDependencies(devDependencies: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, range] of Object.entries(devDependencies)) {
    if (TYPESCRIPT_TOOLING_PATTERN.test(name)) result[name] = range;
  }
  return result;
}

function sanitizeTopicKeyFilename(topicKey: string): string {
  return (
    topicKey
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
      .join('-') + '.md'
  );
}

function decisionMarkdown(kase: Case): string {
  const decision = kase.autoResolution?.decision ?? kase.humanDecision?.decision ?? 'unresolved';
  const reason = kase.autoResolution?.reason ?? kase.humanDecision?.note;
  const signalLines = kase.signals.map((s) => `- (${s.source}) ${s.claim}`).join('\n');
  return `# Decision: ${kase.topicKey}

- **Status:** ${kase.status}
- **Decision:** ${decision}
${reason ? `- **Reason:** ${reason}\n` : ''}
## Evidence

${signalLines || '(no signals recorded)'}
`;
}

// The one and only place this tool writes outside its own scratch state —
// always a clean sibling directory, never the original repo, and refuses to
// clobber an existing output so a prior rebuild attempt is never silently lost.
export async function writeSpecTree(input: WriteSpecTreeInput): Promise<WriteSpecTreeResult> {
  const { repoPath, outputDir, evidence, cases, authStorageStatePath } = input;

  if (existsSync(outputDir)) {
    throw new Error(`Refusing to overwrite existing directory: ${outputDir}`);
  }

  // Real, live-triggered finding: generate_spec is a genuinely slow call for
  // a real app (a full mutation check can run several minutes) — long enough
  // that an MCP client can time out waiting for the response while the
  // server keeps writing directly into outputDir regardless. A client that
  // gave up has no way to distinguish "still running/died partway" from "a
  // real, complete, legitimately test-less result" — both looked like a
  // directory with CLAUDE.md/contracts but no tests/test-dependencies.json
  // yet. A fresh agent facing that ambiguity took the empty tests/ directory
  // at face value and wrote its own self-authored, self-graded test —
  // exactly the failure mode this tool exists to prevent. Fixed the same way
  // atomicWriteFile.ts already does for single files: build the entire tree
  // in a hidden sibling directory first, and only rename it into the real
  // outputDir path once every write below (including the slow mutation
  // check) has fully succeeded. outputDir now either doesn't exist at all
  // (still running, or died) or exists complete — never partial.
  const buildDir = join(dirname(outputDir), `.tmp-${basename(outputDir)}-${randomUUID()}`);

  let result: WriteSpecTreeResult;
  try {
    result = await writeSpecTreeInto(buildDir, { repoPath, evidence, cases, authStorageStatePath });
  } catch (err) {
    rmSync(buildDir, { recursive: true, force: true });
    throw err;
  }

  renameSync(buildDir, outputDir);
  return result;
}

async function writeSpecTreeInto(
  outputDir: string,
  input: Pick<WriteSpecTreeInput, 'repoPath' | 'evidence' | 'cases' | 'authStorageStatePath'>
): Promise<WriteSpecTreeResult> {
  const { repoPath, evidence, cases, authStorageStatePath } = input;

  mkdirSync(join(outputDir, '.claude', 'rules'), { recursive: true });
  mkdirSync(join(outputDir, '.claude', 'agents'), { recursive: true });
  mkdirSync(join(outputDir, '.claude', 'workflows'), { recursive: true });
  mkdirSync(join(outputDir, '.claude', 'skills'), { recursive: true });
  mkdirSync(join(outputDir, 'spec', 'contracts'), { recursive: true });
  mkdirSync(join(outputDir, 'tests', 'visible'), { recursive: true });
  mkdirSync(join(outputDir, 'tests', 'held-out'), { recursive: true });

  writeFileSync(
    join(outputDir, 'CLAUDE.md'),
    generateClaudeMd({
      projectName: evidence.packageJson.name ?? 'rebuild',
      stackLines: buildStackLines(evidence),
      testCommand: RUN_TESTS_COMMAND
    })
  );

  const testingRule = generateTestingRule(RUN_TESTS_COMMAND);
  writeFileSync(join(outputDir, '.claude', 'rules', testingRule.filename), testingRule.content);

  writeFileSync(join(outputDir, '.claude', 'settings.json'), JSON.stringify(generateSettingsJson(RUN_TESTS_COMMAND), null, 2));

  const specAuditorFile = generateSpecAuditorAgent(evidence.routes);
  if (specAuditorFile) {
    writeFileSync(join(outputDir, '.claude', 'agents', specAuditorFile.filename), specAuditorFile.content);
  }

  const skillFile = generateVerifyAgainstSpecSkill(evidence.routes);
  if (skillFile) {
    const skillPath = join(outputDir, '.claude', 'skills', skillFile.filename);
    mkdirSync(dirname(skillPath), { recursive: true });
    writeFileSync(skillPath, skillFile.content);
  }

  // Must run before generateContracts below — contracts for `kind: 'page'`
  // routes now embed a reference-screenshot section (or an explicit
  // capture-failed note) sourced from this result. This is also the one
  // real async I/O phase in this otherwise-synchronous pipeline (spins up
  // its own `next dev` + Chromium once — see generatePageTests.ts).
  const pageResult = await generatePageTests(repoPath, evidence, cases, authStorageStatePath);

  for (const file of generateContracts(
    repoPath,
    evidence.routes,
    pageResult.assetManifest,
    pageResult.skippedPages,
    pageResult.pageStylesheetAnimations,
    pageResult.usedAuthStorageState
  )) {
    writeFileSync(join(outputDir, 'spec', 'contracts', file.filename), file.content);
  }

  // Copies the user-supplied storageState alongside the generated tests so
  // they can reach the same authenticated pages when run standalone later —
  // see buildPageTestContent's own reference to AUTH_STORAGE_STATE_FIXTURE_RELATIVE_PATH.
  // Gated on capturedPages.length, not just authStorageStatePath being set —
  // no point copying a real session-cookie file into the output tree for an
  // app with no page routes to use it on. The file contains live session
  // state for the target app, so it's gitignored immediately, not left to a
  // later, easy-to-forget step.
  if (authStorageStatePath && pageResult.capturedPages.length > 0) {
    const fixturesDir = join(outputDir, 'tests', 'fixtures');
    mkdirSync(fixturesDir, { recursive: true });
    copyFileSync(authStorageStatePath, join(outputDir, 'tests', AUTH_STORAGE_STATE_FIXTURE_RELATIVE_PATH));
    writeFileSync(
      join(outputDir, '.gitignore'),
      `# Contains live session cookies/localStorage for the target app — never commit.\ntests/${AUTH_STORAGE_STATE_FIXTURE_RELATIVE_PATH}\n`
    );
  }

  for (const kase of cases.filter((c) => c.status !== 'open')) {
    writeFileSync(join(outputDir, 'spec', sanitizeTopicKeyFilename(kase.topicKey)), decisionMarkdown(kase));
  }

  writeFileSync(join(outputDir, 'kickoff-prompt.txt'), KICKOFF_PROMPT);

  if (pageResult.screenshots.length > 0) {
    mkdirSync(join(outputDir, 'spec', 'assets', 'screenshots'), { recursive: true });
    for (const screenshot of pageResult.screenshots) {
      writeFileSync(join(outputDir, screenshot.path), screenshot.buffer);
    }
    writeFileSync(join(outputDir, 'spec', 'assets-manifest.json'), JSON.stringify(pageResult.assetManifest, null, 2));
  }

  const { visible: expressVisible, heldOut: expressHeldOut } = generateTests(repoPath, evidence, cases);
  const { visible: nextApiVisible, heldOut: nextApiHeldOut } = generateNextApiTests(repoPath, evidence, cases);
  const gateTests = [...generateGateTests(repoPath, evidence, cases), ...generateSecretEntryTests(repoPath, evidence, cases)];
  const visible = [...expressVisible, ...nextApiVisible, ...gateTests, ...pageResult.visible];
  const heldOut = [...expressHeldOut, ...nextApiHeldOut, ...pageResult.heldOut];

  const pinnedDependencies = pinDependencyVersions(repoPath, evidence.packageJson.dependencies);
  const pinnedTypescriptTooling = pinDependencyVersions(
    repoPath,
    typescriptToolingDependencies(evidence.packageJson.devDependencies)
  );

  // Page tests spawn their own `next dev` + Chromium exactly like gate tests
  // do (both reuse the shared devServerBoilerplate() — see
  // nextDevServerBoilerplate.ts), so they need the same playwright
  // devDependency and the same sequential-file-execution treatment below.
  const usesDevServerBoilerplate = gateTests.length > 0 || pageResult.visible.length > 0 || pageResult.heldOut.length > 0;

  writeFileSync(
    join(outputDir, 'package.json'),
    JSON.stringify(
      {
        name: `${evidence.packageJson.name ?? 'app'}-rebuild`,
        private: true,
        // Mirrors the original app's own module system rather than forcing
        // one unconditionally — a real regression: this used to always be
        // `'module'`, regardless of what the original actually declared
        // (or didn't). Omitted entirely (Node's own CommonJS default) unless
        // the original explicitly declared `"type": "module"` itself.
        ...(evidence.packageJson.type === 'module' ? { type: 'module' as const } : {}),
        scripts: { test: REBUILD_TEST_SCRIPT },
        ...(Object.keys(pinnedDependencies).length > 0 ? { dependencies: pinnedDependencies } : {}),
        devDependencies: {
          ...(usesDevServerBoilerplate ? { vitest: '^4.0.0', playwright: '^1.61.1' } : { vitest: '^4.0.0' }),
          ...pinnedTypescriptTooling
        }
      },
      null,
      2
    )
  );

  if (usesDevServerBoilerplate) {
    // Each such test file spawns its own `next dev` against the SAME app
    // directory. Next.js only allows one dev server per project directory
    // at a time regardless of port, so running test files concurrently
    // (vitest's default) makes them fight over that lock. Sequential file
    // execution avoids it — and matches the tool's own one-test-at-a-time
    // philosophy rather than losing anything real.
    writeFileSync(
      join(outputDir, 'vitest.config.ts'),
      `import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    fileParallelism: false
  }
});
`
    );
  }

  const mutationReport = runMutationCheck(repoPath, [...visible, ...heldOut], authStorageStatePath);
  // An unrunnable test (never passed even unmutated) gets the same "don't
  // trust this as visible/held-out" treatment as a weak one — both mean a
  // rebuild agent shouldn't rely on it, even though the underlying reason
  // (never runs at all vs. runs but proves nothing) is worth reporting
  // separately, see generateSpec.ts's tool summary.
  const weak = new Set([...mutationReport.weakTestFiles, ...mutationReport.unrunnableTestFiles]);

  // Makes "only build what's currently failing" mechanically enforced (via
  // the PreToolUse hook in settings.json) instead of just a sentence in the
  // kickoff prompt a model can weigh less heavily than intended.
  //
  // Computed here, after runMutationCheck above, specifically so a weak or
  // unrunnable test does NOT count as real coverage — a route whose only
  // test catches zero mutations is functionally untested and belongs in the
  // blocklist. An earlier version of this computation ran before
  // runMutationCheck and let any generated test unblock its file regardless
  // of mutation-check outcome; that let the blocklist come back empty on
  // apps where most tests land in weak/unrunnable (confirmed on catchandtrade
  // multiple times), defeating the hook's actual purpose. Changed for that
  // reason — the prior rationale for the old behavior isn't reconstructable
  // from anything left in this repo.
  const testedSourceFiles = computeTestedSourceFiles([...visible, ...heldOut], weak);
  const untestedContractFiles = computeUntestedContractFiles(evidence.routes, testedSourceFiles);
  writeFileSync(join(outputDir, 'spec', 'untested-contracts.json'), JSON.stringify(untestedContractFiles, null, 2));

  if (weak.size > 0) {
    mkdirSync(join(outputDir, 'tests', 'weak'), { recursive: true });
  }
  const placements: TestPlacement[] = [
    ...visible.map((file): TestPlacement => ({ file, dir: weak.has(file.filename) ? 'weak' : 'visible' })),
    ...heldOut.map((file): TestPlacement => ({ file, dir: weak.has(file.filename) ? 'weak' : 'held-out' }))
  ];
  for (const { file, dir } of placements) {
    writeFileSync(join(outputDir, 'tests', dir, file.filename), file.content);
  }

  writeFileSync(
    join(outputDir, 'spec', 'test-dependencies.json'),
    JSON.stringify(generateTestDependencies(placements), null, 2)
  );

  const heldOutFilenames = placements.filter((p) => p.dir === 'held-out').map((p) => p.file.filename);
  const testVerifierFile = generateTestVerifierAgent(heldOutFilenames);
  if (testVerifierFile) {
    writeFileSync(join(outputDir, '.claude', 'agents', testVerifierFile.filename), testVerifierFile.content);
  }

  // Scoped to tests/visible/ specifically — those are the ones a rebuild
  // agent is actively red-green-refactoring against; weak/held-out tests
  // don't belong in this workflow's clustering at all.
  const visiblePlacementFiles = placements.filter((p) => p.dir === 'visible').map((p) => p.file);
  const clusters = clusterTestsByFile(visiblePlacementFiles);
  const workflowFile = generateParallelTestFixWorkflow(clusters);
  if (workflowFile) {
    writeFileSync(join(outputDir, '.claude', 'workflows', workflowFile.filename), workflowFile.content);
  }

  return {
    mutationReport,
    capturedPages: pageResult.capturedPages,
    skippedPages: pageResult.skippedPages,
    visionClassificationEnabled: pageResult.visionClassificationEnabled,
    pageVisionFallbacks: pageResult.pageVisionFallbacks
  };
}
