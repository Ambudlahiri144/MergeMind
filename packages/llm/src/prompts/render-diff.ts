import type { FileDiff } from '@mergemind/shared';

/**
 * Renders hunks so the model cites head-side line numbers:
 *   `  12 + added`, `  13   context`, `     - removed` (removed lines have no head number).
 */
export function renderFileDiff(file: Pick<FileDiff, 'path' | 'previousPath' | 'hunks'>): string {
  const header =
    file.previousPath !== null && file.previousPath !== file.path
      ? `File: ${file.path} (renamed from ${file.previousPath})`
      : `File: ${file.path}`;
  const body = file.hunks.map((hunk) => {
    const lines = hunk.lines.map((line) => {
      const number = line.newLine === null ? '' : String(line.newLine);
      const marker = line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' ';
      return `${number.padStart(5)} ${marker} ${line.content}`;
    });
    return [hunk.header, ...lines].join('\n');
  });
  return [header, ...body].join('\n');
}
