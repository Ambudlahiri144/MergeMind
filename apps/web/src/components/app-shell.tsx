import {
  GitPullRequestIcon as GitPullRequest,
  ListIcon as List,
  SignOutIcon as SignOut,
} from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { signOut } from '@/app/actions/auth';
import { Z_INDEX } from '@/lib/z-index';
import type { Viewer } from '@/lib/session';
import type { Theme } from '@/lib/theme';

import { NavLinks } from './nav-links';
import { ThemeToggle } from './theme-toggle';

function Wordmark() {
  return (
    <Link href="/repos" className="flex h-10 items-center gap-2 rounded-md pr-2 font-semibold">
      <GitPullRequest size={20} weight="bold" className="text-accent" aria-hidden="true" />
      MergeMind
    </Link>
  );
}

function UserMenu({ viewer }: { viewer: Viewer }) {
  return (
    <form action={signOut} className="flex items-center gap-1">
      <span className="hidden max-w-[16ch] truncate px-2 text-text-muted sm:inline">
        {viewer.login}
      </span>
      <button
        type="submit"
        className="inline-flex h-10 items-center gap-2 rounded-md px-3 text-text-muted transition-colors duration-150 hover:bg-surface-muted hover:text-text"
      >
        <SignOut size={20} aria-hidden="true" />
        <span className="sr-only sm:not-sr-only">Sign out</span>
      </button>
    </form>
  );
}

/**
 * Design.md §3 app shell: 56px top nav with the wordmark, Repositories and Settings, and the
 * user menu. No sidebar. Below md the links move into a disclosure menu.
 */
export function AppShell({
  viewer,
  theme,
  children,
}: {
  viewer: Viewer;
  theme: Theme;
  children: ReactNode;
}) {
  return (
    <>
      <a
        href="#main"
        className="sr-only rounded-md bg-surface px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
        style={{ zIndex: Z_INDEX.toast }}
      >
        Skip to content
      </a>
      <header
        className="sticky top-0 border-b border-border bg-surface/95 backdrop-blur"
        style={{ zIndex: Z_INDEX.header }}
      >
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 md:px-6">
          <Wordmark />
          <NavLinks className="hidden md:block" />
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle initial={theme} />
            <UserMenu viewer={viewer} />
            <details className="relative md:hidden">
              <summary
                aria-label="Menu"
                className="inline-flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-md hover:bg-surface-muted [&::-webkit-details-marker]:hidden"
              >
                <List size={20} aria-hidden="true" />
              </summary>
              <div
                className="absolute right-0 mt-2 w-56 rounded-lg border border-border bg-surface p-2 shadow-pop"
                style={{ zIndex: Z_INDEX.popover }}
              >
                <NavLinks />
              </div>
            </details>
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-6xl px-4 py-8 md:px-6">
        {children}
      </main>
    </>
  );
}
