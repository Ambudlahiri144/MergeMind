import {
  NotFoundError,
  RateLimitedError,
  ValidationError,
  isAppError,
  type ProblemDetails,
} from '@mergemind/shared';
import type { ErrorRequestHandler, RequestHandler } from 'express';

const PROBLEM_CONTENT_TYPE = 'application/problem+json';
const PROBLEM_TYPE_BASE = 'https://mergemind.dev/errors';
const HTTP_CLIENT_ERROR_MIN = 400;
const HTTP_CLIENT_ERROR_MAX = 499;

export const notFoundHandler: RequestHandler = (req) => {
  throw new NotFoundError(`Route ${req.method} ${req.path} not found`);
};

/** body-parser marks malformed JSON with this `type`. */
function isMalformedJsonError(error: unknown): boolean {
  return (
    error instanceof SyntaxError &&
    'type' in error &&
    (error as { type: unknown }).type === 'entity.parse.failed'
  );
}

type ExposedHttpError = Error & { status: number; expose: true };

/** body-parser and Express raise `http-errors` with `expose: true` for safe 4xx (e.g. 413). */
function isExposedClientError(error: unknown): error is ExposedHttpError {
  if (!(error instanceof Error) || !('status' in error) || !('expose' in error)) {
    return false;
  }
  const { status, expose } = error as { status: unknown; expose: unknown };
  return (
    expose === true &&
    typeof status === 'number' &&
    status >= HTTP_CLIENT_ERROR_MIN &&
    status <= HTTP_CLIENT_ERROR_MAX
  );
}

/**
 * Converts every error into RFC 9457 problem+json. Unknown errors become a generic 500
 * and are logged; stack traces never reach the client (rules.md §5).
 */
export const errorHandler: ErrorRequestHandler = (error: unknown, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  // createRequestLogger always assigns a string id.
  const context = {
    instance: req.originalUrl,
    ...(typeof req.id === 'string' ? { requestId: req.id } : {}),
  };
  const appError = isMalformedJsonError(error)
    ? new ValidationError('Request body is not valid JSON', [], { cause: error })
    : error;

  let problem: ProblemDetails;
  if (isAppError(appError)) {
    problem = appError.toProblem(context);
  } else if (isExposedClientError(appError)) {
    problem = {
      type: `${PROBLEM_TYPE_BASE}/bad-request`,
      title: appError.name,
      status: appError.status,
      detail: appError.message,
      ...context,
    };
  } else {
    req.log.error({ err: error }, 'request.unhandledError');
    problem = {
      type: `${PROBLEM_TYPE_BASE}/internal`,
      title: 'Internal Server Error',
      status: 500,
      detail: 'An unexpected error occurred.',
      ...context,
    };
  }

  if (appError instanceof RateLimitedError && appError.retryAfterSeconds !== undefined) {
    res.setHeader('Retry-After', String(appError.retryAfterSeconds));
  }
  res.status(problem.status).type(PROBLEM_CONTENT_TYPE).json(problem);
};
