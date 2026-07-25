import { describe, expect, it } from 'vitest';
import { pageCaptureSchema, domTextNodeSchema, dynamicShapeSchema } from '../../../src/spec/pageCaptureSchema.js';

describe('pageCaptureSchema', () => {
  it('accepts a minimal valid capture with no screenshot', () => {
    const capture = {
      routeFile: 'page.tsx',
      path: '/',
      capturedAt: new Date(0).toISOString(),
      consoleErrors: [],
      domOutline: []
    };
    expect(() => pageCaptureSchema.parse(capture)).not.toThrow();
  });

  it('accepts a full capture with dynamic and static dom text nodes plus a screenshot id', () => {
    const capture = {
      routeFile: 'home/page.tsx',
      path: '/home',
      capturedAt: new Date(0).toISOString(),
      consoleErrors: ['a console warning'],
      domOutline: [
        { selectorHint: 'h1', text: 'Welcome', kind: 'static' },
        { selectorHint: '.price', text: '$42.00', kind: 'dynamic', dynamicShape: 'currency' }
      ],
      screenshotAssetId: 'PAGE-home-screenshot'
    };
    expect(() => pageCaptureSchema.parse(capture)).not.toThrow();
  });

  it('rejects a capture missing routeFile', () => {
    const capture = {
      path: '/',
      capturedAt: new Date(0).toISOString(),
      consoleErrors: [],
      domOutline: []
    };
    expect(() => pageCaptureSchema.parse(capture)).toThrow();
  });
});

describe('domTextNodeSchema', () => {
  it('rejects a dynamic node with an invalid dynamicShape value', () => {
    const node = { selectorHint: 'span', text: '123', kind: 'dynamic', dynamicShape: 'not-a-real-shape' };
    expect(() => domTextNodeSchema.parse(node)).toThrow();
  });

  it('accepts a static node with no dynamicShape', () => {
    const node = { selectorHint: 'span', text: 'hello', kind: 'static' };
    expect(() => domTextNodeSchema.parse(node)).not.toThrow();
  });
});

describe('dynamicShapeSchema', () => {
  it('accepts every documented shape', () => {
    for (const shape of ['currency', 'iso-date', 'relative-time', 'uuid', 'number']) {
      expect(() => dynamicShapeSchema.parse(shape)).not.toThrow();
    }
  });

  it('rejects an unknown shape', () => {
    expect(() => dynamicShapeSchema.parse('percentage')).toThrow();
  });
});
