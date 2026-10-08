'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { auth } from '@/lib/auth';
import { safeNext } from '@/lib/safe-next';

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
