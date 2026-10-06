import {
  MeResponseSchema,
  RepositoryPageSchema,
  type MeResponse,
  type RepositoryItem,
} from '@mergemind/shared';
import {
  FolderSimpleDashedIcon as FolderSimpleDashed,
  LockIcon as Lock,
} from '@phosphor-icons/react/dist/ssr';
import type { Metadata } from 'next';
import Link from 'next/link';

import { reindexRepository, toggleRepository } from '@/app/actions/mutations';
import { ActionForm } from '@/components/action-form';
import { ErrorPanel } from '@/components/error-panel';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState, PageHeader } from '@/components/ui/states';
import { installUrl } from '@/lib/env';
import { timeAgo } from '@/lib/format';
import { load } from '@/lib/load';
import { requireViewer } from '@/lib/session';

export const metadata: Metadata = { title: 'Repositories' };

const INDEX_LABEL: Record<RepositoryItem['indexStatus'], string> = {
  none: 'Not indexed',
  indexing: 'Indexing',
  ready: 'Indexed',
  failed: 'Index failed',
};

type Installation = MeResponse['installations'][number];

function RepositoryRow({ repo, canAdmin }: { repo: RepositoryItem; canAdmin: boolean }) {
  return (
    <li className="grid gap-3 px-4 py-4 md:grid-cols-[minmax(0,1fr)_9rem_6rem_7rem_minmax(0,13rem)] md:items-center md:gap-4">
      <div className="min-w-0">
        <Link href={`/repos/${repo.id}`} className="font-medium hover:text-accent">
          <span className="truncate">{repo.fullName}</span>
        </Link>
        <p className="mt-0.5 flex items-center gap-2 text-xs text-text-muted">
          {repo.isPrivate ? (
            <span className="inline-flex items-center gap-1">
              <Lock size={12} aria-hidden="true" /> Private
            </span>
          ) : (
            'Public'
          )}
          {repo.isEnabled ? null : <span>· Reviews off</span>}
        </p>
      </div>
      <p className="text-text-muted">
        <span className="md:hidden">Last review: </span>
        {repo.lastReviewAt ? (
          <time dateTime={repo.lastReviewAt}>{timeAgo(repo.lastReviewAt)}</time>
        ) : (
          'Never'
        )}
      </p>
      <p>
        <span className="font-mono text-[13px]">{repo.openPullRequests}</span>
        <span className="text-text-muted"> open</span>
      </p>
      <p className="text-text-muted">{INDEX_LABEL[repo.indexStatus]}</p>
      <div className="flex flex-wrap gap-2 md:justify-end">
        {canAdmin ? (
          <ActionForm
            action={toggleRepository}
            fields={{ repositoryId: repo.id, isEnabled: String(!repo.isEnabled) }}
            label={repo.isEnabled ? 'Turn off' : 'Turn on'}
            pendingLabel="Saving"
            variant="ghost"
          />
        ) : null}
        {repo.isEnabled ? (
          <ActionForm
            action={reindexRepository}
            fields={{ repositoryId: repo.id }}
            label="Reindex"
            pendingLabel="Queuing"
            variant="ghost"
          />
        ) : null}
      </div>
    </li>
  );
}

function InstallationSection({
  installation,
  repos,
}: {
  installation: Installation;
  repos: RepositoryItem[];
}) {
  const canAdmin = installation.role !== 'member';
  return (
    <section aria-labelledby={`inst-${installation.id}`} className="py-4">
      <h2 id={`inst-${installation.id}`} className="pb-3 text-lg leading-7 font-semibold">
        {installation.accountLogin}
        <span className="ml-2 text-sm font-normal text-text-muted">
          {installation.accountType === 'User' ? 'Personal account' : 'Organization'} ·{' '}
          {installation.role}
        </span>
      </h2>
      {repos.length === 0 ? (
        <EmptyState
          icon={FolderSimpleDashed}
          message="No repositories in this installation yet. Add some in the App's GitHub settings."
        />
      ) : (
        <div className="rounded-lg border border-border bg-surface">
          <div className="hidden border-b border-border px-4 py-2 text-xs font-medium text-text-muted md:grid md:grid-cols-[minmax(0,1fr)_9rem_6rem_7rem_minmax(0,13rem)] md:gap-4">
            <span>Repository</span>
            <span>Last review</span>
            <span>Pull requests</span>
            <span>Code index</span>
            <span className="text-right">Actions</span>
          </div>
          <ul className="divide-y divide-border">
            {repos.map((repo) => (
              <RepositoryRow key={repo.id} repo={repo} canAdmin={canAdmin} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export default async function RepositoriesPage() {
  const viewer = await requireViewer();
  const me = await load(viewer, '/me', MeResponseSchema);
  if (!me.ok) {
    return (
      <>
        <PageHeader title="Repositories" />
        <ErrorPanel problem={me.problem} />
      </>
    );
  }
  const sections = await Promise.all(
    me.data.installations.map(async (installation) => ({
      installation,
      repos: await load(
        viewer,
        `/installations/${installation.id}/repositories?limit=100`,
        RepositoryPageSchema,
      ),
    })),
  );

  return (
    <>
      <PageHeader
        title="Repositories"
        meta="Repositories MergeMind reviews, across the installations you can access."
      />
      {sections.length === 0 ? (
        <EmptyState
          icon={FolderSimpleDashed}
          message="MergeMind is not installed on any account you can access yet."
          action={
            <a href={installUrl()} className={buttonVariants({ variant: 'primary' })}>
              Install on GitHub
            </a>
          }
        />
      ) : (
        sections.map(({ installation, repos }) =>
          repos.ok ? (
            <InstallationSection
              key={installation.id}
              installation={installation}
              repos={repos.data.data}
            />
          ) : (
            <ErrorPanel key={installation.id} problem={repos.problem} />
          ),
        )
      )}
    </>
  );
}
