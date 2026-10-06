import type { CiSummaryJobData, WorkflowRunEvent } from '@mergemind/shared';

import type { CiSummaryProducer } from '../../queues/ci-summary.producer.js';
import type { HandlerResult } from './handler-result.js';

/** Conclusions summarised as failures; a timeout is a failure to the PR author (ADR-028). */
const FAILED_CONCLUSIONS: ReadonlySet<string> = new Set(['failure', 'timed_out']);

const MAX_LINKED_PRS = 20;

export type CiSummaryDecision =
  { kind: 'enqueue'; data: CiSummaryJobData } | { kind: 'ignore'; reason: string };

/**
 * Pure decision for a `workflow_run.completed` event (PRD F10):
 * - a failure linked to a PR, or from a fork (GitHub links no PR then; the worker looks it up
 *   by SHA), is summarised;
 * - a success linked to a PR only marks an earlier summary as passing (no LLM call);
 * - everything else (cancelled, skipped, push runs without a PR) is ignored.
 */
export function decideCiSummary(event: WorkflowRunEvent): CiSummaryDecision {
  const run = event.workflow_run;
  const prNumbers = [...new Set((run.pull_requests ?? []).map((pr) => pr.number))];
  const conclusion = run.conclusion ?? 'none';
  const isFork = run.head_repository != null && run.head_repository.id !== event.repository.id;

  let outcome: CiSummaryJobData['outcome'];
  if (FAILED_CONCLUSIONS.has(conclusion)) {
    if (prNumbers.length === 0 && !isFork) {
      return { kind: 'ignore', reason: 'no_linked_pr' };
    }
    outcome = 'failed';
  } else if (conclusion === 'success') {
    if (prNumbers.length === 0) {
      return { kind: 'ignore', reason: 'no_linked_pr' };
    }
    outcome = 'passed';
  } else {
    return { kind: 'ignore', reason: `conclusion_${conclusion}` };
  }

  return {
    kind: 'enqueue',
    data: {
      githubInstallationId: event.installation.id,
      githubRepoId: event.repository.id,
      repoFullName: event.repository.full_name,
      isPrivate: event.repository.private,
      workflowRunId: run.id,
      workflowId: run.workflow_id,
      workflowName: run.name ?? 'workflow',
      runNumber: run.run_number,
      runAttempt: run.run_attempt,
      headSha: run.head_sha,
      headBranch: run.head_branch ?? null,
      htmlUrl: run.html_url,
      outcome,
      prNumbers: prNumbers.slice(0, MAX_LINKED_PRS),
    },
  };
}

export async function handleWorkflowRun(
  event: WorkflowRunEvent,
  deps: { ciSummaryProducer: CiSummaryProducer },
): Promise<HandlerResult> {
  const decision = decideCiSummary(event);
  if (decision.kind === 'ignore') {
    return { status: 'ignored', reason: decision.reason };
  }
  const jobId = await deps.ciSummaryProducer.enqueue(decision.data);
  return { status: 'enqueued', reason: 'ci_summary_enqueued', jobId };
}
