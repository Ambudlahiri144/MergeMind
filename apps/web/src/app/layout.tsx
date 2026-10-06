import type { Metadata } from 'next';
import { JetBrains_Mono, Space_Grotesk } from 'next/font/google';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';

import { THEME_COOKIE, parseTheme } from '@/lib/theme';

import './globals.css';

// Self-hosted at build time by next/font: no request reaches Google at runtime (Design.md §2.3).
const sans = Space_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-space-grotesk',
  display: 'swap',
});
const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'MergeMind', template: '%s · MergeMind' },
  description: 'AI first-pass code review for every pull request, with CI failure explanations.',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html
      lang="en"
      className={`${sans.variable} ${mono.variable}`}
      {...(theme === 'system' ? {} : { 'data-theme': theme })}
    >
      <body>{children}</body>
    </html>
  );
}
