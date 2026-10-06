import {
  ArrowSquareOutIcon as ArrowSquareOut,
  BugBeetleIcon as BugBeetle,
  GitPullRequestIcon as GitPullRequest,
  ListChecksIcon as ListChecks,
  ShieldWarningIcon as ShieldWarning,
  WrenchIcon as Wrench,
} from '@phosphor-icons/react/dist/ssr';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import Link from 'next/link';

import { ThemedShot } from '@/components/landing/themed-shot';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { installUrl } from '@/lib/env';
import { getViewer } from '@/lib/session';
import { THEME_COOKIE, parseTheme } from '@/lib/theme';
import { Z_INDEX } from '@/lib/z-index';

import findingDark from '../../public/screens/finding-dark.png';
import findingLight from '../../public/screens/finding-light.png';
import reviewDark from '../../public/screens/github-review-dark.png';
import reviewLight from '../../public/screens/github-review-light.png';
import heroDark from '../../public/screens/hero-dark.png';
import heroLight from '../../public/screens/hero-light.png';

// Design.md §5 landing (Taste-skill in full; UI/UX Pro Max "Hero + Features + CTA" pattern
// under Design.md's tokens). Dials: variance 3, motion 3, density 4. One accent, no eyebrows,
// one label per intent: "Install on GitHub" everywhere.

export const metadata: Metadata = {
  title: { absolute: 'MergeMind: AI code review for every pull request' },
  description:
    'MergeMind reviews every pull request for security, correctness and maintainability, and explains failed CI runs.',
};

const REPO_URL = 'https://github.com/Ambudlahiri144/MergeMind';
const SAMPLE_REVIEW_URL = 'https://github.com/Ambudlahiri144/dev_portfolio/pull/2';

const STEPS = [
  {
    icon: GitPullRequest,
    title: 'Open a PR',
    body: 'Every push triggers a review. Drafts wait until they are ready.',
  },
  {
    icon: ListChecks,
    title: 'Get findings',
    body: 'Three passes comment on the exact lines, and a check run gates the merge.',
  },
  {
    icon: ShieldWarning,
    title: 'Merge with confidence',
    body: 'Push a fix and MergeMind re-reviews only what changed, then resolves the thread.',
  },
] as const;

function Nav({ isSignedIn }: { isSignedIn: boolean }) {
  return (
    <header
      className="sticky top-0 border-b border-border bg-bg/90 backdrop-blur"
      style={{ zIndex: Z_INDEX.header }}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 md:px-6">
        <Link href="/" className="flex h-10 items-center gap-2 font-semibold">
          <GitPullRequest size={20} weight="bold" className="text-accent" aria-hidden="true" />
          MergeMind
        </Link>
        <nav aria-label="Sections" className="hidden md:block">
          <ul className="flex items-center gap-1 text-text-muted">
            <li>
              <a href="#how" className="flex h-10 items-center rounded-md px-3 hover:text-text">
                How it works
              </a>
            </li>
            <li>
              <a href="#checks" className="flex h-10 items-center rounded-md px-3 hover:text-text">
                What it checks
              </a>
            </li>
            <li>
              <a href={REPO_URL} className="flex h-10 items-center rounded-md px-3 hover:text-text">
                GitHub
              </a>
            </li>
          </ul>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <Link
            href={isSignedIn ? '/repos' : '/signin'}
            className={cn(
              buttonVariants({ variant: 'ghost', size: 'touch' }),
              'hidden sm:inline-flex',
            )}
          >
            {isSignedIn ? 'Open the app' : 'Sign in'}
          </Link>
          <a href={installUrl()} className={buttonVariants({ variant: 'primary', size: 'touch' })}>
            Install on GitHub
          </a>
        </div>
      </div>
    </header>
  );
}

