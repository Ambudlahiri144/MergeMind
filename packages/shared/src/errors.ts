import type { z } from 'zod';

import { PROBLEM_TYPE_BASE_URL } from './constants.js';

/** RFC 9457 problem details body (Architecture.md §5). */
export type ProblemDetails = {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance?: string;
  requestId?: string;
  errors?: readonly ValidationIssue[];
};

export type ValidationIssue = {
  path: string;
  message: string;
};

type AppErrorOptions = {
  cause?: unknown;
};

/**
 * Base class for every expected error. Each subclass maps to one HTTP status
 * and one problem+json `type` (rules.md §5).
 */
export abstract class AppError extends Error {
  abstract readonly status: number;
  abstract readonly code: string;
  abstract readonly title: string;

  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
  }

  get type(): string {
    return `${PROBLEM_TYPE_BASE_URL}/${this.code}`;
  }

  toProblem(context: { instance?: string; requestId?: string } = {}): ProblemDetails {
    return {
      type: this.type,
      title: this.title,
      status: this.status,
      detail: this.message,
      ...context,
    };
  }
}

export class ValidationError extends AppError {
  readonly status = 400;
  readonly code = 'validation';
  readonly title = 'Bad Request';

  constructor(
    message: string,
    readonly issues: readonly ValidationIssue[] = [],
    options: AppErrorOptions = {},
  ) {
    super(message, options);
  }

  override toProblem(context: { instance?: string; requestId?: string } = {}): ProblemDetails {
    return { ...super.toProblem(context), errors: this.issues };
  }
}

export class UnauthorizedError extends AppError {
  readonly status = 401;
  readonly code = 'unauthorized';
  readonly title = 'Unauthorized';
}

export class ForbiddenError extends AppError {
  readonly status = 403;
  readonly code = 'forbidden';
  readonly title = 'Forbidden';
}

export class NotFoundError extends AppError {
  readonly status = 404;
  readonly code = 'not-found';
  readonly title = 'Not Found';
}

export class ConflictError extends AppError {
  readonly status = 409;
  readonly code = 'conflict';
  readonly title = 'Conflict';
}

export class RateLimitedError extends AppError {
  readonly status = 429;
  readonly code = 'rate-limited';
  readonly title = 'Too Many Requests';

  constructor(
    message: string,
    readonly retryAfterSeconds?: number,
    options: AppErrorOptions = {},
  ) {
    super(message, options);
  }
}

/** The org's monthly token budget is used up (PRD F9). */
export class BudgetExceededError extends AppError {
  readonly status = 429;
  readonly code = 'budget-exceeded';
  readonly title = 'Token Budget Exceeded';
}

/** A dependency we call (GitHub, an LLM provider) failed. */
export class UpstreamError extends AppError {
  readonly status = 502;
  readonly code = 'upstream';
  readonly title = 'Bad Gateway';

  constructor(
    message: string,
    readonly upstream: string,
    options: AppErrorOptions = {},
  ) {
    super(message, options);
  }
}

/** A feature the server is not configured for (e.g. API auth or the GitHub App is unset). */
export class ServiceUnavailableError extends AppError {
  readonly status = 503;
  readonly code = 'unavailable';
  readonly title = 'Service Unavailable';
}

/** Wraps a failed Zod parse as a 400 with one issue per invalid field. */
export function validationErrorFromZod(message: string, error: z.ZodError): ValidationError {
  const issues = error.issues.map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
  return new ValidationError(message, issues, { cause: error });
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
