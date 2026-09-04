#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createServer } from './server.js';

serveStdio(createServer);
console.error('rebuild-dossier MCP server running on stdio');
