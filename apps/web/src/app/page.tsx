import { GitPullRequestIcon as GitPullRequest } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';

import { buttonVariants } from '@/components/ui/button';
import { installUrl } from '@/lib/env';

/** Minimal front page; the full landing page arrives in Phase 7 with real screenshots. */
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-5xl flex-col justify-center gap-6 px-4 py-16">
      <GitPullRequest size={40} weight="bold" className="text-accent" aria-hidden="true" />
      <h1 className="max-w-[20ch] text-4xl leading-[1.1] font-semibold tracking-[-0.02em] md:text-5xl">
        Code review that never sleeps.
      </h1>
      <p className="max-w-[65ch] text-base leading-[26px] text-text-muted">
        MergeMind reviews every pull request for security, correctness and maintainability, and
        explains failed CI runs.
      </p>
      <div className="flex flex-wrap gap-3">
        <a href={installUrl()} className={buttonVariants({ variant: 'primary', size: 'touch' })}>
          Install on GitHub
        </a>
        <Link href="/signin" className={buttonVariants({ variant: 'secondary', size: 'touch' })}>
          Sign in
        </Link>
      </div>
    </main>
  );
}
