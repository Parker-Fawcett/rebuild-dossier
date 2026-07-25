import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EvidenceBundle } from '../ingest/evidenceSchema.js';
import type { Case } from '../reconciliation/types.js';
import type { GeneratedTestFile } from './generateTests.js';
import { toPosixRelative } from '../util/paths.js';
import { listSourceFiles } from '../util/listSourceFiles.js';
import { findSecretConst } from '../ingest/smellDetectors/clientSideSecretGate.js';
import { devServerBoilerplate } from './nextDevServerBoilerplate.js';

const GATE_TOPIC_PREFIX = 'smell:client-side-secret-gate:';

// Matches a `useEffect`-style guard: some check whose name looks like an
// unlock/auth gate, negated, followed shortly by a client-side redirect —
// the actual mechanism a client-side-secret-gate case is about, even though
// the case itself is usually anchored to a different file (the input form).
const REDIRECT_GUARD_PATTERN = /if\s*\(\s*!\s*\w*(?:unlock|auth|logged)\w*\s*\([^)]*\)\s*\)[\s\S]{0,120}?router\.(?:replace|push)\(/i;

export function findRedirectGateFile(repoPath: string, filePaths: string[]): string | null {
  for (const filePath of filePaths) {
    const text = readFileSync(filePath, 'utf-8');
    if (REDIRECT_GUARD_PATTERN.test(text)) {
      return toPosixRelative(repoPath, filePath);
    }
  }
  return null;
}

// Toggling between near-duplicate component variants via commented-out
// imports (see login-gate-variant-a/b) is common enough that a resolved
// smell case may point at a file nobody actually renders — only test the
// file that's genuinely wired into the app.
export function isComponentLive(repoPath: string, filePaths: string[], componentFile: string): boolean {
  const baseName = componentFile.split('/').pop()!.replace(/\.[jt]sx?$/, '');
  // Anchored so "login-gate" doesn't match inside "login-gate-variant-a" —
  // the name must be the exact final path segment of the import specifier.
  const importPathPattern = new RegExp(`/${baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`);

  for (const filePath of filePaths) {
    const relPath = toPosixRelative(repoPath, filePath);
    if (relPath === componentFile) continue;
    const text = readFileSync(filePath, 'utf-8');
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('//')) continue;
      if (/^import\b/.test(trimmed) && importPathPattern.test(trimmed)) {
        return true;
      }
    }
  }
  return false;
}

function concretePath(path: string): string {
  return path.replace(/:[^/]+/g, 'test-value-123');
}

function testFileContent(gatePath: string, protectedPath: string): string {
  return `import { describe, it, expect, beforeAll, afterAll } from 'vitest';
${devServerBoilerplate()}
describe(${JSON.stringify(`gate redirect: unauthenticated ${protectedPath} -> ${gatePath}`)}, () => {
  it(${JSON.stringify(`redirects an unauthenticated visit to ${protectedPath} back to ${gatePath} (from-reconciliation)`)}, async () => {
    const context = await browser.newContext(); // fresh context — no localStorage carried over, i.e. unauthenticated
    const page = await context.newPage();
    await page.goto(\`\${baseUrl}${concretePath(protectedPath)}\`, { waitUntil: 'load' });
    await page.waitForURL(\`\${baseUrl}${gatePath}\`, { timeout: 15000 });
    expect(new URL(page.url()).pathname).toBe(${JSON.stringify(gatePath)});
    await context.close();
  }, 30000);
});
`;
}

