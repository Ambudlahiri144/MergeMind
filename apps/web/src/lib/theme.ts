export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_COOKIE = 'mm-theme';

export function parseTheme(value: string | undefined): Theme {
  return THEMES.find((theme) => theme === value) ?? 'system';
}
