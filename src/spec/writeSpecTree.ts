import { existsSync, mkdirSync, writeFileSync, renameSync, rmSync } from 'node:fs';
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
import { generatePageTests, type SkippedPage } from './generatePageTests.js';
import { computeUntestedContractFiles } from './computeUntestedContractFiles.js';
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
}

export interface WriteSpecTreeResult {
  mutationReport: MutationCheckReport;
  capturedPages: string[]; // page route files whose Playwright capture succeeded
  skippedPages: SkippedPage[]; // page route files visibly skipped, with why — see generatePageTests.ts
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
  const { repoPath, outputDir, evidence, cases } = input;

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
    result = await writeSpecTreeInto(buildDir, { repoPath, evidence, cases });
  } catch (err) {
    rmSync(buildDir, { recursive: true, force: true });
    throw err;
  }

  renameSync(buildDir, outputDir);
  return result;
}

async function writeSpecTreeInto(
  outputDir: string,
  input: Pick<WriteSpecTreeInput, 'repoPath' | 'evidence' | 'cases'>
): Promise<WriteSpecTreeResult> {
  const { repoPath, evidence, cases } = input;

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
  const pageResult = await generatePageTests(repoPath, evidence, cases);

  for (const file of generateContracts(repoPath, evidence.routes, pageResult.assetManifest, pageResult.skippedPages)) {
    writeFileSync(join(outputDir, 'spec', 'contracts', file.filename), file.content);
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

  // Makes "only build what's currently failing" mechanically enforced (via
  // the PreToolUse hook in settings.json) instead of just a sentence in the
  // kickoff prompt a model can weigh less heavily than intended.
  //
  // Note (pre-existing behavior, not introduced by page tests): this is
  // computed from coveredRouteFiles BEFORE runMutationCheck runs below — a
  // test satisfying coveredRouteFiles unblocks its file regardless of
  // whether the mutation check later downgrades it to weak/unrunnable, for
  // both API and page routes alike. Deliberate — see the plan's "Decision B"
  // for why this isn't special-cased for pages.
  const testedSourceFiles = [...visible, ...heldOut].flatMap((f) => f.coveredRouteFiles ?? [f.sourceFile]);
  const untestedContractFiles = computeUntestedContractFiles(evidence.routes, testedSourceFiles);
  writeFileSync(join(outputDir, 'spec', 'untested-contracts.json'), JSON.stringify(untestedContractFiles, null, 2));

  const pinnedDependencies = pinDependencyVersions(repoPath, evidence.packageJson.dependencies);

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
        type: 'module',
        scripts: { test: REBUILD_TEST_SCRIPT },
        ...(Object.keys(pinnedDependencies).length > 0 ? { dependencies: pinnedDependencies } : {}),
        devDependencies: usesDevServerBoilerplate ? { vitest: '^4.0.0', playwright: '^1.61.1' } : { vitest: '^4.0.0' }
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

  const mutationReport = runMutationCheck(repoPath, [...visible, ...heldOut]);
  // An unrunnable test (never passed even unmutated) gets the same "don't
  // trust this as visible/held-out" treatment as a weak one — both mean a
  // rebuild agent shouldn't rely on it, even though the underlying reason
  // (never runs at all vs. runs but proves nothing) is worth reporting
  // separately, see generateSpec.ts's tool summary.
  const weak = new Set([...mutationReport.weakTestFiles, ...mutationReport.unrunnableTestFiles]);

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

  return { mutationReport, capturedPages: pageResult.capturedPages, skippedPages: pageResult.skippedPages };
}
