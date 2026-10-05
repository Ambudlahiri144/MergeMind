/** Where an inline comment goes on the head side (`side: 'RIGHT'`). */
export type CommentAnchor = {
  line: number;
  /** Present only for multi-line comments; always in the same hunk as `line`. */
  startLine?: number;
};

/**
 * Fits a finding's line range onto lines GitHub will accept (see `commentableLines`):
 * the full range when both ends share a hunk, otherwise a single commentable line inside it,
 * otherwise null (the finding is listed in the review body instead).
 */
export function anchorFinding(
  range: { lineStart: number; lineEnd: number },
  commentable: ReadonlyMap<number, number>,
): CommentAnchor | null {
  const { lineStart, lineEnd } = range;
  const startHunk = commentable.get(lineStart);
  const endHunk = commentable.get(lineEnd);

  if (startHunk !== undefined && startHunk === endHunk) {
    return lineStart === lineEnd ? { line: lineEnd } : { line: lineEnd, startLine: lineStart };
  }
  if (endHunk !== undefined) {
    return { line: lineEnd };
  }
  if (startHunk !== undefined) {
    return { line: lineStart };
  }
  for (let line = lineStart + 1; line < lineEnd; line += 1) {
    if (commentable.has(line)) {
      return { line };
    }
  }
  return null;
}
