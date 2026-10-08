import { describe, expect, it } from 'vitest';

import { safeNext } from './safe-next';

describe('safeNext (no open redirect after sign-in)', () => {
  it('keeps a same-site path, query included', () => {
    expect(safeNext('/repos/abc?state=open')).toBe('/repos/abc?state=open');
  });

  it.each([
    ['protocol-relative', '//evil.example'],
    ['backslash, which browsers read as a slash', '/\\evil.example'],
    ['absolute URL', 'https://evil.example/repos'],
    ['empty', ''],
    ['not a string', null],
  ])('falls back to /repos for %s', (_label, value) => {
    expect(safeNext(value)).toBe('/repos');
  });
});
