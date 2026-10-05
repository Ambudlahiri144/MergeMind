const API_BASE_PATH = '/api/v1';

/**
 * Builds an absolute URL for an `apps/api` endpoint. All web to api traffic goes through
 * this module (rules.md §9).
 */
export function buildApiUrl(path: string, baseUrl: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return new URL(`${API_BASE_PATH}${normalizedPath}`, baseUrl).toString();
}
