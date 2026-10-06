import type { CodeChunkHit } from '@mergemind/db';
import { toFileDiff } from '@mergemind/github';
import { describe, expect, it } from 'vitest';

import type { ReviewChunk } from './chunk-hunks.js';
import { extractCalledNames, queryTextFor, selectContext } from './retrieve-context.js';

const file = toFileDiff({
  filename: 'src/users.ts',
  status: 'modified',
  additions: 2,
  deletions: 0,
  patch: [
    '@@ -10,1 +10,3 @@',
    ' export async function findUser(id) {',
    '+  const row = await db.query(buildSql(id));',
    '+  if (row) return mapUser(row);',
  ].join('\n'),
});
const chunk: ReviewChunk = { files: [file], estimatedTokens: 50 };

function hit(overrides: Partial<CodeChunkHit>): CodeChunkHit {
  return {
    path: 'src/db.ts',
    symbol: 'query',
    kind: 'function',
    startLine: 1,
    endLine: 3,
    content: 'export function query(sql) {}',
    score: 0.5,
    ...overrides,
  };
}

describe('queryTextFor / extractCalledNames', () => {
  it('queries with the added lines only', () => {
    expect(queryTextFor(chunk)).toBe(
      '  const row = await db.query(buildSql(id));\n  if (row) return mapUser(row);',
    );
  });

  it('collects called function names, skipping keywords and tiny names', () => {
    expect(extractCalledNames(chunk)).toEqual(['query', 'buildSql', 'mapUser']);
  });
});

describe('selectContext', () => {
  it('ranks exact name matches first, then vector hits by score', () => {
    const selected = selectContext(
      chunk,
      [hit({ symbol: 'mapUser', path: 'src/map.ts', score: 1 })],
      [hit({ symbol: 'low', score: 0.2 }), hit({ symbol: 'high', score: 0.9 })],
    );

    expect(selected.map((snippet) => snippet.symbol)).toEqual(['mapUser', 'high', 'low']);
  });

  it('drops the code the chunk itself changes and duplicate symbols', () => {
    const selected = selectContext(
      chunk,
      [hit({ symbol: 'query' })],
      [
        hit({ symbol: 'query', score: 0.9 }),
        hit({ path: 'src/users.ts', symbol: 'findUser', startLine: 10, endLine: 14 }),
      ],
    );

    expect(selected.map((snippet) => `${snippet.path}#${snippet.symbol}`)).toEqual([
      'src/db.ts#query',
    ]);
  });

  it('stays within the character budget', () => {
    const big = 'x'.repeat(4_000);

    const selected = selectContext(
      chunk,
      [],
      [
        hit({ symbol: 'a', content: big, score: 0.9 }),
        hit({ symbol: 'b', content: big, score: 0.8 }),
        hit({ symbol: 'c', content: 'small', score: 0.1 }),
      ],
      5_000,
    );

    expect(selected.map((snippet) => snippet.symbol)).toEqual(['a', 'c']);
  });
});
