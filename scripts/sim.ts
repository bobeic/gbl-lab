import { readFileSync } from 'node:fs';
import { loadDefaultGameData } from '../src/data/node';
import { buildCombatant, type Combatant } from '../src/engine/combatant';
import type { Side } from '../src/engine/state';
import { PvPokeLikePolicy } from '../src/policy/pvpoke';
import { FastOnlyPolicy, GreedyPolicy } from '../src/policy/testPolicies';
import type { Policy } from '../src/policy/types';
import { runMatchup, type MatchupResult } from '../src/sim/runMatchup';

interface RankingEntry { speciesId: string; moveset: string[] }

const POLICY_NAMES = ['pvpoke', 'greedy', 'fast'] as const;
type PolicyName = (typeof POLICY_NAMES)[number];

/** Render a matchup result as a readable turn-by-turn timeline. */
export function formatTimeline(result: MatchupResult, names: [string, string], moveNames: Map<string, string>): string {
  const lines = [`Rating ${result.ratings[0]} vs ${result.ratings[1]}  (${result.winner === null ? 'tie' : `${names[result.winner]} wins`})`];
  for (const e of result.events) {
    const who = names[e.side as Side];
    const t = `T${String(e.turn).padStart(3)}`;
    if (e.kind === 'fast') lines.push(`${t} ${who} ${moveNames.get(e.moveId)} ${e.damage}`);
    if (e.kind === 'charged') lines.push(`${t} ${who} ${moveNames.get(e.moveId)} ${e.damage}${e.shielded ? ' (shielded)' : ''}  <<<`);
    if (e.kind === 'buff') lines.push(`${t} ${who} stats ${e.stages[0] >= 0 ? '+' : ''}${e.stages[0]} atk ${e.stages[1] >= 0 ? '+' : ''}${e.stages[1]} def`);
    if (e.kind === 'faint') lines.push(`${t} ${who} faints`);
  }
  return lines.join('\n');
}

function arg(flag: string, count: number): string[] | undefined {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv.slice(i + 1, i + 1 + count);
}

function parsePolicy(values: string[] | undefined): PolicyName {
  if (values === undefined) return 'pvpoke';
  const name = values[0];
  if (!(POLICY_NAMES as readonly string[]).includes(name ?? '')) {
    throw new Error(`--policy must be one of: ${POLICY_NAMES.join(', ')} (got ${name ?? 'nothing'})`);
  }
  return name as PolicyName;
}

function parseShields(values: string[] | undefined): [number, number] {
  if (values === undefined) return [1, 1];
  const parsed = values.map((v) => (/^\d+$/.test(v) ? Number(v) : NaN));
  if (parsed.length !== 2 || parsed.some((n) => !Number.isInteger(n) || n < 0 || n > 2)) {
    throw new Error(`--shields must be two integers from 0 to 2 (got ${values.join(' ') || 'nothing'})`);
  }
  return [parsed[0]!, parsed[1]!];
}

function main(): void {
  const [aId, bId] = process.argv.slice(2);
  if (!aId || !bId) throw new Error('Usage: npm run sim -- <speciesA> <speciesB> [--shields 1 1] [--policy pvpoke|greedy|fast] [--trace] [--moves-a F,C1,C2] [--moves-b F,C1,C2]');
  const gd = loadDefaultGameData();
  const rankings: RankingEntry[] = JSON.parse(readFileSync('data/rankings-1500.json', 'utf8'));

  const make = (id: string, flag: string): Combatant => {
    if (!gd.species.has(id)) throw new Error(`Unknown species ${id}`);
    const values = arg(flag, 1);
    const value = values?.[0];
    if (values !== undefined && (value === undefined || value.startsWith('--'))) {
      throw new Error(`${flag} needs a value: FAST,CHARGED1[,CHARGED2]`);
    }
    const override = value?.split(',');
    const moveset = override ?? rankings.find((r) => r.speciesId === id)?.moveset;
    if (!moveset) throw new Error(`No ranking moveset for ${id}; pass ${flag} FAST,CHARGED1[,CHARGED2]`);
    const [fastMoveId, ...chargedMoveIds] = moveset;
    return buildCombatant(gd, { speciesId: id, fastMoveId: fastMoveId!, chargedMoveIds });
  };

  const a = make(aId, '--moves-a');
  const b = make(bId, '--moves-b');
  const shields = parseShields(arg('--shields', 2));
  const policyName = parsePolicy(arg('--policy', 1));
  const trace = process.argv.includes('--trace');
  if (trace && policyName !== 'pvpoke') throw new Error(`--trace is only supported with --policy pvpoke (got ${policyName})`);
  const pvpoke = policyName === 'pvpoke' ? new PvPokeLikePolicy({ trace }) : undefined;
  const policy: Policy = pvpoke ?? (policyName === 'fast' ? new FastOnlyPolicy() : new GreedyPolicy());
  const result = runMatchup(gd, a, b, { shields, policies: [policy, policy] });
  const moveNames = new Map([...gd.moves.values()].map((m) => [m.id, m.name]));
  console.log(formatTimeline(result, [a.species.name, b.species.name], moveNames));
  if (pvpoke && trace) console.log(['', 'Decision trace', ...pvpoke.trace].join('\n'));
}

try {
  main();
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
