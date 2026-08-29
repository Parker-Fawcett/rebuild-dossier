#!/usr/bin/env node
// Stages a production-only copy of the compiled server and packs it into an
// .mcpb bundle for local (stdio) distribution via Smithery/Claude Desktop.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const stagingDir = `${root}.mcpb-build`;
const pkg = JSON.parse(readFileSync(`${root}package.json`, 'utf8'));

execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' });

rmSync(stagingDir, { recursive: true, force: true });
mkdirSync(`${stagingDir}/server`, { recursive: true });
cpSync(`${root}dist`, `${stagingDir}/server`, { recursive: true });
cpSync(`${root}manifest.json`, `${stagingDir}/manifest.json`);
writeFileSync(
  `${stagingDir}/package.json`,
  JSON.stringify(
    { name: pkg.name, version: pkg.version, type: pkg.type, dependencies: pkg.dependencies },
    null,
    2
  )
);

execFileSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], {
  cwd: stagingDir,
  stdio: 'inherit'
});

execFileSync(
  'npx',
  ['--yes', '@anthropic-ai/mcpb', 'pack', stagingDir, `${root}${pkg.name}-${pkg.version}.mcpb`],
  { cwd: root, stdio: 'inherit' }
);
