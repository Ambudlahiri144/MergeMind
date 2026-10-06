import type { AuthUser } from '../auth/api-token.js';

declare module 'express-serve-static-core' {
  interface Request {
    /** Set by `authenticate` on every `/api/v1` route behind it. */
    user?: AuthUser;
  }
}