function secretEntryTestContent(gatePath: string, targetPath: string, secretValue: string): string {
  return `import { describe, it, expect, beforeAll, afterAll } from 'vitest';
${devServerBoilerplate()}
describe('gate secret entry (from-reconciliation)', () => {
  it(${JSON.stringify(`entering the correct value unlocks and navigates to ${targetPath}`)}, async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(\`\${baseUrl}${gatePath}\`, { waitUntil: 'load' });
    // A real person takes a beat to read the page before typing; automation
    // acting the instant the DOM exists can outrace client-side hydration
    // and lose the very first keystroke/event — a testing artifact, not a
    // real behavior to require the app to defend against.
    await page.waitForTimeout(750);
    const input = page.locator('input[type="text"]');
    await input.fill(${JSON.stringify(secretValue)});
    await input.press('Enter');
    await page.waitForURL(\`\${baseUrl}${targetPath}\`, { timeout: 15000 });
    expect(new URL(page.url()).pathname).toBe(${JSON.stringify(targetPath)});
    await context.close();
  }, 30000);

  it('entering an incorrect value does not unlock', async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(\`\${baseUrl}${gatePath}\`, { waitUntil: 'load' });
    await page.waitForTimeout(750);
    const input = page.locator('input[type="text"]');
    await input.fill('definitely-not-the-secret-xyz');
    await input.press('Enter');
    await page.waitForTimeout(1500);
    expect(new URL(page.url()).pathname).toBe(${JSON.stringify(gatePath)});
    await context.close();
  }, 30000);
});
`;
}

// Complements generateTests.ts (Express-API-specific) for page/component apps
// with no API routes at all — this only ever produces one thing: a test
// that a resolved client-side gate case implies (a real client-side check
// exists, so an unauthenticated visit to a protected route must redirect).
export function generateGateTests(repoPath: string, evidence: EvidenceBundle, cases: Case[]): GeneratedTestFile[] {
  const isNext = Object.hasOwn(evidence.packageJson.dependencies, 'next');
  if (!isNext) return [];

  const hasResolvedGateCase = cases.some((c) => c.topicKey.startsWith(GATE_TOPIC_PREFIX) && c.status !== 'open');
  if (!hasResolvedGateCase) return [];

  const gateRoute = evidence.routes.find((r) => r.kind === 'page' && r.path === '/');
  const protectedRoute = evidence.routes.find((r) => r.kind === 'page' && r.path !== '/');
  if (!gateRoute || !protectedRoute) return [];

  const filePaths = listSourceFiles(repoPath);
  const guardFile = findRedirectGateFile(repoPath, filePaths);
  if (!guardFile) return [];

  return [
    {
      filename: 'gate-redirect.spec.ts',
      content: testFileContent(gateRoute.path, protectedRoute.path),
      sourceFile: guardFile,
      coveredRouteFiles: [gateRoute.file, protectedRoute.file]
    }
  ];
}

// Complements generateGateTests above: that test proves a gate MECHANISM
// exists (redirect-when-unauthenticated). This one proves the specific,
// resolved comparison logic behind it actually works — the harder, more
// interesting claim, and the reason a resolved case is worth more than a
// boolean "is it gated" check. Only ever targets whichever gate file is
// actually rendered by the app; a resolved case for a commented-out
// near-duplicate variant produces nothing (see isComponentLive above).
export function generateSecretEntryTests(repoPath: string, evidence: EvidenceBundle, cases: Case[]): GeneratedTestFile[] {
  const isNext = Object.hasOwn(evidence.packageJson.dependencies, 'next');
  if (!isNext) return [];

  const gateFiles = cases
    .filter((c) => c.topicKey.startsWith(GATE_TOPIC_PREFIX) && c.status !== 'open')
    .map((c) => c.topicKey.slice(GATE_TOPIC_PREFIX.length));
  if (gateFiles.length === 0) return [];

  const gateRoute = evidence.routes.find((r) => r.kind === 'page' && r.path === '/');
  if (!gateRoute) return [];

  const filePaths = listSourceFiles(repoPath);
  const liveFile = gateFiles.find((file) => isComponentLive(repoPath, filePaths, file));
  if (!liveFile) return [];

  const text = readFileSync(join(repoPath, liveFile), 'utf-8');
  const secret = findSecretConst(text);
  if (!secret) return [];

  const protectedRoute = evidence.routes.find((r) => r.kind === 'page' && r.path !== '/');
  const targetPath = protectedRoute?.path ?? '/home';

  return [
    {
      filename: 'gate-secret-entry.spec.ts',
      content: secretEntryTestContent(gateRoute.path, targetPath, secret.value),
      sourceFile: liveFile,
      coveredRouteFiles: protectedRoute ? [gateRoute.file, protectedRoute.file] : [gateRoute.file]
    }
  ];
}
