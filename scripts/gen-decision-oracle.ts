import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { loadDefaultGameData } from '../src/data/node';
import type { PvpokeShieldDecision, PvpokeSideSnapshot, ShieldTraceRequest } from './oracle/harness';
import { metaSpecies } from './oracle/meta';
import { loadPvpoke } from './oracle/load';


const upstream = readFileSync('data/UPSTREAM', 'utf8').trim();
const pvpoke = loadPvpoke();
const meta = metaSpecies(loadDefaultGameData(), 40);

const SHIELD_SETUPS: readonly Pick<ShieldTraceRequest, 'shields' | 'baitShields'>[] = [
  { shields: [1, 1] }, { shields: [2, 2] }, { shields: [1, 0] }, { shields: [0, 1] }, { shields: [2, 1] },
  { shields: [1, 1], baitShields: [2, 2] }, { shields: [1, 1], baitShields: [0, 0] },
];

/** PvPoke's move ordering for every meta pair (both sides recorded; mons as indexes into `mons`). */
function moveMetaCases(): unknown[] {
  const cases: unknown[] = [];
  for (let i = 0; i < meta.length; i++) {
    for (let j = i; j < meta.length; j++) {
      cases.push({ a: i, b: j, result: pvpoke.moveMeta({ a: meta[i]!, b: meta[j]! }) });
    }
  }
  return cases;
}

/** Compact side encoding: [hp, energy, shields, atkStage, defStage, fastDamage, ...chargedDamage]. */
function encodeSide(s: PvpokeSideSnapshot): number[] {
  return [s.hp, s.energy, s.shields, s.buffs[0], s.buffs[1], s.fastDamage, ...s.chargedDamage];
}

/** Compact decision encoding: [attacker, moveIndex, wouldShield, shielded, side0, side1] (booleans as 0/1). */
function encodeDecision(d: PvpokeShieldDecision): unknown[] {
  return [d.attacker, d.moveIndex, d.wouldShield ? 1 : 0, d.shielded ? 1 : 0, encodeSide(d.sides[0]), encodeSide(d.sides[1])];
}

/** Every shield decision PvPoke makes in default simulations over meta pairs and shield setups. */
function shieldCases(): unknown[] {
  const cases: unknown[] = [];
  for (let i = 0; i < meta.length; i++) {
    for (let j = i + 1; j < meta.length; j++) {
      for (const setup of SHIELD_SETUPS) {
        const decisions = pvpoke.shieldTrace({ a: meta[i]!, b: meta[j]!, ...setup }).map(encodeDecision);
        // Mons are stored as indexes into the fixture's `mons` list to keep the file small.
        if (decisions.length > 0) cases.push({ a: i, b: j, ...setup, decisions });
      }
    }
  }
  return cases;
}

mkdirSync('tests/fixtures', { recursive: true });
const moveMeta = moveMetaCases();
writeFileSync('tests/fixtures/move-meta-oracle.json', JSON.stringify({ upstream, mons: meta, cases: moveMeta }));
console.log(`move-meta-oracle.json: ${moveMeta.length} cases`);
const shields = shieldCases();
writeFileSync('tests/fixtures/shield-oracle.json', JSON.stringify({ upstream, mons: meta, cases: shields }));
console.log(`shield-oracle.json: ${shields.length} cases`);
