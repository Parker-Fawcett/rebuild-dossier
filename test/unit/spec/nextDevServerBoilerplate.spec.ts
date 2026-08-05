import { describe, expect, it } from 'vitest';
import { devServerBoilerplate } from '../../../src/spec/nextDevServerBoilerplate.js';

describe('devServerBoilerplate', () => {
  it('reuses the shared spawn/wait/kill logic (existing shape, unaffected by the env-override addition)', () => {
    const content = devServerBoilerplate();
    expect(content).toContain("from 'playwright'");
    expect(content).toContain('beforeAll');
    expect(content).toContain('afterAll');
  });

  it('inlines the local-API-URL override resolver, since the generated file has no dependency on rebuild-dossier itself', () => {
    const content = devServerBoilerplate();
    expect(content).toContain('function resolveLocalApiUrlOverrides(repoPath, baseUrl)');
    expect(content).toContain('NEXT_PUBLIC_');
    expect(content).toContain("import { existsSync, readFileSync } from 'node:fs';");
  });

  it('passes the resolved overrides into the spawned dev server\'s own env, alongside the inherited process.env', () => {
    const content = devServerBoilerplate();
    expect(content).toContain('env: { ...process.env, ...resolveLocalApiUrlOverrides(appRoot, baseUrl) }');
  });
});
