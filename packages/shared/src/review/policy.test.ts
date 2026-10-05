import { describe, expect, it } from 'vitest';

import {
  DEFAULT_POLICY,
  MAX_POLICY_FILE_BYTES,
  createIgnoreMatcher,
  parsePolicy,
} from './policy.js';

describe('parsePolicy', () => {
  it('returns defaults with no errors when the file is missing', () => {
    expect(parsePolicy(null)).toEqual({ policy: DEFAULT_POLICY, source: 'default', errors: [] });
  });

  it('rejects an oversized file without parsing it', () => {
    const result = parsePolicy(`persona: "${'x'.repeat(MAX_POLICY_FILE_BYTES)}"`);

    expect(result.source).toBe('default');
    expect(result.errors[0]).toMatch(/larger than/);
  });

  it('rejects a version other than 1', () => {
    expect(parsePolicy('version: 2').errors[0]).toMatch(/^version:/);
  });

  it('rejects a non-object document', () => {
    expect(parsePolicy('- just\n- a list').source).toBe('default');
  });

  it('rejects duplicate keys', () => {
    expect(parsePolicy('gate:\n  failOn: major\ngate:\n  failOn: never').source).toBe('default');
  });

  it('does not share mutable state with DEFAULT_POLICY between calls', () => {
    const first = parsePolicy('review:\n  minConfidence: 0.5');
    const second = parsePolicy(null);

    expect(first.policy.review.minConfidence).toBe(0.5);
    expect(second.policy.review.minConfidence).toBe(0.7);
  });
});

describe('createIgnoreMatcher', () => {
  it('matches the default ignore globs', () => {
    const isIgnored = createIgnoreMatcher(DEFAULT_POLICY.review.ignorePaths);

    expect(isIgnored('package-lock.json')).toBe(true);
    expect(isIgnored('apps/web/yarn.lock')).toBe(true);
    expect(isIgnored('dist/index.js')).toBe(true);
    expect(isIgnored('src/__snapshots__/a.snap')).toBe(true);
    expect(isIgnored('src/index.ts')).toBe(false);
  });

  it('matches dotfiles', () => {
    expect(createIgnoreMatcher(['**/*.yml'])('.github/workflows/ci.yml')).toBe(true);
  });

  it('ignores nothing for an empty list', () => {
    expect(createIgnoreMatcher([])('anything.lock')).toBe(false);
  });
});
