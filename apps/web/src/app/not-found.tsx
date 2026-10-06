import { MagnifyingGlassIcon as MagnifyingGlass } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';

import { buttonVariants } from '@/components/ui/button';

export default function NotFound() {
  return (
    <main className="grid min-h-[100dvh] place-items-center px-4">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <MagnifyingGlass size={32} className="text-text-muted" aria-hidden="true" />
        <h1 className="text-2xl leading-8 font-semibold">Not found</h1>
        <p className="text-text-muted">
          This page does not exist, or it belongs to an installation you cannot access.
        </p>
        <Link href="/repos" className={buttonVariants({ variant: 'primary' })}>
          Repositories
        </Link>
      </div>
    </main>
  );
}
