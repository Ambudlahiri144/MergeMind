'use server';

import {
  AcceptedResponseSchema,
  FindingStateResponseSchema,
  MAX_DISMISS_REASON_LENGTH,
  ObjectIdSchema,
  RepositoryItemSchema,
} from '@mergemind/shared';
import { refresh } from 'next/cache';
import { z } from 'zod';

import { ApiError, apiRequest } from '@/lib/api';
import { requireViewer } from '@/lib/session';

/** What an action reports back to its form (shown in a polite live region, like a toast). */
export type ActionResult = { status: 'idle' | 'ok' | 'error'; message: string };

const IdField = ObjectIdSchema;

/** A text form field ('' when missing or a file). */
function textField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

async function run(work: () => Promise<string>): Promise<ActionResult> {
  try {
    const message = await work();
    refresh();
    return { status: 'ok', message };
  } catch (error) {
    if (error instanceof ApiError) {
      return { status: 'error', message: error.problem.detail };
    }
    if (error instanceof z.ZodError) {
      return {
        status: 'error',
        message: 'That request was not valid. Reload the page and try again.',
      };
    }
    throw error;
  }
}

export async function toggleRepository(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  return run(async () => {
    const viewer = await requireViewer();
    const repositoryId = IdField.parse(formData.get('repositoryId'));
    const isEnabled = formData.get('isEnabled') === 'true';
    await apiRequest(viewer, `/repositories/${repositoryId}`, RepositoryItemSchema, {
      method: 'PATCH',
      body: { isEnabled },
    });
    return isEnabled ? 'Reviews turned on.' : 'Reviews turned off.';
  });
}

export async function reindexRepository(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  return run(async () => {
    const viewer = await requireViewer();
    const repositoryId = IdField.parse(formData.get('repositoryId'));
    await apiRequest(viewer, `/repositories/${repositoryId}/reindex`, AcceptedResponseSchema, {
      method: 'POST',
    });
    return 'Reindex queued. The code index refreshes in the background.';
  });
}

export async function rerunReview(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  return run(async () => {
    const viewer = await requireViewer();
    const runId = IdField.parse(formData.get('runId'));
    await apiRequest(viewer, `/runs/${runId}/rerun`, AcceptedResponseSchema, { method: 'POST' });
    return 'Review queued. A new run appears here within a minute.';
  });
}

export async function dismissFinding(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  return run(async () => {
    const viewer = await requireViewer();
    const findingId = IdField.parse(formData.get('findingId'));
    const reason = z
      .string()
      .trim()
      .max(MAX_DISMISS_REASON_LENGTH)
      .parse(formData.get('reason') ?? '');
    await apiRequest(viewer, `/findings/${findingId}`, FindingStateResponseSchema, {
      method: 'PATCH',
      body: { state: 'dismissed', ...(reason === '' ? {} : { reason }) },
    });
    return 'Finding dismissed. MergeMind will not report it again in this repository.';
  });
}

export async function updateBudget(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  return run(async () => {
    const viewer = await requireViewer();
    const installationId = IdField.parse(formData.get('installationId'));
    const monthlyTokenBudget = z.coerce
      .number()
      .int()
      .min(0)
      .parse(textField(formData, 'monthlyTokenBudget').replace(/[\s,_]/g, ''));
    await apiRequest(
      viewer,
      `/installations/${installationId}/budget`,
      z.object({ monthlyTokenBudget: z.number() }),
      { method: 'PUT', body: { monthlyTokenBudget } },
    );
    return 'Budget saved.';
  });
}
