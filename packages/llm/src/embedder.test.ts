import { MockEmbeddingModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';

import {
  DOCUMENT_PREFIX,
  EMBED_BATCH_SIZE,
  EmbeddingDimensionError,
  QUERY_PREFIX,
  createEmbedder,
} from './embedder.js';

const DIMS = 4;

function mockModel(dims = DIMS) {
  return new MockEmbeddingModelV4({
    maxEmbeddingsPerCall: 100,
    doEmbed: ({ values }) =>
      Promise.resolve({
        embeddings: values.map((_, index) => Array.from({ length: dims }, () => index)),
        usage: { tokens: values.length * 10 },
        warnings: [],
      }),
  });
}

describe('createEmbedder', () => {
  it('prefixes documents with search_document: and batches by 32', async () => {
    const model = mockModel();
    const embedder = createEmbedder({
      ollamaBaseUrl: 'http://x',
      model: 'nomic-embed-text',
      dimensions: DIMS,
      embeddingModel: model,
    });
    const texts = Array.from({ length: EMBED_BATCH_SIZE + 3 }, (_, index) => `chunk ${index}`);

    const result = await embedder.embedDocuments(texts);

    expect(result.embeddings).toHaveLength(EMBED_BATCH_SIZE + 3);
    expect(result.tokens).toBe((EMBED_BATCH_SIZE + 3) * 10);
    expect(model.doEmbedCalls.map((call) => call.values.length)).toEqual([EMBED_BATCH_SIZE, 3]);
    expect(model.doEmbedCalls[0]?.values[0]).toBe(`${DOCUMENT_PREFIX}chunk 0`);
  });

  it('prefixes queries with search_query:', async () => {
    const model = mockModel();
    const embedder = createEmbedder({
      ollamaBaseUrl: 'http://x',
      model: 'nomic-embed-text',
      dimensions: DIMS,
      embeddingModel: model,
    });

    const result = await embedder.embedQuery('db.insert(user)');

    expect(result.embedding).toHaveLength(DIMS);
    expect(model.doEmbedCalls[0]?.values).toEqual([`${QUERY_PREFIX}db.insert(user)`]);
  });

  it('rejects vectors of the wrong size (a different model would corrupt the index)', async () => {
    const embedder = createEmbedder({
      ollamaBaseUrl: 'http://x',
      model: 'other-model',
      dimensions: DIMS,
      embeddingModel: mockModel(DIMS + 1),
    });

    await expect(embedder.embedQuery('x')).rejects.toBeInstanceOf(EmbeddingDimensionError);
  });

  it('returns nothing for no texts without calling the model', async () => {
    const model = mockModel();
    const embedder = createEmbedder({
      ollamaBaseUrl: 'http://x',
      model: 'm',
      dimensions: DIMS,
      embeddingModel: model,
    });

    expect(await embedder.embedDocuments([])).toEqual({ embeddings: [], tokens: 0 });
    expect(model.doEmbedCalls).toHaveLength(0);
  });
});
