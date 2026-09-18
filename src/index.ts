#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createServer } from './server.js';

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log([
    'rebuild-dossier: MCP server that reverse-engineers a locked rebuild spec from an existing app.',
    '',
    'This runs as an MCP server over stdio, not a standalone CLI command. Add it to your MCP client, e.g.:',
    '  claude mcp add rebuild-dossier -- npx -y rebuild-dossier@latest',
    '',
    'Repository: https://github.com/Parker-Fawcett/rebuild-dossier'
  ].join('\n'));
  process.exit(0);
}

serveStdio(createServer);
console.error('rebuild-dossier MCP server running on stdio');
