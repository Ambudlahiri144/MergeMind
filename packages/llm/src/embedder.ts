import { embed, embedMany, type EmbeddingModel } from 'ai';
import { createOllama } from 'ai-sdk-ollama';

/** nomic-embed-text requires a task prefix on every input (ADR-024). */
export const DOCUMENT_PREFIX = 'search_document: ';
export const QUERY_PREFIX = 'search_query: ';
/** Embeddings get their own bound (rules.md §6). */
export const EMBED_TIMEOUT_MS = 30_000;
export const EMBED_BATCH_SIZE = 32;
export const DEFAULT_EMBEDDING_DIMENSIONS = 768;

export type Embedder = {
  model: string;
  embedDocuments(texts: readonly string[]): Promise<{ embeddings: number[][]; tokens: number }>;
  embedQuery(text: string): Promise<{ embedding: number[]; tokens: number }>;
};

export type EmbedderConfig = {
  ollamaBaseUrl: string;
  model: string;
  dimensions?: number;
  /** Tests inject `MockEmbeddingModelV4`; otherwise Ollama serves `model`. */
  embeddingModel?: EmbeddingModel;
};

export class EmbeddingDimensionError extends Error {
  constructor(model: string, expected: number, actual: number) {
    super(`Embedding model ${model} returned ${actual} dimensions; the index expects ${expected}`);
    this.name = 'EmbeddingDimensionError';
  }
}

/**
 * Local embeddings only (Ollama): private code never leaves the machine (ADR-007, ADR-024).
 * Vectors of the wrong size are rejected so a model swap cannot corrupt the index.
 */
export function createEmbedder(config: EmbedderConfig): Embedder {
  const model =
    config.embeddingModel ??
    createOllama({ baseURL: config.ollamaBaseUrl }).embedding(config.model);
  const dimensions = config.dimensions ?? DEFAULT_EMBEDDING_DIMENSIONS;
  const check = (vector: number[]): number[] => {
    if (vector.length !== dimensions) {
      throw new EmbeddingDimensionError(config.model, dimensions, vector.length);
    }
    return vector;
  };

  return {
    model: config.model,

    async embedDocuments(texts) {
      const embeddings: number[][] = [];
      let tokens = 0;
      for (let start = 0; start < texts.length; start += EMBED_BATCH_SIZE) {
        const batch = texts.slice(start, start + EMBED_BATCH_SIZE);
        const result = await embedMany({
          model,
          values: batch.map((text) => `${DOCUMENT_PREFIX}${text}`),
          abortSignal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
        });
        embeddings.push(...result.embeddings.map(check));
        tokens += result.usage.tokens;
      }
      return { embeddings, tokens };
    },

    async embedQuery(text) {
      const result = await embed({
        model,
        value: `${QUERY_PREFIX}${text}`,
        abortSignal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
      });
      return { embedding: check(result.embedding), tokens: result.usage.tokens };
    },
  };
}
