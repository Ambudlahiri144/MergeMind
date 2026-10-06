import { describe, expect, it } from 'vitest';

import { decideRole, hasRole } from './access.service.js';

const userInstall = { accountType: 'User' as const, accountLogin: 'Ananya-Iyer' };
const orgInstall = { accountType: 'Organization' as const, accountLogin: 'octo-demo' };

describe('decideRole (ADR-030)', () => {
  it.each([
    [
      'owner of a user installation (case-insensitive login)',
      userInstall,
      'ananya-iyer',
      null,
      'owner',
    ],
    ['someone else on a user installation', userInstall, 'rohan-mehta', null, null],
    ['active org admin', orgInstall, 'rohan-mehta', { role: 'admin', state: 'active' }, 'admin'],
    ['active org member', orgInstall, 'rohan-mehta', { role: 'member', state: 'active' }, 'member'],
    ['pending org invite', orgInstall, 'rohan-mehta', { role: 'admin', state: 'pending' }, null],
    ['not an org member', orgInstall, 'rohan-mehta', null, null],
  ] as const)('%s', (_label, installation, login, membership, expected) => {
    expect(decideRole(installation, login, membership)).toBe(expected);
  });
});

describe('hasRole', () => {
  it('ranks owner over admin over member', () => {
    expect(hasRole('owner', 'admin')).toBe(true);
    expect(hasRole('admin', 'admin')).toBe(true);
    expect(hasRole('member', 'admin')).toBe(false);
    expect(hasRole('member', 'member')).toBe(true);
  });
});
