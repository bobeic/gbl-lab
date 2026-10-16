import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { OracleCase } from '../scripts/compare-oracle';
import type { OracleMon } from '../scripts/oracle/harness';
import { loadDefaultGameData } from '../src/data/node';
import { buildCombatant, type Combatant } from '../src/engine/combatant';
import { TurnLimitError } from '../src/errors';
import { cellFrom, simulateCell, type Cell } from '../src/matrix/cell';
import { PvPokeLikePolicy } from '../src/policy/pvpoke';
import { runMatchup } from '../src/sim/runMatchup';

const gd = loadDefaultGameData();
const build = (m: OracleMon): Combatant => buildCombatant(gd, { speciesId: m.speciesId, fastMoveId: m.moveset[0]!, chargedMoveIds: m.moveset.slice(1) });
const melmetal = build({ speciesId: 'melmetal', moveset: ['THUNDER_SHOCK', 'DOUBLE_IRON_BASH', 'DYNAMIC_PUNCH'] });
const azumarill = build({ speciesId: 'azumarill', moveset: ['BUBBLE', 'ICE_BEAM', 'PLAY_ROUGH'] });

describe('cellFrom', () => {
  it('fills a 3x3 grid indexed [aShields][bShields]', () => {
    expect(cellFrom((sa, sb) => sa * 10 + sb)).toEqual([[0, 1, 2], [10, 11, 12], [20, 21, 22]]);
  });
});

describe('simulateCell', () => {
  it('puts each asymmetric scenario at [aShields][bShields] from a\'s side', () => {
    const cell = simulateCell(gd, melmetal, azumarill);
    for (const [sa, sb] of [[0, 2], [2, 0], [0, 1], [1, 2]] as const) {
      const direct = runMatchup(gd, melmetal, azumarill, { shields: [sa, sb], policies: [new PvPokeLikePolicy(), new PvPokeLikePolicy()] });
      expect(cell[sa][sb], `${sa}-${sb}`).toBe(direct.ratings[0]);
    }
  });

  it('matches PvPoke exactly for every committed oracle case', () => {
    const fixture = JSON.parse(readFileSync('tests/fixtures/oracle-gl.json', 'utf8')) as { cases: OracleCase[] };
    const cells = new Map<string, Cell>();
    for (const c of fixture.cases) {
      const key = `${c.a.speciesId}|${c.b.speciesId}`;
      let cell = cells.get(key);
      if (!cell) {
        cell = simulateCell(gd, build(c.a), build(c.b));
        cells.set(key, cell);
      }
      expect(cell[c.shields[0]]![c.shields[1]], `${key} ${c.shields.join('-')}`).toBe(c.ratings[0]);
    }
    expect(fixture.cases.length).toBe(15150);
  });

  it('names the pair and scenario when a battle hits the turn limit', () => {
    expect(() => simulateCell(gd, melmetal, azumarill, { maxTurns: 1 })).toThrow(TurnLimitError);
    expect(() => simulateCell(gd, melmetal, azumarill, { maxTurns: 1 })).toThrow(/^melmetal vs azumarill at 0-0: /);
  });
});
