import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('vendored data', () => {
  it('is pinned to the upstream commit', () => {
    expect(readFileSync('data/UPSTREAM', 'utf8').trim()).toBe('a23fb293300077028a65da534c73bd6367b7ef9d');
  });
});
