// If a string literal or comment starts at `i`, the index of its last
// character; otherwise -1. Comments matter as much as strings: an apostrophe
// in `// they're` used to open a phantom string that swallowed the rest of the
// file, so the handler's closing bracket was never found. Found live on a
// 5,800-line Express server, where it left 5 of 29 contracts with no handler
// source and dropped a direct helper from another.
export function skipLiteralOrComment(text: string, i: number): number {
  const c = text[i]!;
  if (c === "'" || c === '"' || c === '`') {
    let j = i + 1;
    for (; j < text.length && text[j] !== c; j++) if (text[j] === '\\') j++;
    return j;
  }
  if (c === '/' && text[i + 1] === '/') {
    const end = text.indexOf('\n', i);
    return end === -1 ? text.length - 1 : end;
  }
  if (c === '/' && text[i + 1] === '*') {
    const end = text.indexOf('*/', i + 2);
    return end === -1 ? text.length - 1 : end + 1;
  }
  return -1;
}
