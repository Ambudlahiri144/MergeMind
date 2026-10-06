import 'server-only';

import { notFound, redirect } from 'next/navigation';
import type { z } from 'zod';

import { ApiError, apiRequest, type Problem } from './api';
import type { Viewer } from './session';

export type Loaded<T> = { ok: true; data: T } | { ok: false; problem: Problem };

/**
 * Fetches for a page. 401 sends the user to sign-in and 404 renders the not-found page; any
 * other problem is returned so the page can show it inline (Design.md §3 error state) instead
 * of losing its details to the production error boundary.
 */
export async function load<Schema extends z.ZodType>(
  viewer: Viewer,
  path: string,
  schema: Schema,
  options: { notFoundOn404?: boolean } = {},
): Promise<Loaded<z.infer<Schema>>> {
  try {
    return { ok: true, data: await apiRequest(viewer, path, schema) };
  } catch (error) {
    if (!(error instanceof ApiError)) {
      throw error;
    }
    if (error.problem.status === 401) {
      redirect('/signin');
    }
    if (error.problem.status === 404 && options.notFoundOn404 !== false) {
      notFound();
    }
    return { ok: false, problem: error.problem };
  }
}
