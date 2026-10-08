import {
  ArrowSquareOutIcon as ArrowSquareOut,
  BugBeetleIcon as BugBeetle,
  GitPullRequestIcon as GitPullRequest,
  ListIcon as List,
  ListChecksIcon as ListChecks,
  ShieldWarningIcon as ShieldWarning,
  WrenchIcon as Wrench,
} from '@phosphor-icons/react/dist/ssr';
import type { Icon } from '@phosphor-icons/react';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import Link from 'next/link';
import type { ReactNode } from 'react';

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

// Design.md §5 landing, the loud surface of the neo-brutalist system (ADR-036): flat colour
// bands, ink borders, hard shadows. Real screenshots only, no eyebrows, and one label per
// intent: "Install on GitHub" everywhere.

export const metadata: Metadata = {
  title: { absolute: 'MergeMind: AI code review for every pull request' },
  description:
    'MergeMind reviews every pull request for security, correctness and maintainability, and explains failed CI runs.',
};

const REPO_URL = 'https://github.com/Ambudlahiri144/MergeMind';
const SAMPLE_REVIEW_URL = 'https://github.com/Ambudlahiri144/dev_portfolio/pull/2';

const CONTAINER = 'mx-auto max-w-6xl px-4 md:px-6';
const SECTION_LINKS = [
  ['How it works', '#how'],
  ['What it checks', '#checks'],
  ['GitHub', REPO_URL],
] as const;
const SECTION_TITLE = 'text-4xl leading-[1.05] font-bold tracking-[-0.03em] md:text-5xl';
const CARD = 'min-w-0 rounded-base border-2 border-border p-6 shadow-hard';

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

/** A highlighted word in a heading: the marker-pen accent of the style. */
function Marker({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-base border-2 border-border bg-main px-2 text-on-fill">
      {children}
    </span>
  );
}

function IconTile({ icon: IconComponent, className }: { icon: Icon; className?: string }) {
  return (
    <span
      className={cn(
        'grid size-10 shrink-0 place-items-center rounded-base border-2 border-border bg-surface text-text',
        className,
      )}
    >
      <IconComponent size={22} weight="bold" aria-hidden="true" />
    </span>
  );
}

