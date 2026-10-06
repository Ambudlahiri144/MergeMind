'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/cn';

const LINKS = [
  { href: '/repos', label: 'Repositories', matches: ['/repos', '/runs'] },
  { href: '/settings', label: 'Settings', matches: ['/settings'] },
] as const;

export function NavLinks({ className }: { className?: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className={className}>
      <ul className="flex flex-col gap-1 md:flex-row md:items-center">
        {LINKS.map((link) => {
          const isActive = link.matches.some((prefix) => pathname.startsWith(prefix));
          return (
            <li key={link.href}>
              <Link
                href={link.href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'flex h-10 items-center rounded-base border-2 px-3 font-bold',
                  isActive
                    ? 'border-border bg-main text-on-fill shadow-hard-sm'
                    : 'border-transparent text-text-muted hover:border-border hover:bg-surface-muted hover:text-text',
                )}
              >
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
