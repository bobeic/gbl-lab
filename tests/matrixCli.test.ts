import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const run = (...args: string[]): string => execFileSync('npx', ['tsx', 'scripts/matrix.ts', ...args], { encoding: 'utf8', stdio: 'pipe' });
const rosterFile = (content: unknown): string => {
  const path = join(mkdtempSync(join(tmpdir(), 'gbl-roster-')), 'roster.json');
  writeFileSync(path, JSON.stringify(content));
  return path;
};

describe('matrix CLI', () => {
  it('prints a meta Pokémon\'s summary and its best and worst 1-1 matchups', () => {
    const out = run('melmetal');
    expect(out).toContain('Melmetal');
    expect(out).toMatch(/Average \(1-1\): \d+/);
    expect(out).toMatch(/Wins\/losses: 0-0 \d+\/\d+ · 1-1 \d+\/\d+ · 2-2 \d+\/\d+/);
    expect(out).toContain('Best at 1-1');
    expect(out).toContain('Worst at 1-1');
    expect(out.match(/^\s+\d+\s+\S/gm)!.length).toBe(20);
  });

  it('uses --shields for the best/worst lists', () => {
    expect(run('melmetal', '--shields', '0', '2')).toContain('Best at 0-2');
  });

  it('prints one block per roster entry', () => {
    const path = rosterFile([
      { speciesId: 'azumarill', fastMoveId: 'BUBBLE', chargedMoveIds: ['ICE_BEAM', 'PLAY_ROUGH'], ivs: { atk: 0, def: 15, hp: 15 }, label: 'My Azu' },
      { speciesId: 'medicham', fastMoveId: 'COUNTER', chargedMoveIds: ['ICE_PUNCH', 'PSYCHIC'] },
    ]);
    const out = run('--roster', path);
    expect(out).toContain('My Azu');
    expect(out).toContain('Medicham');
    expect(out.match(/Average \(1-1\)/g)!.length).toBe(2);
  });

  it.each([
    ['an unknown species', ['nope'], /Unknown species nope/],
    ['a species outside the meta', ['bulbasaur'], /bulbasaur is not in the matrix meta/],
    ['no arguments', [], /Usage: npm run matrix/],
    ['invalid shields', ['melmetal', '--shields', '3', '0'], /--shields must be two integers from 0 to 2/],
    ['a missing roster file', ['--roster', '/nonexistent/roster.json'], /Cannot read roster file/],
    ['--roster without a path', ['--roster'], /--roster needs a path/],
  ])('exits non-zero for %s', (_name, args, message) => {
    expect(() => run(...args)).toThrow(message);
  });

  it('exits non-zero naming a bad roster entry', () => {
    const path = rosterFile([{ speciesId: 'azumarill', fastMoveId: 'COUNTER', chargedMoveIds: ['ICE_BEAM'] }]);
    expect(() => run('--roster', path)).toThrow(/Roster entry 0 \(azumarill\): azumarill cannot learn fast move COUNTER/);
  });
});
