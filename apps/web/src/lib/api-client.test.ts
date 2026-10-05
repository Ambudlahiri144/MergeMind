import { describe, expect, it } from 'vitest';

import { buildApiUrl } from './api-client';

describe('buildApiUrl', () => {
  it('prefixes the versioned base path', () => {
    expect(buildApiUrl('/repositories/1/pulls', 'http://localhost:4000')).toBe(
      'http://localhost:4000/api/v1/repositories/1/pulls',
    );
  });

  it('accepts a path without a leading slash', () => {
    expect(buildApiUrl('me', 'http://localhost:4000/')).toBe('http://localhost:4000/api/v1/me');
  });
});
