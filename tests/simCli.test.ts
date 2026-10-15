import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('sim CLI', () => {
  it('prints ratings and a timeline for an explicit moveset', () => {
    const out = execFileSync('npx', ['tsx', 'scripts/sim.ts', 'medicham', 'azumarill', '--shields', '0', '0', '--policy', 'fast', '--moves-a', 'COUNTER,ICE_PUNCH,DYNAMIC_PUNCH'], { encoding: 'utf8' });
    expect(out).toContain('Medicham');
    expect(out).toContain('Azumarill');
    expect(out).toMatch(/Rating\s+\d+\s+vs\s+\d+/);
    expect(out).toMatch(/T\s*2\s+Medicham\s+Counter\s+4/);
  });

  it('uses the ranking moveset when no --moves override is given', () => {
    const out = execFileSync('npx', ['tsx', 'scripts/sim.ts', 'medicham', 'azumarill', '--shields', '0', '0', '--policy', 'fast'], { encoding: 'utf8' });
    expect(out).toContain('Psycho Cut');
  });

  it('exits non-zero with a clear message for an unknown species', () => {
    expect(() => execFileSync('npx', ['tsx', 'scripts/sim.ts', 'nope', 'azumarill'], { encoding: 'utf8', stdio: 'pipe' })).toThrow(/Unknown species nope/);
  });

  it('rejects an unknown --policy instead of falling back to greedy', () => {
    expect(() => execFileSync('npx', ['tsx', 'scripts/sim.ts', 'medicham', 'azumarill', '--policy', 'bogus'], { encoding: 'utf8', stdio: 'pipe' })).toThrow(/--policy must be one of: greedy, fast/);
  });

  it('rejects --shields values that are not integers 0-2', () => {
    expect(() => execFileSync('npx', ['tsx', 'scripts/sim.ts', 'medicham', 'azumarill', '--shields', '3', '0'], { encoding: 'utf8', stdio: 'pipe' })).toThrow(/--shields must be two integers from 0 to 2/);
  });
});
