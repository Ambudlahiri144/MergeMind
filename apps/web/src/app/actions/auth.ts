'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { auth } from '@/lib/auth';

/** Only same-site paths are followed after sign-in (no open redirect). */
function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === 'string' ? value : '';
  return next.startsWith('/') && !next.startsWith('//') ? next : '/repos';
}

export async function signInWithGithub(formData: FormData): Promise<void> {
  const result = await auth.api.signInSocial({
    body: { provider: 'github', callbackURL: safeNext(formData.get('next')) },
  });
  // redirect() throws, so it stays outside any try/catch.
  redirect(result.url ?? '/signin?error=github');
}

export async function signOut(): Promise<void> {
  await auth.api.signOut({ headers: await headers() });
  redirect('/signin');
}
