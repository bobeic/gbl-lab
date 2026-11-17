import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('vendored data', () => {
  it('is pinned to the upstream commit', () => {
    expect(readFileSync('data/UPSTREAM', 'utf8').trim()).toBe('d02018eb6bfc4a041cca69d7bc9de0d5179a8365');
  });
});
