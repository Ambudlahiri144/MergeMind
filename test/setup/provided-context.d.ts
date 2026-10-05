// Values provided by test/setup/containers.ts and read with `inject()` in *.int.test.ts.
// Workspaces with integration tests include this file in their tsconfig.json.
import 'vitest';

declare module 'vitest' {
  export interface ProvidedContext {
    mongoUri: string;
    redisUrl: string;
  }
}
