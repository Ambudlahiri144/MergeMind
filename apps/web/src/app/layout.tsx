import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';

import { THEME_COOKIE, parseTheme } from '@/lib/theme';

import './globals.css';

export const metadata: Metadata = {
  title: { default: 'MergeMind', template: '%s · MergeMind' },
  description: 'AI first-pass code review for every pull request, with CI failure explanations.',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      {...(theme === 'system' ? {} : { 'data-theme': theme })}
    >
      <body>{children}</body>
    </html>
  );
}