export default async function LandingPage() {
  const [viewer, store] = await Promise.all([getViewer(), cookies()]);
  const theme = parseTheme(store.get(THEME_COOKIE)?.value);

  return (
    <>
      <a
        href="#main"
        className="sr-only rounded-md bg-surface px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
        style={{ zIndex: Z_INDEX.toast }}
      >
        Skip to content
      </a>
      <Nav isSignedIn={viewer !== null} />
      <main id="main" className="text-base leading-[26px]">
        {/* Hero: left-aligned split, copy left, real product screenshot right. */}
        <section className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)] gap-12 px-4 pt-16 pb-16 md:px-6 md:pt-24 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-center">
          <div>
            <h1 className="text-4xl leading-[1.1] font-semibold tracking-[-0.02em] md:text-5xl">
              Code review that never sleeps.
            </h1>
            <p className="mt-5 max-w-[46ch] text-text-muted">
              MergeMind reviews every pull request for security, correctness and maintainability,
              and explains failed CI runs in plain words.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a
                href={installUrl()}
                className={buttonVariants({ variant: 'primary', size: 'touch' })}
              >
                Install on GitHub
              </a>
              <a
                href={SAMPLE_REVIEW_URL}
                className={buttonVariants({ variant: 'secondary', size: 'touch' })}
              >
                See a sample review
              </a>
            </div>
          </div>
          <figure className="min-w-0">
            <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-pop">
              <ThemedShot
                theme={theme}
                light={heroLight}
                dark={heroDark}
                alt="MergeMind run page: a critical finding for a payment key committed in src/refunds.ts, with the flagged line highlighted in the code panel."
                sizes="(min-width: 1024px) 600px, 100vw"
                isPriority
              />
            </div>
            <figcaption className="mt-2 text-xs text-text-muted">
              The MergeMind app, with sample data.
            </figcaption>
          </figure>
        </section>

        {/* How a review runs: vertical stack, three verb-noun steps, one large real screenshot. */}
        <section id="how" className="border-t border-border py-16 md:py-24">
          <div className="mx-auto max-w-6xl px-4 md:px-6">
            <h2 className="text-2xl leading-8 font-semibold tracking-[-0.01em] md:text-3xl md:leading-10">
              How a review runs
            </h2>
            <ol className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-8 md:grid-cols-3">
              {STEPS.map(({ icon: Icon, title, body }) => (
                <li key={title} className="flex gap-3">
                  <Icon size={24} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
                  <div>
                    <h3 className="font-semibold">{title}</h3>
                    <p className="mt-1 text-text-muted">{body}</p>
                  </div>
                </li>
              ))}
            </ol>
            <figure className="mt-12">
              <div className="mx-auto max-w-3xl overflow-hidden rounded-lg border border-border bg-surface">
                <ThemedShot
                  theme={theme}
                  light={reviewLight}
                  dark={reviewDark}
                  alt="A MergeMind review on a GitHub pull request: one critical and two major findings, with an inline comment on a hardcoded API key and a suggested fix."
                  sizes="(min-width: 768px) 768px, 100vw"
                />
              </div>
              <figcaption className="mx-auto mt-2 max-w-3xl text-xs text-text-muted">
                MergeMind on a real pull request.{' '}
                <a href={SAMPLE_REVIEW_URL} className="text-accent underline underline-offset-2">
                  Open it on GitHub
                </a>
              </figcaption>
            </figure>
          </div>
        </section>

        {/* What it checks: bento with exactly four cells, two with real visual variation. */}
        <section id="checks" className="border-t border-border py-16 md:py-24">
          <div className="mx-auto max-w-6xl px-4 md:px-6">
            <h2 className="text-2xl leading-8 font-semibold tracking-[-0.01em] md:text-3xl md:leading-10">
              What it checks
            </h2>
            <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-6">
              <article className="flex flex-col gap-4 min-w-0 rounded-lg border border-border bg-surface p-6 md:col-span-4">
                <div>
                  <h3 className="flex items-center gap-2 font-semibold">
                    <ShieldWarning size={20} className="text-accent" aria-hidden="true" />
                    Security
                  </h3>
                  <p className="mt-1 max-w-[52ch] text-text-muted">
                    Injection, hardcoded secrets and unchecked input, flagged on the exact line with
                    a fix you can apply.
                  </p>
                </div>
                <div className="overflow-hidden rounded-lg border border-border">
                  <ThemedShot
                    theme={theme}
                    light={findingLight}
                    dark={findingDark}
                    alt="A critical security finding card: live payment key committed in source, with a suggested fix that reads the key from the environment."
                    sizes="(min-width: 768px) 600px, 100vw"
                  />
                </div>
              </article>
              <article className="min-w-0 rounded-lg border border-border bg-accent-subtle p-6 md:col-span-2">
                <h3 className="flex items-center gap-2 font-semibold">
                  <BugBeetle size={20} className="text-accent" aria-hidden="true" />
                  Correctness
                </h3>
                <p className="mt-1 text-text-muted">
                  Missing awaits, null dereferences, off-by-one errors and races, judged against the
                  code your change calls.
                </p>
              </article>
              <article className="min-w-0 rounded-lg border border-border bg-surface p-6 md:col-span-2">
                <h3 className="flex items-center gap-2 font-semibold">
                  <Wrench size={20} className="text-accent" aria-hidden="true" />
                  Maintainability
                </h3>
                <p className="mt-1 text-text-muted">
                  Swallowed errors, unbounded queries and leaks. Small nits go in the summary, not
                  in your diff.
                </p>
              </article>
              <article className="flex flex-col gap-4 min-w-0 rounded-lg border border-border bg-surface-muted p-6 md:col-span-4">
                <div>
                  <h3 className="flex items-center gap-2 font-semibold">
                    <ListChecks size={20} className="text-accent" aria-hidden="true" />
                    CI failures
                  </h3>
                  <p className="mt-1 max-w-[52ch] text-text-muted">
                    When a GitHub Actions run fails, MergeMind reads the failed job's log and posts
                    one comment with the failing step, the likely cause and the lines that show it.
                  </p>
                </div>
                <pre
                  tabIndex={0}
                  className="overflow-x-auto rounded-md border border-border bg-surface p-4 font-mono text-[13px] leading-5"
                >
                  <code>{`Failing step: test / Run tests
Likely cause: the test runner cannot locate the tests
directory, resulting in a MODULE_NOT_FOUND error.
Evidence: line 146  # Error: Cannot find module '.../tests'`}</code>
                </pre>
                <p className="text-xs text-text-muted">From a real CI run on a test repository.</p>
              </article>
            </div>
          </div>
        </section>

        {/* Runs on free tiers: full-width code block. */}
        <section className="border-t border-border py-16 md:py-24">
          <div className="mx-auto max-w-6xl px-4 md:px-6">
            <h2 className="text-2xl leading-8 font-semibold tracking-[-0.01em] md:text-3xl md:leading-10">
              Runs on free tiers
            </h2>
            <p className="mt-3 max-w-[60ch] text-text-muted">
              Groq and Gemini free tiers review the code, Ollama embeds it on your machine, and
              MongoDB and Redis run in Docker.
            </p>
            <pre
              tabIndex={0}
              className="mt-8 overflow-x-auto rounded-lg border border-border bg-surface-muted p-5 font-mono text-[13px] leading-6"
            >
              <code>{`docker compose up -d
ollama pull nomic-embed-text
npm install
npm run dev`}</code>
            </pre>
          </div>
        </section>

        {/* Closing call to action (one label per intent). */}
        <section className="border-t border-border py-16 md:py-24">
          <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-4 md:flex-row md:items-center md:justify-between md:px-6">
            <h2 className="max-w-[24ch] text-2xl leading-8 font-semibold tracking-[-0.01em] md:text-3xl md:leading-10">
              Put a first-pass reviewer on every pull request.
            </h2>
            <a
              href={installUrl()}
              className={buttonVariants({ variant: 'primary', size: 'touch' })}
            >
              Install on GitHub
            </a>
          </div>
        </section>
      </main>
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-text-muted md:flex-row md:items-center md:justify-between md:px-6">
          <p className="flex items-center gap-2">
            <GitPullRequest size={16} weight="bold" className="text-accent" aria-hidden="true" />
            MergeMind
          </p>
          <ul className="flex flex-wrap gap-x-6 gap-y-2">
            {[
              ['Source on GitHub', REPO_URL],
              ['Architecture', `${REPO_URL}/blob/main/Architecture.md`],
              ['Product requirements', `${REPO_URL}/blob/main/PRD.md`],
              ['Testing', `${REPO_URL}/blob/main/Testing.md`],
            ].map(([label, href]) => (
              <li key={label}>
                <a href={href} className="inline-flex h-10 items-center gap-1 hover:text-text">
                  {label}
                  {label === 'Source on GitHub' ? (
                    <ArrowSquareOut size={14} aria-hidden="true" />
                  ) : null}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </footer>
    </>
  );
}
