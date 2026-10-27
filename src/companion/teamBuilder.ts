/** One Pokémon's ratings against one meta opponent at 0-0, 1-1 and 2-2. */
export type Diag = readonly [r00: number, r11: number, r22: number];

/** A usable roster entry: its roster index, Pokédex number and ratings[o] against meta opponent o. */
export interface Candidate {
  readonly index: number;
  readonly dex: number;
  /** A mega: a team may have at most one. */
  readonly mega?: boolean;
  readonly ratings: readonly Diag[];
}

export interface TeamScore {
  /** Roster indices: lead, safe switch, closer. */
  readonly order: readonly [number, number, number];
  readonly score: number;
  readonly coverage: number;
  readonly consistency: number;
  readonly safety: number;
  /** Meta opponents covered. */
  readonly covered: number;
  /** Per role: opponents that member beats in its role scenario. */
  readonly roleWins: readonly [number, number, number];
  readonly safeCounters: number;
  /** Key opponents (top 10 or a user priority) nobody covers. */
  readonly keyUncovered: number;
  /** Meta indices nobody beats at 1-1, worst first. */
  readonly threats: readonly number[];
}

type Team = readonly [Candidate, Candidate, Candidate];

/** How much each meta opponent counts toward coverage, and which ones also cost safety when uncovered. */
export interface MetaWeights {
  readonly weights: readonly number[];
  readonly key: readonly boolean[];
}

/** Shield scenario (index into Diag) each role is rated in: lead 1-1, safe switch 1-1, closer 0-0. */
const ROLE_SCENARIO = [1, 1, 0] as const;
const WIN = 500;
const HARD_COUNTER = 300;
const TOP = 10;
/** Weight halves by rank 20: #1 counts ~8× #150. */
const RANK_FALLOFF = 20;
const PRIORITY_BOOST = 3;
/** Safety lost per % of the (weighted) meta that hard-counters the safe switch: pick3.gg's −20 per counter in its ~40-opponent meta. */
const SAFE_COUNTER_PENALTY = 8;
/** The 6 orders of a team's members (in roster order), tried in this sequence; the first best wins. */
const ORDERS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]] as const;

/** Weights falling off with meta rank, boosted for `priorities` (meta indices); key = top 10 or a priority. */
export function metaWeights(metaSize: number, priorities: readonly number[] = []): MetaWeights {
  const isPriority = (o: number) => priorities.includes(o);
  return {
    weights: Array.from({ length: metaSize }, (_, o) => (isPriority(o) ? PRIORITY_BOOST : 1) / (1 + o / RANK_FALLOFF)),
    key: Array.from({ length: metaSize }, (_, o) => o < TOP || isPriority(o)),
  };
}

/**
 * Score one ordered team [lead, safe switch, closer] with pick3.gg's formula (decoded from its app bundle):
 * 0.5 × coverage + 0.25 × consistency + 0.25 × safety. See the team builder design doc.
 * Unlike pick3.gg, coverage and safe-switch counters are weighted by `weighting`, so safety scales to any meta size,
 * and safety counts uncovered priorities as well as the top 10.
 */
export function scoreOrder(team: Team, weighting = metaWeights(team[0].ratings.length)): TeamScore {
  const metaSize = team[0].ratings.length;
  const roleWins: [number, number, number] = [0, 0, 0];
  let covered = 0;
  let coveredWeight = 0;
  let totalWeight = 0;
  let consistent = 0;
  let keyUncovered = 0;
  const unbeaten: { o: number; best: number }[] = [];
  for (let o = 0; o < metaSize; o++) {
    let isCovered = false;
    let best = -Infinity;
    team.forEach((m, role) => {
      const r = m.ratings[o]!;
      best = Math.max(best, r[1]);
      if (r[ROLE_SCENARIO[role]!] > WIN) {
        isCovered = true;
        roleWins[role]! += 1;
        if (r[0] > WIN && r[2] > WIN) consistent++;
      }
    });
    totalWeight += weighting.weights[o]!;
    if (isCovered) {
      covered++;
      coveredWeight += weighting.weights[o]!;
    } else if (weighting.key[o]) keyUncovered++;
    if (best <= WIN) unbeaten.push({ o, best });
  }
  const wins = roleWins[0] + roleWins[1] + roleWins[2];
  let safeCounters = 0;
  let counterWeight = 0;
  team[1].ratings.forEach((r, o) => {
    if (r[1] < HARD_COUNTER) {
      safeCounters++;
      counterWeight += weighting.weights[o]!;
    }
  });
  const coverage = (coveredWeight / totalWeight) * 100;
  const consistency = wins === 0 ? 0 : (consistent / wins) * 100;
  const counterShare = (counterWeight / totalWeight) * 100;
  const safety = Math.max(0, 100 - SAFE_COUNTER_PENALTY * counterShare - 10 * keyUncovered);
  return {
    order: [team[0].index, team[1].index, team[2].index],
    score: 0.5 * coverage + 0.25 * consistency + 0.25 * safety,
    coverage, consistency, safety, covered, roleWins, safeCounters, keyUncovered,
    // Stable sort: equal ratings stay in meta order.
    threats: unbeaten.sort((a, b) => a.best - b.best).map((t) => t.o),
  };
}

/**
 * The best `limit` teams of three from `candidates` (in roster order) that contain every pinned roster index,
 * never two of the same Pokédex number or two megas, each in its best order. Ties keep roster order.
 */
export function recommendTeams(
  candidates: readonly Candidate[], pins: readonly number[],
  weighting = metaWeights(candidates[0]?.ratings.length ?? 0), limit = 10,
): TeamScore[] {
  const teams: TeamScore[] = [];
  const n = candidates.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let k = j + 1; k < n; k++) {
        const members = [candidates[i]!, candidates[j]!, candidates[k]!] as const;
        if (new Set(members.map((m) => m.dex)).size < 3) continue;
        if (members.filter((m) => m.mega).length > 1) continue;
        if (!pins.every((p) => members.some((m) => m.index === p))) continue;
        let best: TeamScore | undefined;
        for (const [a, b, c] of ORDERS) {
          const s = scoreOrder([members[a], members[b], members[c]], weighting);
          if (!best || s.score > best.score) best = s;
        }
        teams.push(best!);
      }
    }
  }
  return teams.sort((a, b) => b.score - a.score).slice(0, limit);
}
