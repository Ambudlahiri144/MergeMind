import { ValidationError } from '@mergemind/shared';
import { describe, expect, it } from 'vitest';

import { parseRepoFullName } from './repo-name.js';

describe('parseRepoFullName', () => {
  it('splits owner and repository', () => {
    expect(parseRepoFullName('octo-org/merge.mind_api')).toEqual({
      owner: 'octo-org',
      repo: 'merge.mind_api',
    });
  });

  it.each(['no-slash', 'a/b/c', '/repo', 'owner/', 'own er/repo'])(
    'rejects %s with a ValidationError',
    (fullName) => {
      expect(() => parseRepoFullName(fullName)).toThrow(ValidationError);
    },
  );
});
