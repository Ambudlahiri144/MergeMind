const FALLBACK = '/repos';

/**
 * Only same-site paths are followed after sign-in (no open redirect). A path must start with one
 * `/` that is not followed by `/` or `\`: browsers treat `//host` and `/\host` as another origin.
 */
export function safeNext(value: unknown): string {
  return typeof value === 'string' && /^\/(?![/\\])/.test(value) ? value : FALLBACK;
}
