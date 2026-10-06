import { setTimeout as sleep } from 'node:timers/promises';

import { CodeChunkModel } from './models/code-chunk.model.js';

/** Atlas Vector Search index on `codeChunks.embedding` (Architecture.md §4). */
export const CODE_CHUNKS_VECTOR_INDEX = 'code_chunks_vector';
/** Ollama `nomic-embed-text` dimensions (ADR-024). */
export const EMBEDDING_DIMENSIONS = 768;

const POLL_INTERVAL_MS = 1_000;

const VECTOR_INDEX_DEFINITION = {
  fields: [
    {
      type: 'vector',
      path: 'embedding',
      numDimensions: EMBEDDING_DIMENSIONS,
      similarity: 'cosine',
    },
    { type: 'filter', path: 'repositoryId' },
  ],
};

export type VectorIndexStatus =
  | { status: 'exists' }
  | { status: 'created' }
  /** The server cannot manage search indexes (plain MongoDB, or a tier without it). */
  | { status: 'unsupported'; reason: string };

/**
 * Creates the vector index if it is missing. Never throws for an unsupported server: retrieval is
 * optional, so the caller logs the reason and reviews continue without context (ADR-024).
 */
export async function ensureVectorSearchIndex(): Promise<VectorIndexStatus> {
  try {
    await CodeChunkModel.createCollection();
    const collection = CodeChunkModel.collection;
    const existing = await collection.listSearchIndexes(CODE_CHUNKS_VECTOR_INDEX).toArray();
    if (existing.length > 0) {
      return { status: 'exists' };
    }
    await collection.createSearchIndex({
      name: CODE_CHUNKS_VECTOR_INDEX,
      type: 'vectorSearch',
      definition: VECTOR_INDEX_DEFINITION,
    });
    return { status: 'created' };
  } catch (error) {
    return {
      status: 'unsupported',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Polls until the index reports `queryable` (a new index takes up to about a minute). */
export async function waitForVectorSearchIndex(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // The driver types these documents as `{ name }`; the server also returns status/queryable.
    const [index] = (await CodeChunkModel.collection
      .listSearchIndexes(CODE_CHUNKS_VECTOR_INDEX)
      .toArray()) as { queryable?: boolean }[];
    if (index?.queryable === true) {
      return true;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return false;
}
