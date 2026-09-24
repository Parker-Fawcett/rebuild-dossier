import type { AffirmativeIntent, CodeLocator } from '../types.js';

// A marker, not a word. Found live in a cold run of docs/validators.md on a
// todo-list app: the old case-insensitive `\btodo\b` read every section
// header ("// Add todo for user by index") as a bug-admitting TODO, and the
// case queue asked the operator about four comments that admitted nothing.
// Now: upper-case TODO/FIXME anywhere in the comment (the convention), or
// a lower-case marker only as the comment's first word — and for `todo`,
// which is an ordinary noun in app code, only when followed by `:`, `(`,
// `-` or `!` ("// todo: handle null").
const COMMENT_LEAD = String.raw`(?:^|\n)\s*(?:\/\/+|\/\*+|\*)\s*@?`;
const TODO_PATTERN = /\bTODO\b/;
const TODO_LOWER_MARKER = new RegExp(String.raw`${COMMENT_LEAD}todo\s*[:(!-]`, 'i');
const FIXME_PATTERN = /\bFIXME\b/;
const FIXME_LOWER_MARKER = new RegExp(String.raw`${COMMENT_LEAD}fixme\b`, 'i');

export function detectTodoFixme(commentText: string, locator: CodeLocator): AffirmativeIntent | null {
  if (FIXME_PATTERN.test(commentText) || FIXME_LOWER_MARKER.test(commentText)) {
    return { kind: 'fixme', text: commentText.trim(), locator, confidence: 0.9 };
  }
  if (TODO_PATTERN.test(commentText) || TODO_LOWER_MARKER.test(commentText)) {
    return { kind: 'todo', text: commentText.trim(), locator, confidence: 0.8 };
  }
  return null;
}
