import {
  GithubLogoIcon as GithubLogo,
  GitPullRequestIcon as GitPullRequest,
} from '@phosphor-icons/react/dist/ssr';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { signInWithGithub } from '@/app/actions/auth';
import { Button } from '@/components/ui/button';
import { getViewer } from '@/lib/session';

export const metadata: Metadata = { title: 'Sign in' };

const ERRORS: Record<string, string> = {
  github: 'GitHub sign-in could not start. Check the App client ID and secret, then try again.',
  email_not_found: 'GitHub did not share an email address. Try again, or contact the App owner.',
};

export default async function SignInPage(props: PageProps<'/signin'>) {
  const params = await props.searchParams;
  if (await getViewer()) {
    redirect('/repos');
  }
  const next = typeof params.next === 'string' ? params.next : '/repos';
  const error = typeof params.error === 'string' ? (ERRORS[params.error] ?? ERRORS.github) : null;

  return (
    <main className="grid min-h-[100dvh] place-items-center px-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-8">
        <GitPullRequest size={32} weight="bold" className="text-accent" aria-hidden="true" />
        <h1 className="mt-4 text-2xl leading-8 font-semibold tracking-[-0.01em]">
          Sign in to MergeMind
        </h1>
        <p className="mt-2 text-text-muted">
          Use the GitHub account that installed the MergeMind App.
        </p>
        {error ? (
          <p
            role="alert"
            className="mt-4 rounded-md bg-sev-critical-bg px-3 py-2 text-sev-critical"
          >
            {error}
          </p>
        ) : null}
        <form action={signInWithGithub} className="mt-6">
          <input type="hidden" name="next" value={next} />
          <Button type="submit" variant="primary" size="touch" className="w-full">
            <GithubLogo size={20} aria-hidden="true" />
            Continue with GitHub
          </Button>
        </form>
      </div>
    </main>
  );
}
