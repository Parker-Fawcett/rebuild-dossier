import { describe, expect, it } from 'vitest';
import { assetManifestEntrySchema, assetManifestEntryKindSchema } from '../../../src/spec/assetManifestSchema.js';

describe('assetManifestEntrySchema', () => {
  it('accepts a valid screenshot entry', () => {
    const entry = {
      id: 'PAGE-root-screenshot',
      path: 'spec/assets/screenshots/PAGE-root.png',
      hash: 'a'.repeat(64),
      kind: 'screenshot',
      metadata: { routeFile: 'page.tsx', path: '/' }
    };
    expect(() => assetManifestEntrySchema.parse(entry)).not.toThrow();
  });

  it('accepts the reserved, currently-unused source-asset kind', () => {
    const entry = {
      id: 'src-asset-1',
      path: 'spec/assets/source/logo.png',
      hash: 'b'.repeat(64),
      kind: 'source-asset',
      metadata: {}
    };
    expect(() => assetManifestEntrySchema.parse(entry)).not.toThrow();
  });

  it('rejects an entry with an unknown kind', () => {
    const entry = {
      id: 'x',
      path: 'x.png',
      hash: 'c'.repeat(64),
      kind: 'video',
      metadata: {}
    };
    expect(() => assetManifestEntrySchema.parse(entry)).toThrow();
  });

  it('rejects an entry missing hash', () => {
    const entry = {
      id: 'x',
      path: 'x.png',
      kind: 'screenshot',
      metadata: {}
    };
    expect(() => assetManifestEntrySchema.parse(entry)).toThrow();
  });
});

describe('assetManifestEntryKindSchema', () => {
  it('accepts both documented kinds', () => {
    expect(() => assetManifestEntryKindSchema.parse('screenshot')).not.toThrow();
    expect(() => assetManifestEntryKindSchema.parse('source-asset')).not.toThrow();
  });
});
