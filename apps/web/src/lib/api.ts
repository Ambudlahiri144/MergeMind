import 'server-only';

import {
  API_BASE_PATH,
  API_JWT_AUDIENCE,
  API_JWT_ISSUER,
  API_JWT_TTL_SECONDS,
} from '@mergemind/shared';
import { SignJWT } from 'jose';
import type { z } from 'zod';

import { webEnv } from './env';
import type { Viewer } from './session';

/** A problem+json answer from the api, kept whole for the error panel (Design.md §3). */
export type Problem = {
  type: string;
  title: string;
  status: number;
  detail: string;
  requestId?: string;
};

export class ApiError extends Error {
  constructor(readonly problem: Problem) {
    super(`${String(problem.status)} ${problem.title}: ${problem.detail}`);
    this.name = 'ApiError';
  }
}

const REQUEST_TIMEOUT_MS = 15_000;

/** The 5-minute bearer token the api verifies (ADR-029): identity only, no GitHub token. */
export async function mintApiToken(
  viewer: Viewer,
  secret: string,
  now = new Date(),
): Promise<string> {
  const issuedAt = Math.floor(now.getTime() / 1000);
  return new SignJWT({ login: viewer.login })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(viewer.githubId))
    .setIssuer(API_JWT_ISSUER)
    .setAudience(API_JWT_AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + API_JWT_TTL_SECONDS)
    .sign(new TextEncoder().encode(secret));
}

function toProblem(status: number, body: unknown, requestId: string | null): Problem {
  if (typeof body === 'object' && body !== null && 'title' in body && 'detail' in body) {
    const record = body as Record<string, unknown>;
    return {
      type: typeof record.type === 'string' ? record.type : 'about:blank',
      title: String(record.title),
      status,
      detail: String(record.detail),
      ...(typeof record.requestId === 'string' ? { requestId: record.requestId } : {}),
    };
  }
  return {
    type: 'about:blank',
    title: 'Unexpected response',
    status,
    detail: 'The MergeMind API answered in an unexpected way. Try again in a moment.',
    ...(requestId === null ? {} : { requestId }),
  };
}

/**
 * Every web -> api call goes through here (rules.md §9): a fresh token per request, a timeout,
 * problem+json errors as `ApiError`, and success bodies parsed with the shared schema.
 */
export async function apiRequest<Schema extends z.ZodType>(
  viewer: Viewer,
  path: string,
  schema: Schema,
  init: { method?: 'GET' | 'POST' | 'PATCH' | 'PUT'; body?: unknown } = {},
): Promise<z.infer<Schema>> {
  const env = webEnv();
  if (env.API_JWT_SECRET === undefined) {
    throw new ApiError({
      type: 'https://mergemind.dev/errors/unavailable',
      title: 'Service Unavailable',
      status: 503,
      detail: 'The web app is missing API_JWT_SECRET, so it cannot call the MergeMind API.',
    });
  }
  const token = await mintApiToken(viewer, env.API_JWT_SECRET);
  const url = new URL(`${API_BASE_PATH}${path}`, env.API_BASE_URL);
  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method ?? 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      cache: 'no-store',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new ApiError({
      type: 'https://mergemind.dev/errors/upstream',
      title: 'API unreachable',
      status: 503,
      detail: `The MergeMind API did not answer (${error instanceof Error ? error.name : 'network error'}). Check that it is running.`,
    });
  }
  const requestId = response.headers.get('x-request-id');
  const body: unknown = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(toProblem(response.status, body, requestId));
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(toProblem(response.status, null, requestId));
  }
  return parsed.data;
}
