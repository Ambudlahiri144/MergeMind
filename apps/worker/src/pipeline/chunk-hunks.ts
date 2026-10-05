import type { DiffHunk, FileDiff } from '@mergemind/shared';

/** Rough tokenizer-free estimate; the budget leaves headroom for the prompt and output. */
const CHARS_PER_TOKEN = 4;
/** Per-line overhead of the rendered line-number gutter. */
const LINE_OVERHEAD_TOKENS = 3;

export type ChunkFile = Pick<FileDiff, 'path' | 'previousPath' | 'hunks'>;

export type ReviewChunk = {
  files: ChunkFile[];
  estimatedTokens: number;
};

function estimateLineTokens(content: string): number {
  return Math.ceil(content.length / CHARS_PER_TOKEN) + LINE_OVERHEAD_TOKENS;
}

function estimateHunkTokens(hunk: DiffHunk): number {
  return hunk.lines.reduce(
    (total, line) => total + estimateLineTokens(line.content),
    estimateLineTokens(hunk.header),
  );
}

/** Splits an oversized hunk at line boundaries; each piece keeps exact line numbers. */
function splitHunk(hunk: DiffHunk, maxTokens: number): DiffHunk[] {
  const pieces: DiffHunk[] = [];
  let lines: DiffHunk['lines'] = [];
  let tokens = estimateLineTokens(hunk.header);
  const flush = () => {
    if (lines.length > 0) {
      const header = pieces.length === 0 ? hunk.header : `${hunk.header} (continued)`;
      pieces.push({ ...hunk, header, lines });
    }
    lines = [];
    tokens = estimateLineTokens(hunk.header);
  };
  for (const line of hunk.lines) {
    const lineTokens = estimateLineTokens(line.content);
    if (lines.length > 0 && tokens + lineTokens > maxTokens) {
      flush();
    }
    lines.push(line);
    tokens += lineTokens;
  }
  flush();
  return pieces;
}

/**
 * Packs whole hunks into chunks of at most `maxTokens` (estimated), keeping a file's hunks
 * together where possible. Only a hunk larger than the budget is split, and only between lines.
 */
export function chunkFiles(files: readonly FileDiff[], maxTokens: number): ReviewChunk[] {
  const chunks: ReviewChunk[] = [];
  let current: ReviewChunk = { files: [], estimatedTokens: 0 };

  const addPiece = (file: FileDiff, hunk: DiffHunk, tokens: number) => {
    if (current.files.length > 0 && current.estimatedTokens + tokens > maxTokens) {
      chunks.push(current);
      current = { files: [], estimatedTokens: 0 };
    }
    const last = current.files.at(-1);
    if (last?.path === file.path) {
      last.hunks.push(hunk);
    } else {
      current.files.push({ path: file.path, previousPath: file.previousPath, hunks: [hunk] });
    }
    current.estimatedTokens += tokens;
  };

  for (const file of files) {
    for (const hunk of file.hunks) {
      const tokens = estimateHunkTokens(hunk);
      const pieces = tokens > maxTokens ? splitHunk(hunk, maxTokens) : [hunk];
      for (const piece of pieces) {
        addPiece(file, piece, estimateHunkTokens(piece));
      }
    }
  }
  if (current.files.length > 0) {
    chunks.push(current);
  }
  return chunks;
}
