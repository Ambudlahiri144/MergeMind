// Shared by the E2E stack (e2e/stack.ts) and the specs.

export const E2E_WEB_PORT = 3100;
export const E2E_API_PORT = 4100;
export const E2E_BASE_URL = `http://localhost:${String(E2E_WEB_PORT)}`;

/** Signs the test session cookie and plays BETTER_AUTH_SECRET for the web under test. */
export const E2E_AUTH_SECRET = 'e2e-better-auth-secret-not-for-production-0001';
export const E2E_API_JWT_SECRET = 'e2e-api-jwt-secret-not-for-production-000001';

export const E2E_USER = { githubId: 7_100_001, login: 'ananya-iyer' } as const;

export const E2E_REPO = 'ananya-iyer/payments';
export const E2E_EMPTY_REPO = 'ananya-iyer/docs';
export const E2E_PR_NUMBER = 12;
export const E2E_CRITICAL_TITLE = 'Live payment key committed in source';
export const E2E_MINOR_TITLE = 'Refund helper name hides what it does';
