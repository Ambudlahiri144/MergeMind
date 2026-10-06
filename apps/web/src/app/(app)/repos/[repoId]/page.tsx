import {
  PolicyResponseSchema,
  PullRequestPageSchema,
  RepositoryItemSchema,
  type PolicyResponse,
  type PullRequestItem,
} from '@mergemind/shared';
import {
  CheckCircleIcon as CheckCircle,
  GitPullRequestIcon as GitPullRequest,
  WarningCircleIcon as WarningCircle,
} from '@phosphor-icons/react/dist/ssr';
import type { Metadata } from 'next';
import Link from 'next/link';

import { ErrorPanel } from '@/components/error-panel';
import { CountsText } from '@/components/run-timeline';
import { EmptyState, PageHeader } from '@/components/ui/states';
import { cn } from '@/lib/cn';
import { shortSha, timeAgo } from '@/lib/format';
import { load } from '@/lib/load';
import { requireViewer } from '@/lib/session';

export const metadata: Metadata = { title: 'Repository' };

const STATES = [
  { value: 'open', label: 'Open' },
  { value: 'all', label: 'All' },
] as const;

function PullRow({ repoId, pr }: { repoId: string; pr: PullRequestItem }) {
  const run = pr.latestRun;
  return (
    <li>
      <Link
        href={`/repos/${repoId}/pulls/${String(pr.number)}`}
        className="grid grid-cols-[minmax(0,1fr)] gap-1 px-4 py-3 hover:bg-surface-muted md:grid-cols-[minmax(0,1fr)_minmax(0,14rem)_7rem] md:items-center md:gap-4"
      >
        <span className="min-w-0">
          <span className="font-bold">
            <span className="font-mono text-[13px] font-medium text-text-muted">#{pr.number}</span>{' '}
            {pr.title}
          </span>
          <span className="mt-0.5 block truncate text-xs text-text-muted">
            {pr.authorLogin} · {pr.headRef} · {pr.state}
            {pr.isDraft ? ' · draft' : ''}
          </span>
        </span>
        <span className="text-text-muted">
          {run ? (
            <>
              <span className="font-mono text-[13px]">{shortSha(run.headSha)}</span> ·{' '}
              <CountsText counts={run.counts} />
            </>
          ) : (
            'Not reviewed yet'
          )}
        </span>
        <span className="text-xs text-text-muted md:text-right">
          <time dateTime={pr.updatedAt}>{timeAgo(pr.updatedAt)}</time>
        </span>
      </Link>
    </li>
  );
}

function PolicyViewer({ policy }: { policy: PolicyResponse }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-text-muted">
        {policy.text === null
          ? `No .mergemind.yml on ${policy.ref}; the defaults apply.`
          : `.mergemind.yml on ${policy.ref}`}
      </p>
      {policy.text === null ? null : (
        <pre
          tabIndex={0}
          className="overflow-x-auto rounded-base border-2 border-border bg-surface-muted p-3 font-mono text-[13px] leading-5"
        >
          <code>{policy.text}</code>
        </pre>
      )}
      {policy.errors.length === 0 ? (
        <p className="inline-flex items-center gap-2 font-bold text-pass">
          <CheckCircle size={16} weight="bold" aria-hidden="true" />
          {policy.source === 'file' ? 'Valid' : 'Using defaults'}
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {policy.errors.map((error) => (
            <li key={error} className="flex items-start gap-2 text-sev-critical">
              <WarningCircle
                size={16}
                weight="bold"
                className="mt-0.5 shrink-0"
                aria-hidden="true"
              />
              {error}
            </li>
          ))}
        </ul>
      )}
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-text-muted">
        <dt>Passes</dt>
        <dd className="text-text">{policy.policy.review.passes.join(', ')}</dd>
        <dt>Gate fails on</dt>
        <dd className="text-text">{policy.policy.gate.failOn}</dd>
        <dt>Min confidence</dt>
        <dd className="font-mono text-[13px] text-text">{policy.policy.review.minConfidence}</dd>
        <dt>CI summaries</dt>
        <dd className="text-text">{policy.policy.ciSummary.enabled ? 'On' : 'Off'}</dd>
      </dl>
    </div>
  );
}

export default async function RepositoryPage(props: PageProps<'/repos/[repoId]'>) {
  const { repoId } = await props.params;
  const search = await props.searchParams;
  const state = search.state === 'all' ? 'all' : 'open';
  const viewer = await requireViewer();
  const [repo, pulls, policy] = await Promise.all([
    load(viewer, `/repositories/${repoId}`, RepositoryItemSchema),
    load(viewer, `/repositories/${repoId}/pulls?state=${state}&limit=50`, PullRequestPageSchema),
    load(viewer, `/repositories/${repoId}/policy`, PolicyResponseSchema, { notFoundOn404: false }),
  ]);
  if (!repo.ok) {
    return <ErrorPanel problem={repo.problem} />;
  }

  return (
    <>
      <PageHeader
        title={repo.data.fullName}
        meta={`${String(repo.data.openPullRequests)} open pull requests · reviews ${repo.data.isEnabled ? 'on' : 'off'}`}
      />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <section aria-labelledby="pulls-heading">
          <div className="flex items-center justify-between pb-3">
            <h2 id="pulls-heading" className="text-lg leading-7 font-bold">
              Pull requests
            </h2>
            <nav aria-label="Pull request state" className="flex gap-1">
              {STATES.map((option) => (
                <Link
                  key={option.value}
                  href={`/repos/${repoId}?state=${option.value}`}
                  aria-current={state === option.value ? 'page' : undefined}
                  className={cn(
                    'flex h-10 items-center rounded-base border-2 px-3 font-bold',
                    state === option.value
                      ? 'border-border bg-main text-on-fill shadow-hard-sm'
                      : 'border-transparent text-text-muted hover:border-border hover:bg-surface-muted',
                  )}
                >
                  {option.label}
                </Link>
              ))}
            </nav>
          </div>
          {!pulls.ok ? (
            <ErrorPanel problem={pulls.problem} />
          ) : pulls.data.data.length === 0 ? (
            <EmptyState
              icon={GitPullRequest}
              message="No pull requests reviewed yet. Open a PR on this repository."
            />
          ) : (
            <ul className="divide-y-2 divide-border rounded-base border-2 border-border bg-surface shadow-hard">
              {pulls.data.data.map((pr) => (
                <PullRow key={pr.id} repoId={repoId} pr={pr} />
              ))}
            </ul>
          )}
        </section>
        <section aria-labelledby="policy-heading">
          <h2 id="policy-heading" className="pb-3 text-lg leading-7 font-bold">
            Effective policy
          </h2>
          <div className="rounded-base border-2 border-border bg-surface shadow-hard p-4">
            {policy.ok ? (
              <PolicyViewer policy={policy.data} />
            ) : (
              <ErrorPanel problem={policy.problem} />
            )}
          </div>
        </section>
      </div>
    </>
  );
}
