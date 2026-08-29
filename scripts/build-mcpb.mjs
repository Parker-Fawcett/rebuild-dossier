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

// Zipped by hand rather than `mcpb pack`: the official MCPB manifest schema
// rejects an `inputSchema` on tools[] entries, but Smithery's registry
// requires exactly that field to list a bundle's capabilities (confirmed
// against @smithery/api's ServerCard.Tool type, which marks it required).
// `mcpb validate` would reject this manifest — that's expected, not a bug.
const outputPath = `${root}${pkg.name}-${pkg.version}.mcpb`;
rmSync(outputPath, { force: true });
execFileSync('zip', ['-r', '-X', outputPath, '.'], { cwd: stagingDir, stdio: 'inherit' });
