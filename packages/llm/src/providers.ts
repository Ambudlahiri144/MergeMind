import { createGoogle } from '@ai-sdk/google';
import { createGroq } from '@ai-sdk/groq';
import type { LlmProviderName } from '@mergemind/shared';
import type { LanguageModel } from 'ai';
import { createOllama } from 'ai-sdk-ollama';

export type ProviderEntry = {
  name: LlmProviderName;
  modelId: string;
  model: LanguageModel;
};

export type ProviderChainConfig = {
  groqApiKey?: string;
  googleApiKey?: string;
  ollamaBaseUrl: string;
  /** Model ids come from env, never from code paths (ADR-007). */
  primaryModel: string;
  fallbackModel?: string;
  localModel: string;
};

/**
 * Groq → Gemini → Ollama, keeping only providers that are configured. Ollama is always present:
 * it is local, free, and the only provider allowed for private code by default.
 */
export function createProviderChain(config: ProviderChainConfig): ProviderEntry[] {
  const chain: ProviderEntry[] = [];
  if (config.groqApiKey !== undefined) {
    const groq = createGroq({ apiKey: config.groqApiKey });
    chain.push({ name: 'groq', modelId: config.primaryModel, model: groq(config.primaryModel) });
  }
  if (config.googleApiKey !== undefined && config.fallbackModel !== undefined) {
    const google = createGoogle({ apiKey: config.googleApiKey });
    chain.push({
      name: 'gemini',
      modelId: config.fallbackModel,
      model: google(config.fallbackModel),
    });
  }
  const ollama = createOllama({ baseURL: config.ollamaBaseUrl });
  chain.push({ name: 'ollama', modelId: config.localModel, model: ollama(config.localModel) });
  return chain;
}
