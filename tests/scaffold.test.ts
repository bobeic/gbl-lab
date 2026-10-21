import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('vendored data', () => {
  it('is pinned to the upstream commit', () => {
    expect(readFileSync('data/UPSTREAM', 'utf8').trim()).toBe('415436c1af47389c299104a83d46be0df5fa5f08');
  });
});
