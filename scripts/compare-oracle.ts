import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { loadDefaultGameData } from '../src/data/node';
import type { GameData } from '../src/data/types';
import { buildCombatant, type Combatant } from '../src/engine/combatant';
import { PvPokeLikePolicy } from '../src/policy/pvpoke';
import { runMatchup, type MatchupResult } from '../src/sim/runMatchup';
import type { OracleMon, PvpokeHarness } from './oracle/harness';

export interface OracleDiff {
  a: OracleMon; b: OracleMon; shields: [number, number];
  ours: [number, number]; theirs: [number, number]; diff: number; winnerAgrees: boolean;
}

export interface OracleSummary {
  total: number;
  winnerAgreement: number;
  medianAbsRatingDiff: number;
  /** Cases where both ratings are identical to PvPoke's. */
  exactMatches: number;
  worst: OracleDiff[];
}

interface Case { a: OracleMon; b: OracleMon; shields: [number, number]; ratings: [number, number] }

const FIXTURE = 'tests/fixtures/oracle-gl.json';

const sign = (r: [number, number]): number => Math.sign(r[0] - r[1]);

function build(gd: GameData, m: OracleMon): Combatant {
  return buildCombatant(gd, { speciesId: m.speciesId, fastMoveId: m.moveset[0]!, chargedMoveIds: m.moveset.slice(1) });
}

function runOurs(gd: GameData, a: OracleMon, b: OracleMon, shields: [number, number]): MatchupResult {
  return runMatchup(gd, build(gd, a), build(gd, b), { shields, policies: [new PvPokeLikePolicy(), new PvPokeLikePolicy()] });
}

/** Run every default-policy oracle case through our engine and summarise agreement with PvPoke. */
export function compareOracle(): OracleSummary {
  const gd = loadDefaultGameData();
  const { cases } = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { cases: Case[] };
  const diffs: OracleDiff[] = cases.map((c) => {
    const r = runOurs(gd, c.a, c.b, c.shields);
    return {
      a: c.a, b: c.b, shields: c.shields, ours: r.ratings, theirs: c.ratings,
      diff: Math.abs(r.ratings[0] - c.ratings[0]), winnerAgrees: sign(r.ratings) === sign(c.ratings),
    };
  });
  const sorted = diffs.map((d) => d.diff).sort((x, y) => x - y);
  return {
    total: diffs.length,
    winnerAgreement: diffs.filter((d) => d.winnerAgrees).length / diffs.length,
    medianAbsRatingDiff: sorted[Math.floor(sorted.length / 2)] ?? 0,
    exactMatches: diffs.filter((d) => d.ours[0] === d.theirs[0] && d.ours[1] === d.theirs[1]).length,
    worst: [...diffs].sort((x, y) => Number(x.winnerAgrees) - Number(y.winnerAgrees) || y.diff - x.diff).slice(0, 20),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const summary = compareOracle();
  const require = createRequire(import.meta.url);
  const { createPvpoke } = require('./oracle/pvpokeHarness.cjs') as { createPvpoke: (d: string) => PvpokeHarness };
  const pvpoke = createPvpoke('.cache/pvpoke/src');
  const gd = loadDefaultGameData();
  const lines = [
    '# Oracle report', '',
    `Cases: ${summary.total}`,
    `Exact matches (both ratings identical): ${summary.exactMatches}`,
    `Winner agreement: ${(summary.winnerAgreement * 100).toFixed(2)}% (target >= 98%)`,
    `Median |rating diff|: ${summary.medianAbsRatingDiff} (target <= 25)`, '',
    '## Worst mismatches', '',
  ];
  for (const d of summary.worst) {
    const ours = runOurs(gd, d.a, d.b, d.shields);
    const theirs = pvpoke.simulate({ a: d.a, b: d.b, shields: d.shields, mode: 'default' });
    lines.push(`### ${d.a.speciesId} vs ${d.b.speciesId} ${d.shields.join('-')}: ours ${d.ours} / pvpoke ${d.theirs}`, '');
    lines.push('| ours | pvpoke |', '|---|---|');
    const o = ours.events.flatMap((e) => (e.kind === 'charged' ? [`T${e.turn} s${e.side} ${e.moveId}${e.shielded ? ' (S)' : ''}`] : []));
    const t = theirs.events.filter((e) => !e.type.startsWith('fast')).map((e) => `T${e.turn} s${e.side} ${e.name}${e.type === 'shield' ? ' (S)' : ''}`);
    for (let i = 0; i < Math.max(o.length, t.length); i++) lines.push(`| ${o[i] ?? ''} | ${t[i] ?? ''} |`);
    lines.push('');
  }
  mkdirSync('reports', { recursive: true });
  writeFileSync('reports/oracle-report.md', lines.join('\n'));
  console.log(lines.slice(0, 6).join('\n'));
}
