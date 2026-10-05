import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { DEFAULT_POLICY, parsePolicy } from '../../src/index.js';

const FIXTURES_DIR = new URL('../fixtures/policy/', import.meta.url);

async function parseFixture(name: string) {
  return parsePolicy(await readFile(new URL(name, FIXTURES_DIR), 'utf8'));
}

describe('.mergemind.yml fixtures', () => {
  it('applies every field of a full valid file', async () => {
    const result = await parseFixture('valid-full.yml');

    expect(result.source).toBe('file');
    expect(result.errors).toEqual([]);
    expect(result.policy).toEqual({
      version: 1,
      review: {
        enabled: true,
        passes: ['security', 'correctness'],
        minConfidence: 0.8,
        maxChangedLines: 800,
        skipDrafts: false,
        ignorePaths: ['docs/**', '**/*.generated.ts'],
      },
      gate: { failOn: 'major' },
      ciSummary: { enabled: false },
      persona: 'Strict payments reviewer. Flag money-handling bugs first.',
    });
  });

  it('keeps defaults for fields a partial file omits', async () => {
    const result = await parseFixture('valid-partial.yml');

    expect(result.policy).toEqual({ ...DEFAULT_POLICY, gate: { failOn: 'never' } });
  });

  it('treats an empty file as all defaults', async () => {
    const result = await parseFixture('empty.yml');

    expect(result).toEqual({ policy: DEFAULT_POLICY, source: 'file', errors: [] });
  });

  it.each([
    ['invalid-yaml.yml', /YAML/],
    ['invalid-values.yml', /review\.minConfidence/],
    ['unknown-keys.yml', /enabeld/],
  ])('falls back to defaults and reports %s', async (name, expectedError) => {
    const result = await parseFixture(name);

    expect(result.source).toBe('default');
    expect(result.policy).toEqual(DEFAULT_POLICY);
    expect(result.errors.join('\n')).toMatch(expectedError);
  });
});
