import { UnauthorizedError, validationErrorFromZod } from '@mergemind/shared';
import type { Request, RequestHandler } from 'express';
import type { z } from 'zod';

import type { AuthUser } from '../auth/api-token.js';

type Schemas = { params?: z.ZodType; query?: z.ZodType; body?: z.ZodType };

type Parsed<S extends z.ZodType | undefined> = S extends z.ZodType ? z.infer<S> : undefined;

export type HandlerInput<S extends Schemas> = {
  params: Parsed<S['params']>;
  query: Parsed<S['query']>;
  body: Parsed<S['body']>;
  user: AuthUser;
  req: Request;
};

export type Reply = { status: number; body?: unknown };

function parsePart(schema: z.ZodType | undefined, value: unknown, part: string): unknown {
  if (schema === undefined) {
    return undefined;
  }
  const result = schema.safeParse(value);
  if (!result.success) {
    throw validationErrorFromZod(`Invalid request ${part}`, result.error);
  }
  return result.data;
}

/**
 * `validate(schemas, handler)`: params, query and body are parsed with Zod schemas from
 * `@mergemind/shared` before the controller runs (rules.md §3), and a 400 problem+json names
 * every invalid field. Express 5 makes `req.query` read-only, so parsed values are passed in.
 */
export function validate<S extends Schemas>(
  schemas: S,
  handler: (input: HandlerInput<S>) => Promise<Reply>,
): RequestHandler {
  return async (req, res) => {
    if (!req.user) {
      throw new UnauthorizedError('A valid bearer token is required');
    }
    const input = {
      params: parsePart(schemas.params, req.params, 'params'),
      query: parsePart(schemas.query, req.query, 'query'),
      body: parsePart(schemas.body, req.body, 'body'),
      user: req.user,
      req,
    } as HandlerInput<S>;
    const reply = await handler(input);
    if (reply.body === undefined) {
      res.status(reply.status).end();
      return;
    }
    res.status(reply.status).json(reply.body);
  };
}
