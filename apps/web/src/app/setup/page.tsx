import {
  CheckCircleIcon as CheckCircle,
  HourglassMediumIcon as HourglassMedium,
} from '@phosphor-icons/react/dist/ssr';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { getViewer } from '@/lib/session';

export const metadata: Metadata = { title: 'Installed' };

/**
 * The GitHub App's Setup URL (Deploy.md): GitHub sends people here after they install or
 * update the App, with `setup_action` (`install`, `update` or `request`) and `installation_id`.
 * Both are user-controlled, so they only pick the message; access always comes from GitHub
 * through the api (ADR-030). New installations show up once their webhook has been processed.
 */
export default async function SetupPage(props: PageProps<'/setup'>) {
  const params = await props.searchParams;
  const isRequest = params.setup_action === 'request';
  if (!isRequest && (await getViewer())) {
    redirect('/repos');
  }
  const Icon = isRequest ? HourglassMedium : CheckCircle;

  return (
    <main className="grid min-h-[100dvh] place-items-center px-4 py-10">
      <div className="w-full max-w-sm rounded-base border-2 border-border bg-surface p-8 shadow-hard-lg">
        <span
          className={cn(
            'grid size-12 place-items-center rounded-base border-2 border-border text-on-fill shadow-hard-sm',
            isRequest ? 'bg-main' : 'bg-pass-bg',
          )}
        >
          <Icon size={28} weight="bold" aria-hidden="true" />
        </span>
        <h1 className="mt-4 text-2xl leading-8 font-bold tracking-[-0.01em]">
          {isRequest ? 'Installation requested' : 'MergeMind is installed'}
        </h1>
        <p className="mt-2 text-text-muted">
          {isRequest
            ? 'An owner of the account has to approve the request on GitHub. MergeMind starts reviewing once they do.'
            : 'It reviews the next pull request on the repositories you chose. Sign in to see them and follow each review.'}
        </p>
        <div className="mt-6 flex flex-col gap-3">
          {isRequest ? (
            <Link href="/" className={buttonVariants({ variant: 'secondary', size: 'touch' })}>
              Back to the home page
            </Link>
          ) : (
            <Link
              href="/signin?next=%2Frepos"
              className={buttonVariants({ variant: 'primary', size: 'touch' })}
            >
              Sign in to MergeMind
            </Link>
          )}
        </div>
      </div>
    </main>
  );
}
