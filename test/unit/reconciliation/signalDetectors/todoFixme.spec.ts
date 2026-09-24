import { describe, expect, it } from 'vitest';
import { detectTodoFixme } from '../../../../src/reconciliation/signalDetectors/todoFixme.js';

const locator = { file: 'src/foo.ts', startLine: 1, endLine: 1 };

describe('detectTodoFixme', () => {
  it('detects a TODO comment admitting a bug', () => {
    const intent = detectTodoFixme('// TODO: this throws on empty input, fix it', locator);
    expect(intent).not.toBeNull();
    expect(intent?.kind).toBe('todo');
    expect(intent?.confidence).toBeGreaterThan(0.5);
  });

  it('detects a FIXME comment', () => {
    const intent = detectTodoFixme('// FIXME off-by-one here', locator);
    expect(intent?.kind).toBe('fixme');
  });

  it('is case-insensitive', () => {
    expect(detectTodoFixme('// todo: handle null', locator)).not.toBeNull();
    expect(detectTodoFixme('// fixme later', locator)).not.toBeNull();
  });

  it('returns null for a comment with no TODO/FIXME marker', () => {
    expect(detectTodoFixme('// returns the user by id', locator)).toBeNull();
  });

  it('does not match TODO/FIXME appearing mid-word', () => {
    expect(detectTodoFixme('// see the methodology doc', locator)).toBeNull();
  });

  // Cold-run regression: a todo-list app's section headers were read as
  // bug-admitting TODOs, one open case each.
  it('does not treat the ordinary word "todo" in a comment as a TODO marker', () => {
    for (const c of [
      '// Add todo for user by index',
      '// Delete todo for user by index',
      '// See all todos for user by index',
      '// Update todo by id for user by index',
      '/* renders the todo list */'
    ]) {
      expect(detectTodoFixme(c, locator), c).toBeNull();
    }
  });

  it('still detects TODO/FIXME markers in their usual forms', () => {
    expect(detectTodoFixme('// TODO handle null', locator)?.kind).toBe('todo');
    expect(detectTodoFixme('// validate first. TODO: reject empty names', locator)?.kind).toBe('todo');
    expect(detectTodoFixme('// @todo: paginate', locator)?.kind).toBe('todo');
    expect(detectTodoFixme('/**\n * todo: cache this\n */', locator)?.kind).toBe('todo');
    expect(detectTodoFixme('// FIXME: race on save', locator)?.kind).toBe('fixme');
  });
});

