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
    <Link
      href="/repos"
      className="flex h-10 items-center gap-2 rounded-base pr-2 text-lg font-bold"
    >
      <span className="grid size-8 place-items-center rounded-base border-2 border-border bg-main text-on-fill shadow-hard-sm">
        <GitPullRequest size={18} weight="bold" aria-hidden="true" />
      </span>
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
        className="inline-flex h-10 items-center gap-2 rounded-base border-2 border-transparent px-3 font-bold text-text-muted hover:border-border hover:bg-surface-muted hover:text-text"
      >
        <SignOut size={20} weight="bold" aria-hidden="true" />
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
        className="sr-only rounded-base border-2 border-border bg-main px-3 py-2 font-bold text-on-fill focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
        style={{ zIndex: Z_INDEX.toast }}
      >
        Skip to content
      </a>
      <header
        className="sticky top-0 border-b-2 border-border bg-surface"
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
                className="inline-flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-base border-2 border-border bg-surface hover:bg-surface-muted [&::-webkit-details-marker]:hidden"
              >
                <List size={20} weight="bold" aria-hidden="true" />
              </summary>
              <div
                className="absolute right-0 mt-2 w-56 rounded-base border-2 border-border bg-surface p-2 shadow-hard"
                style={{ zIndex: Z_INDEX.popover }}
              >
                <NavLinks />
              </div>
            </details>
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-6xl px-4 py-10 md:px-6">
        {children}
      </main>
    </>
  );
}
