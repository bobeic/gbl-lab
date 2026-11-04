import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('vendored data', () => {
  it('is pinned to the upstream commit', () => {
    expect(readFileSync('data/UPSTREAM', 'utf8').trim()).toBe('e02bde78d19be9b9099b5a6629c6a8d0835a53be');
  });
});
