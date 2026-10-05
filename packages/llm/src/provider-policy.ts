import type { LlmProviderName } from '@mergemind/shared';

export type ProviderPolicyInput = {
  isPrivateRepo: boolean;
  allowedProviders: readonly LlmProviderName[];
};

/**
 * Private code may only go to providers on the installation's allowlist
 * (rules.md §7, ADR-007). Public repos may use any configured provider.
 */
export function isProviderAllowed(provider: LlmProviderName, input: ProviderPolicyInput): boolean {
  return !input.isPrivateRepo || input.allowedProviders.includes(provider);
}

/** Keeps the configured chain order and drops providers the repo may not use. */
export function filterProviderChain(
  chain: readonly LlmProviderName[],
  input: ProviderPolicyInput,
): LlmProviderName[] {
  return chain.filter((provider) => isProviderAllowed(provider, input));
}
