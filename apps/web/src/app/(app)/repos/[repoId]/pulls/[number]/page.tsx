import { PullRequestDetailSchema } from '@mergemind/shared';
import {
  ArrowSquareOutIcon as ArrowSquareOut,
  ClockCounterClockwiseIcon as ClockCounterClockwise,
} from '@phosphor-icons/react/dist/ssr';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { rerunReview } from '@/app/actions/mutations';
import { ActionForm } from '@/components/action-form';
import { ErrorPanel } from '@/components/error-panel';
import { RunTimeline } from '@/components/run-timeline';
import { buttonVariants } from '@/components/ui/button';
import { GateResult } from '@/components/ui/severity';
import { EmptyState, PageHeader } from '@/components/ui/states';
import { shortSha } from '@/lib/format';
import { load } from '@/lib/load';
import { requireViewer } from '@/lib/session';

export const metadata: Metadata = { title: 'Pull request' };

export default async function PullRequestPage(props: PageProps<'/repos/[repoId]/pulls/[number]'>) {
  const { repoId, number } = await props.params;
  if (!/^\d+$/.test(number)) {
    notFound();
  }
  const viewer = await requireViewer();
  const pr = await load(viewer, `/repositories/${repoId}/pulls/${number}`, PullRequestDetailSchema);
  if (!pr.ok) {
    return <ErrorPanel problem={pr.problem} />;
  }
  const { data } = pr;
  const latest = data.runs[0];
  const canRerun = latest !== undefined && data.state === 'open' && latest.headSha === data.headSha;

  return (
    <>
      <p className="pb-2 text-xs text-text-muted">
        <Link href={`/repos/${repoId}`} className="underline-offset-2 hover:underline decoration-2">
          {data.repository.fullName}
        </Link>
      </p>
      <PageHeader
        title={`#${String(data.number)} ${data.title}`}
        meta={
          <>
            {data.authorLogin} wants to merge {data.headRef} into {data.baseRef} ·{' '}
            <span className="font-mono text-[13px]">{shortSha(data.headSha)}</span> · {data.state}
          </>
        }
        actions={
          <a
            href={data.htmlUrl}
            className={buttonVariants({ variant: 'secondary', size: 'touch' })}
          >
            View on GitHub <ArrowSquareOut size={16} weight="bold" aria-hidden="true" />
          </a>
        }
      />
      <div className="flex flex-col gap-6">
        {latest ? (
          <div className="flex flex-col gap-3 rounded-base border-2 border-border bg-surface shadow-hard p-4 md:flex-row md:items-start md:justify-between">
            <GateResult conclusion={latest.gateConclusion} counts={latest.counts} />
            {canRerun ? (
              <ActionForm
                action={rerunReview}
                fields={{ runId: latest.id }}
                label="Review again"
                pendingLabel="Queuing"
              />
            ) : null}
          </div>
        ) : null}
        <section aria-labelledby="runs-heading">
          <h2 id="runs-heading" className="pb-3 text-lg leading-7 font-bold">
            Review runs
          </h2>
          {data.runs.length === 0 ? (
            <EmptyState
              icon={ClockCounterClockwise}
              message="MergeMind has not reviewed this pull request yet."
            />
          ) : (
            <RunTimeline runs={data.runs} />
          )}
        </section>
      </div>
    </>
  );
}
