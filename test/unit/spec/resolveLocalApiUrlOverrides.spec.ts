import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveLocalApiUrlOverrides } from '../../../src/spec/resolveLocalApiUrlOverrides.js';

describe('resolveLocalApiUrlOverrides', () => {
  it('returns an empty object when no env files exist at all', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-envoverride-'));
    try {
      expect(resolveLocalApiUrlOverrides(dir, 'http://localhost:12345')).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('overrides a NEXT_PUBLIC_* var hardcoded to a fixed localhost port', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-envoverride-'));
    try {
      writeFileSync(join(dir, '.env.development'), 'NEXT_PUBLIC_API_URL=http://localhost:3003\n');
      expect(resolveLocalApiUrlOverrides(dir, 'http://localhost:12345')).toEqual({
        NEXT_PUBLIC_API_URL: 'http://localhost:12345'
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('matches 127.0.0.1 the same as localhost', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-envoverride-'));
    try {
      writeFileSync(join(dir, '.env'), 'NEXT_PUBLIC_API_URL=http://127.0.0.1:3003\n');
      expect(resolveLocalApiUrlOverrides(dir, 'http://localhost:12345')).toEqual({
        NEXT_PUBLIC_API_URL: 'http://localhost:12345'
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('matches a quoted value', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-envoverride-'));
    try {
      writeFileSync(join(dir, '.env.local'), 'NEXT_PUBLIC_API_URL="http://localhost:3003"\n');
      expect(resolveLocalApiUrlOverrides(dir, 'http://localhost:12345')).toEqual({
        NEXT_PUBLIC_API_URL: 'http://localhost:12345'
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not touch a NEXT_PUBLIC_* var pointing at a real, non-localhost host', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-envoverride-'));
    try {
      writeFileSync(join(dir, '.env.development'), 'NEXT_PUBLIC_API_URL=https://api.realstaginghost.com\n');
      expect(resolveLocalApiUrlOverrides(dir, 'http://localhost:12345')).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ignores a commented-out line', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-envoverride-'));
    try {
      writeFileSync(join(dir, '.env.development'), '# NEXT_PUBLIC_API_URL=http://localhost:3003\n');
      expect(resolveLocalApiUrlOverrides(dir, 'http://localhost:12345')).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not touch a non-NEXT_PUBLIC_ (server-only) var pointing at localhost', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-envoverride-'));
    try {
      writeFileSync(join(dir, '.env.development'), 'API_URL=http://localhost:3003\n');
      expect(resolveLocalApiUrlOverrides(dir, 'http://localhost:12345')).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('dedupes the same key found across multiple env files into one override', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-envoverride-'));
    try {
      writeFileSync(join(dir, '.env'), 'NEXT_PUBLIC_API_URL=http://localhost:3003\n');
      writeFileSync(join(dir, '.env.development'), 'NEXT_PUBLIC_API_URL=http://localhost:4004\n');
      expect(resolveLocalApiUrlOverrides(dir, 'http://localhost:12345')).toEqual({
        NEXT_PUBLIC_API_URL: 'http://localhost:12345'
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('collects distinct NEXT_PUBLIC_* keys across multiple files and multiple lines', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rebuild-dossier-envoverride-'));
    try {
      writeFileSync(join(dir, '.env'), 'NEXT_PUBLIC_API_URL=http://localhost:3003\nNEXT_PUBLIC_WS_URL=http://localhost:3004\n');
      writeFileSync(join(dir, '.env.development.local'), 'NEXT_PUBLIC_ASSET_URL=http://localhost:3005\n');
      expect(resolveLocalApiUrlOverrides(dir, 'http://localhost:12345')).toEqual({
        NEXT_PUBLIC_API_URL: 'http://localhost:12345',
        NEXT_PUBLIC_WS_URL: 'http://localhost:12345',
        NEXT_PUBLIC_ASSET_URL: 'http://localhost:12345'
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
