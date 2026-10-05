import type { ReviewPass } from '@mergemind/shared';

import { correctnessPrompt } from './correctness.prompt.js';
import { maintainabilityPrompt } from './maintainability.prompt.js';
import { securityPrompt } from './security.prompt.js';
import type { ReviewPrompt } from './shared.js';

export type { ReviewPrompt, ReviewPromptInput } from './shared.js';

export const REVIEW_PROMPTS: Record<ReviewPass, ReviewPrompt> = {
  security: securityPrompt,
  correctness: correctnessPrompt,
  maintainability: maintainabilityPrompt,
};

/** Stored on `reviewRuns.promptVersion`, e.g. `security@1+correctness@1`. */
export function promptVersionFor(passes: readonly ReviewPass[]): string {
  return passes.map((pass) => REVIEW_PROMPTS[pass].version).join('+');
}
