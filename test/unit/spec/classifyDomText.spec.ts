import { describe, expect, it } from 'vitest';
import { classifyDomText } from '../../../src/spec/classifyDomText.js';

describe('classifyDomText', () => {
  it('classifies empty/whitespace-only text as static', () => {
    expect(classifyDomText('')).toEqual({ kind: 'static' });
    expect(classifyDomText('   ')).toEqual({ kind: 'static' });
  });

  it('classifies ordinary prose as static (control case)', () => {
    expect(classifyDomText('Welcome to Catch and Trade')).toEqual({ kind: 'static' });
  });

  it('classifies a uuid as dynamic', () => {
    expect(classifyDomText('550e8400-e29b-41d4-a716-446655440000')).toEqual({
      kind: 'dynamic',
      dynamicShape: 'uuid'
    });
  });

  it('classifies an ISO date as dynamic', () => {
    expect(classifyDomText('2024-01-15T10:30:00Z')).toEqual({ kind: 'dynamic', dynamicShape: 'iso-date' });
    expect(classifyDomText('2024-01-15')).toEqual({ kind: 'dynamic', dynamicShape: 'iso-date' });
  });

  it('classifies currency as dynamic', () => {
    expect(classifyDomText('$1,234.56')).toEqual({ kind: 'dynamic', dynamicShape: 'currency' });
    expect(classifyDomText('42.00 USD')).toEqual({ kind: 'dynamic', dynamicShape: 'currency' });
  });

  it('classifies relative time as dynamic', () => {
    expect(classifyDomText('3 minutes ago')).toEqual({ kind: 'dynamic', dynamicShape: 'relative-time' });
    expect(classifyDomText('just now')).toEqual({ kind: 'dynamic', dynamicShape: 'relative-time' });
    expect(classifyDomText('yesterday')).toEqual({ kind: 'dynamic', dynamicShape: 'relative-time' });
  });

  it('classifies a plain number (including a trailing percent) as dynamic', () => {
    expect(classifyDomText('42')).toEqual({ kind: 'dynamic', dynamicShape: 'number' });
    expect(classifyDomText('-3.5%')).toEqual({ kind: 'dynamic', dynamicShape: 'number' });
  });

  it('trims surrounding whitespace before classifying', () => {
    expect(classifyDomText('  42  ')).toEqual({ kind: 'dynamic', dynamicShape: 'number' });
  });
});
