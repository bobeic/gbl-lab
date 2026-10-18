/** One Pokémon's ratings against one meta opponent at 0-0, 1-1 and 2-2. */
export type Diag = readonly [r00: number, r11: number, r22: number];

/** A usable roster entry: its roster index, Pokédex number and ratings[o] against meta opponent o. */
export interface Candidate {
  readonly index: number;
  readonly dex: number;
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
  readonly topUncovered: number;
  /** Meta indices nobody beats at 1-1, worst first. */
  readonly threats: readonly number[];
}

type Team = readonly [Candidate, Candidate, Candidate];

/** Shield scenario (index into Diag) each role is rated in: lead 1-1, safe switch 1-1, closer 0-0. */
const ROLE_SCENARIO = [1, 1, 0] as const;
const WIN = 500;
const HARD_COUNTER = 300;
const TOP = 10;
/** The 6 orders of a team's members (in roster order), tried in this sequence; the first best wins. */
const ORDERS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]] as const;

/**
 * Score one ordered team [lead, safe switch, closer] with pick3.gg's formula (decoded from its app bundle):
 * 0.5 × coverage + 0.25 × consistency + 0.25 × safety. See the team builder design doc.
 */
export function scoreOrder(team: Team): TeamScore {
  const metaSize = team[0].ratings.length;
  const roleWins: [number, number, number] = [0, 0, 0];
  let covered = 0;
  let consistent = 0;
  let topUncovered = 0;
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
    if (isCovered) covered++;
    else if (o < TOP) topUncovered++;
    if (best <= WIN) unbeaten.push({ o, best });
  }
  const wins = roleWins[0] + roleWins[1] + roleWins[2];
  const safeCounters = team[1].ratings.filter((r) => r[1] < HARD_COUNTER).length;
  const coverage = (covered / metaSize) * 100;
  const consistency = wins === 0 ? 0 : (consistent / wins) * 100;
  const safety = Math.max(0, 100 - 20 * safeCounters - 10 * topUncovered);
  return {
    order: [team[0].index, team[1].index, team[2].index],
    score: 0.5 * coverage + 0.25 * consistency + 0.25 * safety,
    coverage, consistency, safety, covered, roleWins, safeCounters, topUncovered,
    // Stable sort: equal ratings stay in meta order.
    threats: unbeaten.sort((a, b) => a.best - b.best).map((t) => t.o),
  };
}

/**
 * The best `limit` teams of three from `candidates` (in roster order) that contain every pinned roster index,
 * never two of the same Pokédex number, each in its best order. Ties keep roster order.
 */
export function recommendTeams(candidates: readonly Candidate[], pins: readonly number[], limit = 10): TeamScore[] {
  const teams: TeamScore[] = [];
  const n = candidates.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let k = j + 1; k < n; k++) {
        const members = [candidates[i]!, candidates[j]!, candidates[k]!] as const;
        if (new Set(members.map((m) => m.dex)).size < 3) continue;
        if (!pins.every((p) => members.some((m) => m.index === p))) continue;
        let best: TeamScore | undefined;
        for (const [a, b, c] of ORDERS) {
          const s = scoreOrder([members[a], members[b], members[c]]);
          if (!best || s.score > best.score) best = s;
        }
        teams.push(best!);
      }
    }
  }
  return teams.sort((a, b) => b.score - a.score).slice(0, limit);
}
