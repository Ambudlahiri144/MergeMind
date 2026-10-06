import { CiSummaryJobDataSchema, WorkflowRunEventSchema } from '@mergemind/shared';
import { loadGithubFixture } from '@mergemind/shared/testing';
import { describe, expect, it } from 'vitest';

import { decideCiSummary } from './workflow-run.handler.js';

async function loadEvent(name: string, conclusion?: string | null) {
  const { payload } = await loadGithubFixture(name);
  const event = WorkflowRunEventSchema.parse(payload);
  return conclusion === undefined
    ? event
    : { ...event, workflow_run: { ...event.workflow_run, conclusion } };
}

describe('decideCiSummary', () => {
  it('summarises a failed run linked to a PR as valid ci-summary.run job data', async () => {
    const event = await loadEvent('workflow_run.completed-failure');

    const decision = decideCiSummary(event);

    expect(decision.kind).toBe('enqueue');
    expect(decision.kind === 'enqueue' && CiSummaryJobDataSchema.parse(decision.data)).toEqual({
      githubInstallationId: 55500001,
      githubRepoId: 77700001,
      repoFullName: 'octo-demo/payments-api',
      isPrivate: true,
      workflowRunId: 8800000001,
      workflowId: 66600001,
      workflowName: 'CI',
      runNumber: 57,
      runAttempt: 1,
      headSha: 'c3d4e5f60718293a4b5c6d7e8f9012345678901a',
      headBranch: 'fix-refunds',
      htmlUrl: 'https://github.com/octo-demo/payments-api/actions/runs/8800000001',
      outcome: 'failed',
      prNumbers: [42],
    });
  });

  it('treats a timeout as a failure', async () => {
    const decision = decideCiSummary(
      await loadEvent('workflow_run.completed-failure', 'timed_out'),
    );

    expect(decision).toMatchObject({ kind: 'enqueue', data: { outcome: 'failed' } });
  });

  it('summarises a fork failure without linked PRs (the worker looks the PR up)', async () => {
    const decision = decideCiSummary(await loadEvent('workflow_run.completed-fork'));

    expect(decision).toMatchObject({ kind: 'enqueue', data: { outcome: 'failed', prNumbers: [] } });
  });

  it('marks a success linked to a PR as passed', async () => {
    const decision = decideCiSummary(await loadEvent('workflow_run.completed-success'));

    expect(decision).toMatchObject({ kind: 'enqueue', data: { outcome: 'passed' } });
  });

  it('ignores a same-repo failure with no linked PR (a push to a branch)', async () => {
    const event = await loadEvent('workflow_run.completed-failure');
    const pushRun = { ...event, workflow_run: { ...event.workflow_run, pull_requests: [] } };

    expect(decideCiSummary(pushRun)).toEqual({ kind: 'ignore', reason: 'no_linked_pr' });
  });

  it('ignores a fork success, which has nothing to mark as passing', async () => {
    const decision = decideCiSummary(await loadEvent('workflow_run.completed-fork', 'success'));

    expect(decision).toEqual({ kind: 'ignore', reason: 'no_linked_pr' });
  });

  it.each([
    ['cancelled', 'conclusion_cancelled'],
    ['skipped', 'conclusion_skipped'],
    [null, 'conclusion_none'],
  ])('ignores conclusion %s', async (conclusion, reason) => {
    const decision = decideCiSummary(await loadEvent('workflow_run.completed-failure', conclusion));

    expect(decision).toEqual({ kind: 'ignore', reason });
  });
});
