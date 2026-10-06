import {
  RunDetailSchema,
  SEVERITIES,
  SnippetResponseSchema,
  type FindingItem,
} from '@mergemind/shared';
import { CheckCircleIcon as CheckCircle } from '@phosphor-icons/react/dist/ssr';
import type { Metadata } from 'next';
import Link from 'next/link';

import { rerunReview } from '@/app/actions/mutations';
import { ActionForm } from '@/components/action-form';
import { DiffSnippet } from '@/components/diff-snippet';
import { ErrorPanel } from '@/components/error-panel';
import { FindingCard } from '@/components/finding-card';
import { CountsText } from '@/components/run-timeline';
import { GateResult } from '@/components/ui/severity';
import { EmptyState, PageHeader } from '@/components/ui/states';
import { duration, modeLabel, shortSha, timeAgo, triggerLabel } from '@/lib/format';
import { load } from '@/lib/load';
import { requireViewer } from '@/lib/session';

export const metadata: Metadata = { title: 'Review run' };

const GROUP_LABEL = { critical: 'Critical', major: 'Major', minor: 'Minor' } as const;

export default async function RunPage(props: PageProps<'/runs/[runId]'>) {
  const { runId } = await props.params;
  const search = await props.searchParams;
  const viewer = await requireViewer();
  const run = await load(viewer, `/runs/${runId}`, RunDetailSchema);
  if (!run.ok) {
    return <ErrorPanel problem={run.problem} />;
  }
  const { data } = run;
  const selectedId = typeof search.finding === 'string' ? search.finding : undefined;
  const selected: FindingItem | undefined =
    data.findings.find((finding) => finding.id === selectedId) ?? data.findings[0];
  const snippet = selected
    ? await load(viewer, `/findings/${selected.id}/snippet`, SnippetResponseSchema, {
        notFoundOn404: false,
      })
    : null;
  const status =
    data.status === 'completed' ? 'Completed' : data.status === 'failed' ? 'Failed' : 'Running';

  return (
    <>
      <p className="pb-2 text-xs text-text-muted">
        <Link href={`/repos/${data.repository.id}`} className="hover:text-accent">
          {data.repository.fullName}
        </Link>
        {' / '}
        <Link
          href={`/repos/${data.repository.id}/pulls/${String(data.pullRequest.number)}`}
          className="hover:text-accent"
        >
          #{data.pullRequest.number} {data.pullRequest.title}
        </Link>
      </p>
      <PageHeader
        title={`Review of ${shortSha(data.headSha)}${data.attempt > 1 ? `, attempt ${String(data.attempt)}` : ''}`}
        meta={
          <>
            {triggerLabel(data.trigger)} · {modeLabel(data.mode)} ·{' '}
            <time dateTime={data.createdAt}>{timeAgo(data.createdAt)}</time>
            {data.durationMs > 0 ? ` · ${duration(data.durationMs)}` : ''}
          </>
        }
        actions={
          data.canRerun ? (
            <ActionForm
              action={rerunReview}
              fields={{ runId: data.id }}
              label="Review again"
              pendingLabel="Queuing"
            />
          ) : null
        }
      />
      <div className="mb-6 flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
        <p aria-live="polite" className="sr-only">
          Run status: {status}
        </p>
        <GateResult conclusion={data.gateConclusion} counts={data.counts} />
        <p className="text-text-muted">
          <CountsText counts={data.counts} />
          {data.counts.resolved > 0
            ? ` · ${String(data.counts.resolved)} resolved by this push`
            : ''}
          {data.filteredCount > 0
            ? ` · ${String(data.filteredCount)} below the confidence bar, not shown`
            : ''}
        </p>
        {data.policyErrors.length > 0 ? (
          <p className="text-sev-critical">
            Invalid .mergemind.yml, defaults applied: {data.policyErrors.join('; ')}
          </p>
        ) : null}
        {data.failedPasses.length > 0 ? (
          <p className="text-sev-major">
            Passes that could not finish: {data.failedPasses.join(', ')}
          </p>
        ) : null}
      </div>
      {data.findings.length === 0 ? (
        <EmptyState icon={CheckCircle} message="This run reported no findings." />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div className="flex flex-col gap-6">
            {SEVERITIES.map((severity) => {
              const group = data.findings.filter((finding) => finding.severity === severity);
              if (group.length === 0) {
                return null;
              }
              return (
                <section key={severity} aria-labelledby={`group-${severity}`}>
                  <h2 id={`group-${severity}`} className="pb-3 text-lg leading-7 font-semibold">
                    {GROUP_LABEL[severity]}{' '}
                    <span className="font-normal text-text-muted">{group.length}</span>
                  </h2>
                  <div className="flex flex-col gap-3">
                    {group.map((finding) => (
                      <FindingCard
                        key={finding.id}
                        finding={finding}
                        href={`/runs/${data.id}?finding=${finding.id}`}
                        isSelected={finding.id === selected?.id}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
          <aside aria-label="Code" className="lg:sticky lg:top-20 lg:self-start">
            {selected && snippet ? (
              snippet.ok ? (
                <DiffSnippet snippet={snippet.data} severity={selected.severity} />
              ) : (
                <ErrorPanel problem={snippet.problem} />
              )
            ) : null}
          </aside>
        </div>
      )}
    </>
  );
}
