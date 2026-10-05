import { DEFAULT_ALLOWED_PROVIDERS, LLM_PROVIDER_NAMES } from '@mergemind/shared';
import { describe, expect, it } from 'vitest';

import { filterProviderChain, isProviderAllowed } from './provider-policy.js';

describe('isProviderAllowed', () => {
  it('allows every provider for public repos', () => {
    const input = { isPrivateRepo: false, allowedProviders: [] };

    expect(LLM_PROVIDER_NAMES.every((provider) => isProviderAllowed(provider, input))).toBe(true);
  });

  it('blocks Gemini for private repos under the default allowlist', () => {
    const input = { isPrivateRepo: true, allowedProviders: DEFAULT_ALLOWED_PROVIDERS };

    expect(isProviderAllowed('gemini', input)).toBe(false);
    expect(isProviderAllowed('groq', input)).toBe(true);
  });

  it('allows Gemini for private repos when the org opts in', () => {
    const input = { isPrivateRepo: true, allowedProviders: ['gemini'] as const };

    expect(isProviderAllowed('gemini', input)).toBe(true);
  });
});

describe('filterProviderChain', () => {
  it('keeps chain order and removes disallowed providers', () => {
    const chain = filterProviderChain(['groq', 'gemini', 'ollama'], {
      isPrivateRepo: true,
      allowedProviders: ['ollama', 'groq'],
    });

    expect(chain).toEqual(['groq', 'ollama']);
  });
});