function Nav({ isSignedIn }: { isSignedIn: boolean }) {
  return (
    <header
      className="sticky top-0 border-b-2 border-border bg-surface"
      style={{ zIndex: Z_INDEX.header }}
    >
      <div className={cn(CONTAINER, 'flex h-16 items-center gap-6')}>
        <Link href="/" className="flex h-10 items-center gap-2 text-lg font-bold">
          <span className="grid size-8 place-items-center rounded-base border-2 border-border bg-main text-on-fill shadow-hard-sm">
            <GitPullRequest size={18} weight="bold" aria-hidden="true" />
          </span>
          MergeMind
        </Link>
        <nav aria-label="Sections" className="hidden md:block">
          <ul className="flex items-center gap-1 font-bold text-text-muted">
            {SECTION_LINKS.map(([label, href]) => (
              <li key={label}>
                <a
                  href={href}
                  className="flex h-10 items-center px-3 decoration-2 underline-offset-4 hover:text-text hover:underline"
                >
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <Link
            href={isSignedIn ? '/repos' : '/signin'}
            className={buttonVariants({ variant: 'ghost', size: 'touch' })}
          >
            {isSignedIn ? 'Open the app' : 'Sign in'}
          </Link>
          <a
            href={installUrl()}
            className={cn(
              buttonVariants({ variant: 'primary', size: 'touch' }),
              'hidden sm:inline-flex',
            )}
          >
            Install on GitHub
          </a>
          {/* Below md the section links (and, on phones, Install) move into a disclosure menu. */}
          <details className="relative md:hidden">
            <summary
              aria-label="Menu"
              className="inline-flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-base border-2 border-border bg-surface hover:bg-surface-muted [&::-webkit-details-marker]:hidden"
            >
              <List size={20} weight="bold" aria-hidden="true" />
            </summary>
            <nav
              aria-label="Site"
              className="absolute right-0 mt-2 w-60 rounded-base border-2 border-border bg-surface p-2 shadow-hard"
              style={{ zIndex: Z_INDEX.popover }}
            >
              <ul className="flex flex-col gap-1 font-bold">
                {SECTION_LINKS.map(([label, href]) => (
                  <li key={label}>
                    <a
                      href={href}
                      className="flex h-10 items-center rounded-base border-2 border-transparent px-3 hover:border-border hover:bg-surface-muted"
                    >
                      {label}
                    </a>
                  </li>
                ))}
                <li className="mt-1 sm:hidden">
                  <a
                    href={installUrl()}
                    className={cn(buttonVariants({ variant: 'primary', size: 'touch' }), 'w-full')}
                  >
                    Install on GitHub
                  </a>
                </li>
              </ul>
            </nav>
          </details>
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
        className="sr-only rounded-base border-2 border-border bg-main px-3 py-2 font-bold text-on-fill focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
        style={{ zIndex: Z_INDEX.toast }}
      >
        Skip to content
      </a>
      <Nav isSignedIn={viewer !== null} />
      <main id="main" className="text-base leading-[26px]">
        {/* Hero: a lemon band, copy left, the real product screenshot in a heavy frame right. */}
        <section className="scope-fill border-b-2 border-border bg-main">
          <div
            className={cn(
              CONTAINER,
              'grid grid-cols-[minmax(0,1fr)] gap-12 pt-16 pb-20 md:pt-24 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-center',
            )}
          >
            <div>
              <h1 className="text-5xl leading-[0.95] font-bold tracking-[-0.04em] md:text-6xl lg:text-[64px]">
                Code review that never sleeps.
              </h1>
              <p className="mt-6 max-w-[42ch] text-lg leading-7">
                MergeMind reviews every pull request for security, correctness and maintainability,
                and explains failed CI runs in plain words.
              </p>
              <div className="mt-8 flex flex-wrap gap-4">
                <a
                  href={installUrl()}
                  className={buttonVariants({ variant: 'ink', size: 'touch' })}
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
              <div className="overflow-hidden rounded-base border-[3px] border-border bg-surface shadow-hard-lg">
                <ThemedShot
                  theme={theme}
                  light={heroLight}
                  dark={heroDark}
                  narrow={{ light: findingLight, dark: findingDark }}
                  alt="MergeMind run page: a critical finding for a payment key committed in src/refunds.ts, with a suggested fix and the flagged line."
                  sizes="(min-width: 1024px) 640px, 100vw"
                  isPriority
                />
              </div>
              <figcaption className="relative -mt-4 ml-4 inline-block -rotate-2 rounded-base border-2 border-border bg-surface px-2 py-1 font-mono text-xs font-medium shadow-hard-sm">
                The MergeMind app, with sample data.
              </figcaption>
            </figure>
          </div>
        </section>

        {/* How a review runs: three numbered cards, then the real GitHub review. */}
        <section id="how" className="border-b-2 border-border py-20 md:py-28">
          <div className={CONTAINER}>
            <h2 className={SECTION_TITLE}>
              How a <Marker>review</Marker> runs
            </h2>
            <ol className="mt-12 grid grid-cols-[minmax(0,1fr)] gap-6 md:grid-cols-3">
              {STEPS.map(({ icon, title, body }, index) => (
                <li key={title} className={cn(CARD, 'bg-surface')}>
                  <div className="flex items-center justify-between">
                    <IconTile icon={icon} className="bg-main text-on-fill" />
                    <span
                      className="font-mono text-3xl font-medium text-text-muted"
                      aria-hidden="true"
                    >
                      {String(index + 1).padStart(2, '0')}
                    </span>
                  </div>
                  <h3 className="mt-5 text-xl font-bold">{title}</h3>
                  <p className="mt-2 text-text-muted">{body}</p>
                </li>
              ))}
            </ol>
            <figure className="mt-16">
              <div className="mx-auto max-w-3xl overflow-hidden rounded-base border-[3px] border-border bg-surface shadow-hard-lg">
                <ThemedShot
                  theme={theme}
                  light={reviewLight}
                  dark={reviewDark}
                  alt="A MergeMind review on a GitHub pull request: one critical and two major findings, with an inline comment on a hardcoded API key and a suggested fix."
                  sizes="(min-width: 768px) 768px, 100vw"
                />
              </div>
              <figcaption className="mx-auto mt-4 max-w-3xl font-mono text-xs text-text-muted">
                MergeMind on a real pull request.{' '}
                <a
                  href={SAMPLE_REVIEW_URL}
                  className="font-bold text-text underline decoration-2 underline-offset-2"
                >
                  Open it on GitHub
                </a>
              </figcaption>
            </figure>
          </div>
        </section>

        {/* What it checks: a four-cell bento, each cell its own flat fill. */}
        <section id="checks" className="border-b-2 border-border py-20 md:py-28">
          <div className={CONTAINER}>
            <h2 className={SECTION_TITLE}>
              What it <Marker>checks</Marker>
            </h2>
            <div className="mt-12 grid grid-cols-[minmax(0,1fr)] gap-6 md:grid-cols-6">
              <article className={cn(CARD, 'flex flex-col gap-5 bg-surface md:col-span-4')}>
                <div>
                  <h3 className="flex items-center gap-3 text-xl font-bold">
                    <IconTile icon={ShieldWarning} className="bg-sev-critical-bg text-on-fill" />
                    Security
                  </h3>
                  <p className="mt-3 max-w-[52ch] text-text-muted">
                    Injection, hardcoded secrets and unchecked input, flagged on the exact line with
                    a fix you can apply.
                  </p>
                </div>
                <div className="overflow-hidden rounded-base border-2 border-border">
                  <ThemedShot
                    theme={theme}
                    light={findingLight}
                    dark={findingDark}
                    alt="A critical security finding card: live payment key committed in source, with a suggested fix that reads the key from the environment."
                    sizes="(min-width: 768px) 600px, 100vw"
                  />
                </div>
              </article>
              <article className={cn(CARD, 'scope-fill bg-info md:col-span-2')}>
                <h3 className="flex items-center gap-3 text-xl font-bold">
                  <IconTile icon={BugBeetle} />
                  Correctness
                </h3>
                <p className="mt-3 text-text-muted">
                  Missing awaits, null dereferences, off-by-one errors and races, judged against the
                  code your change calls.
                </p>
              </article>
              <article className={cn(CARD, 'scope-fill bg-lavender md:col-span-2')}>
                <h3 className="flex items-center gap-3 text-xl font-bold">
                  <IconTile icon={Wrench} />
                  Maintainability
                </h3>
                <p className="mt-3 text-text-muted">
                  Swallowed errors, unbounded queries and leaks. Small nits go in the summary, not
                  in your diff.
                </p>
              </article>
              <article className={cn(CARD, 'scope-fill flex flex-col gap-5 bg-main md:col-span-4')}>
                <div>
                  <h3 className="flex items-center gap-3 text-xl font-bold">
                    <IconTile icon={ListChecks} />
                    CI failures
                  </h3>
                  <p className="mt-3 max-w-[52ch] text-text-muted">
                    When a GitHub Actions run fails, MergeMind reads the failed job's log and posts
                    one comment with the failing step, the likely cause and the lines that show it.
                  </p>
                </div>
                <pre
                  tabIndex={0}
                  className="overflow-x-auto rounded-base border-2 border-border bg-surface p-4 font-mono text-[13px] leading-5"
                >
                  <code>{`Failing step: test / Run tests
Likely cause: the test runner cannot locate the tests
directory, resulting in a MODULE_NOT_FOUND error.
Evidence: line 146  # Error: Cannot find module '.../tests'`}</code>
                </pre>
                <p className="font-mono text-xs text-text-muted">
                  From a real CI run on a test repository.
                </p>
              </article>
            </div>
          </div>
        </section>

        {/* Runs on free tiers: an ink terminal block. */}
        <section className="border-b-2 border-border py-20 md:py-28">
          <div className={CONTAINER}>
            <h2 className={SECTION_TITLE}>
              Runs on <Marker>free</Marker> tiers
            </h2>
            <p className="mt-5 max-w-[60ch] text-lg leading-7 text-text-muted">
              Groq and Gemini free tiers review the code, Ollama embeds it on your machine, and
              MongoDB and Redis run in Docker.
            </p>
            <div className="mt-10 overflow-hidden rounded-base border-[3px] border-border shadow-hard-lg">
              <p className="scope-ink border-b-2 border-border px-5 py-2 font-mono text-xs font-medium">
                Terminal
              </p>
              <pre
                tabIndex={0}
                className="scope-ink overflow-x-auto p-5 font-mono text-[15px] leading-7"
              >
                <code>{`docker compose up -d
ollama pull nomic-embed-text
npm install
npm run dev`}</code>
              </pre>
            </div>
          </div>
        </section>

        {/* Closing call to action (one label per intent). */}
        <section className="scope-fill border-b-2 border-border bg-main py-20 md:py-24">
          <div
            className={cn(
              CONTAINER,
              'flex flex-col items-start gap-8 md:flex-row md:items-center md:justify-between',
            )}
          >
            <h2 className="max-w-[22ch] text-4xl leading-[1.05] font-bold tracking-[-0.03em]">
              Put a first-pass reviewer on every pull request.
            </h2>
            <a href={installUrl()} className={buttonVariants({ variant: 'ink', size: 'touch' })}>
              Install on GitHub
            </a>
          </div>
        </section>
      </main>
      <footer className="scope-ink">
        <div
          className={cn(
            CONTAINER,
            'flex flex-col gap-4 py-10 text-text-muted md:flex-row md:items-center md:justify-between',
          )}
        >
          <p className="flex items-center gap-2 font-bold text-text">
            <GitPullRequest size={18} weight="bold" aria-hidden="true" />
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
                <a
                  href={href}
                  className="inline-flex h-10 items-center gap-1 decoration-2 underline-offset-4 hover:text-text hover:underline"
                >
                  {label}
                  {label === 'Source on GitHub' ? (
                    <ArrowSquareOut size={14} weight="bold" aria-hidden="true" />
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
