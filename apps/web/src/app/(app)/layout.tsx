import { cookies } from 'next/headers';

import { AppShell } from '@/components/app-shell';
import { requireViewer } from '@/lib/session';
import { THEME_COOKIE, parseTheme } from '@/lib/theme';

/** Every app screen sits behind a validated session (the proxy only checks for a cookie). */
export default async function AppLayout({ children }: LayoutProps<'/'>) {
  const viewer = await requireViewer();
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <AppShell viewer={viewer} theme={theme}>
      {children}
    </AppShell>
  );
}
