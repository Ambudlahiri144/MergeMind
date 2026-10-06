'use client';

import { DesktopIcon as Desktop, MoonIcon as Moon, SunIcon as Sun } from '@phosphor-icons/react';
import { useState } from 'react';

import { THEME_COOKIE, type Theme } from '@/lib/theme';

const NEXT: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' };
const LABEL: Record<Theme, string> = {
  system: 'Theme: system',
  light: 'Theme: light',
  dark: 'Theme: dark',
};
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

/**
 * Cycles system, light, dark. The choice applies at once and is stored in a plain cookie
 * written here, not by a server request a reload could cancel; the root layout reads it.
 */
export function ThemeToggle({ initial }: { initial: Theme }) {
  const [theme, setTheme] = useState<Theme>(initial);
  const Icon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Desktop;

  return (
    <button
      type="button"
      aria-label={`${LABEL[theme]}. Switch theme`}
      title={LABEL[theme]}
      className="inline-flex h-10 w-10 items-center justify-center rounded-md text-text-muted transition-colors duration-150 hover:bg-surface-muted hover:text-text"
      onClick={() => {
        const next = NEXT[theme];
        setTheme(next);
        if (next === 'system') {
          delete document.documentElement.dataset.theme;
        } else {
          document.documentElement.dataset.theme = next;
        }
        document.cookie = `${THEME_COOKIE}=${next}; Max-Age=${String(ONE_YEAR_SECONDS)}; Path=/; SameSite=Lax`;
      }}
    >
      <Icon size={20} aria-hidden="true" />
    </button>
  );
}
