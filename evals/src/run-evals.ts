import { createLogger } from '@mergemind/shared/logger';

// Phase 7 builds the seeded-bug runner (Testing.md §4). Until then this exits non-zero
// so nobody mistakes a no-op for a passing benchmark.
const logger = createLogger({ name: 'evals', level: 'info' });

logger.error(
  { phase: 7 },
  'eval.notImplemented: the seeded-bug benchmark arrives in Phase 7 (see memory.md)',
);
process.exitCode = 1;
