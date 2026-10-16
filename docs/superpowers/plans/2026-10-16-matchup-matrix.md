# Matchup Matrix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a committed meta × meta matchup matrix (top 150 supported Great League Pokémon, all 9 shield scenarios) and a browser-safe function that computes the same matrix for the user's own Pokémon on demand.

**Architecture:** A new browser-safe module `src/matrix/` has five parts: meta selection (`meta.ts`), one pair's 9-scenario simulation (`cell.ts`), roster rows (`teamMatrix.ts`), summaries (`summary.ts`), and the data file format (`matrixData.ts`, `batch.ts`). Node scripts do the I/O: `scripts/gen-matrix.ts` writes `data/matrix-1500.json` and `reports/matrix-report.md`, and `scripts/matrix.ts` is the debug CLI. Every rating comes from `simulateCell`, so the batch and the team path cannot drift apart.

**Tech Stack:** TypeScript 5.6 (strict, `noUncheckedIndexedAccess`), Node ≥ 20, tsx, vitest 2.

**Spec:** `docs/superpowers/specs/2026-10-16-matchup-matrix-design.md`

## Global Constraints

- Everything in `src/` must pass `npm run typecheck:browser` (no Node APIs, no `node:` imports). File I/O lives only in `scripts/` and `src/data/node.ts`.
- Meta = top **150** supported Pokémon from `data/rankings-1500.json`, ranking movesets, PvPoke default Great League IVs.
- All **9 shield scenarios**, `cell[aShields][bShields]`, shields 0–2. Default start energy. `PvPokeLikePolicy`, with a fresh instance per side per battle.
- Ratings are PvPoke battle ratings: integers 0–1000, 500 = even. Win = rating > 500, loss = rating < 500, exactly 500 = neither.
- Every ordered pair `(a, b)` is simulated, including `a === b`. Symmetry is never assumed.
- Only `UnsupportedPokemonError` and `GameDataError` exclude a meta candidate. Every other error propagates.
- Roster errors are never skipped: the first invalid entry throws `RosterError` before anything is simulated.
- Committed data file: `data/matrix-1500.json`, compact JSON (no indentation), with `upstream` equal to `data/UPSTREAM`.
- Repo conventions: strict types, a one-sentence docstring on every exported function, comments only on non-obvious logic, commit prefixes `feat:`/`test:`/`docs:`/`chore:`. Work on branch `feat/tvanmook/matchup-matrix/20261016`, never `main`.
- `npm test` and `npm run typecheck` must both pass before the work is called done.

### Small, deliberate refinements of the spec (record them in the spec in Task 6)
- `simulateCell` takes an optional `{ maxTurns }` so the turn-limit error path can be tested.
- The pure batch logic (`buildMatrixFile`, `mirrorMismatches`) lives in `src/matrix/batch.ts` so it can be tested at a small meta size. The script only does I/O.
- `parseRoster` (roster JSON → `RosterEntry[]`) lives in `src/matrix/teamMatrix.ts` so the web app can reuse it.
- `gen-matrix --size N` with N ≠ 150 writes to `.cache/matrix-1500-<N>.json` (gitignored), never over the committed file, and writes no report.
- `MatrixRow` and the `Cell` helpers live in `cell.ts`. `metaCombatant` lives in `meta.ts`.

## Review Focus

1. **Two of the same species in one roster** (e.g. two Melmetals with different IVs): both rows come back, in roster order, each with its own label. Pinned in Task 3.
2. **A roster Pokémon with only one charged move**: it is accepted and simulated, as in the game. Pinned in Task 3.
3. **A shadow Pokémon in the roster** (`quagsire_shadow`): it builds with shadow stats and matches a direct `simulateCell`. Pinned in Task 3.
4. **An empty roster**: returns `[]` rather than throwing. The web app starts with nothing entered. Pinned in Task 3.
5. **A roster level that isn't a half-level** (e.g. `20.3`): `RosterError` naming the entry, not a crash deep in the CPM table. Pinned in Task 3.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/errors.ts` (modify) | Add `RosterError`. |
| `src/matrix/meta.ts` (create) | `RankingRow`, `MetaEntry`, `ExcludedEntry`, `Meta`, `buildMeta`, `metaCombatant`. |
| `src/matrix/cell.ts` (create) | `Cell`, `CellRow`, `MatrixRow`, `cellFrom`, `simulateCell`. |
| `src/matrix/teamMatrix.ts` (create) | `RosterEntry`, `parseRoster`, `teamMatrix`. |
| `src/matrix/summary.ts` (create) | `RowSummary`, `summarize`. |
| `src/matrix/matrixData.ts` (create) | `MatrixFile`, `parseMatrixFile`, `metaRow`. |
| `src/matrix/batch.ts` (create) | `buildMatrixFile`, `MirrorMismatch`, `mirrorMismatches`. |
| `src/matrix/index.ts` (create) | Browser-safe barrel re-exporting the above. |
| `scripts/oracle/meta.ts` (modify) | `metaSpecies` reimplemented on `buildMeta`. Same output. |
| `scripts/gen-matrix.ts` (create) | Batch I/O: writes `data/matrix-1500.json` and `reports/matrix-report.md`. |
| `scripts/matrix.ts` (create) | Debug CLI. |
| `scripts/sim.ts` (modify) | Export `arg` and `parseShields` for reuse. |
| `package.json` (modify) | `gen-matrix` and `matrix` scripts. |
| `data/matrix-1500.json`, `reports/matrix-report.md` (generated, committed) | The matrix and its run report. |
| `tests/matrixMeta.test.ts`, `tests/matrixCell.test.ts`, `tests/teamMatrix.test.ts`, `tests/matrixSummaryData.test.ts`, `tests/matrixBatch.test.ts`, `tests/matrixCommitted.test.ts`, `tests/matrixCli.test.ts` (create) | Tests. |
| `README.md`, spec docs (modify) | Docs. |

---

### Task 1: Meta selection (`buildMeta`) and the oracle refactor

**Files:**
- Create: `src/matrix/meta.ts`, `src/matrix/index.ts`
- Modify: `scripts/oracle/meta.ts` (whole file)
- Test: `tests/matrixMeta.test.ts`

**Interfaces:**
- Consumes: `buildCombatant(gd, spec): Combatant` and `Combatant.{ivs, level, cp}` (`src/engine/combatant.ts`); `GameDataError`, `UnsupportedPokemonError` (`src/errors.ts`); `Ivs` (`src/stats/stats.ts`).
- Produces:
  ```ts
  interface RankingRow { readonly speciesId: string; readonly moveset: readonly string[] }
  interface MetaEntry { readonly speciesId: string; readonly moveset: readonly [string, ...string[]]; readonly ivs: Ivs; readonly level: number; readonly cp: number }
  interface ExcludedEntry { readonly speciesId: string; readonly reason: string }
  interface Meta { readonly entries: readonly MetaEntry[]; readonly excluded: readonly ExcludedEntry[] }
  function buildMeta(gd: GameData, rankings: readonly RankingRow[], count: number): Meta
  function metaCombatant(gd: GameData, entry: MetaEntry): Combatant
  ```

- [ ] **Step 1: Write the failing tests**

`tests/matrixMeta.test.ts`:
```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { metaSpecies } from '../scripts/oracle/meta';
import { loadDefaultGameData } from '../src/data/node';
import type { GameData } from '../src/data/types';
import { buildCombatant } from '../src/engine/combatant';
import { GameDataError } from '../src/errors';
import { buildMeta, metaCombatant, type RankingRow } from '../src/matrix/meta';

const gd = loadDefaultGameData();
const rankings: RankingRow[] = JSON.parse(readFileSync('data/rankings-1500.json', 'utf8'));
const row = (id: string): RankingRow => rankings.find((r) => r.speciesId === id)!;

describe('buildMeta', () => {
  it('keeps the first `count` supported Pokémon in ranking order with their default IVs', () => {
    const meta = buildMeta(gd, rankings, 5);
    expect(meta.entries).toHaveLength(5);
    expect(meta.entries[0]!.speciesId).toBe('melmetal');
    const m = meta.entries[0]!;
    const built = buildCombatant(gd, { speciesId: 'melmetal', fastMoveId: m.moveset[0], chargedMoveIds: m.moveset.slice(1) });
    expect(m.moveset).toEqual(row('melmetal').moveset);
    expect(m.ivs).toEqual({ atk: built.ivs.atk, def: built.ivs.def, hp: built.ivs.hp });
    expect(m.level).toBe(built.level);
    expect(m.cp).toBe(built.cp);
  });

  it('excludes unsupported Pokémon and records why', () => {
    const meta = buildMeta(gd, [row('cramorant'), row('melmetal'), row('azumarill')], 2);
    expect(meta.entries.map((e) => e.speciesId)).toEqual(['melmetal', 'azumarill']);
    expect(meta.excluded).toHaveLength(1);
    expect(meta.excluded[0]!.speciesId).toBe('cramorant');
    expect(meta.excluded[0]!.reason).toMatch(/^UnsupportedPokemonError: /);
  });

  it('only lists exclusions met before the meta was full', () => {
    // cramorant is 4th in the rankings; a 3-entry meta never reaches it.
    expect(rankings[3]!.speciesId).toBe('cramorant');
    expect(buildMeta(gd, rankings, 3).excluded).toEqual([]);
    expect(buildMeta(gd, rankings, 5).excluded.map((e) => e.speciesId)).toContain('cramorant');
  });

  it('rethrows errors other than unsupported/bad data', () => {
    const broken = { ...gd, species: { get: () => { throw new TypeError('boom'); }, has: () => true, values: () => gd.species.values() } } as unknown as GameData;
    expect(() => buildMeta(broken, [row('melmetal')], 1)).toThrow(TypeError);
  });

  it('rejects a malformed ranking moveset instead of excluding it', () => {
    expect(() => buildMeta(gd, [{ speciesId: 'melmetal', moveset: ['THUNDER_SHOCK'] }], 1)).toThrow(GameDataError);
    expect(() => buildMeta(gd, [{ speciesId: 'melmetal', moveset: ['THUNDER_SHOCK'] }], 1)).toThrow(/melmetal: malformed ranking moveset/);
  });

  it('rejects a non-positive count and a rankings list that runs out', () => {
    expect(() => buildMeta(gd, rankings, 0)).toThrow(RangeError);
    expect(() => buildMeta(gd, [row('melmetal')], 2)).toThrow(/Only 1 supported Pokémon in the rankings; asked for 2/);
  });
});

describe('metaCombatant', () => {
  it('rebuilds the same combatant from the stored entry', () => {
    const m = buildMeta(gd, rankings, 1).entries[0]!;
    const c = metaCombatant(gd, m);
    expect(c.species.id).toBe('melmetal');
    expect([c.ivs.atk, c.ivs.def, c.ivs.hp, c.level, c.cp]).toEqual([m.ivs.atk, m.ivs.def, m.ivs.hp, m.level, m.cp]);
  });
});

describe('oracle metaSpecies (now built on buildMeta)', () => {
  it('still selects exactly the top-100 set the committed oracle fixture was built from', () => {
    const fixture = JSON.parse(readFileSync('tests/fixtures/oracle-gl.json', 'utf8')) as { cases: { a: { speciesId: string; moveset: string[] } }[] };
    const fromFixture = [...new Map(fixture.cases.map((c) => [c.a.speciesId, c.a.moveset])).entries()];
    const ours = metaSpecies(gd, 100).map((m) => [m.speciesId, m.moveset]);
    expect(ours).toEqual(fromFixture);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run tests/matrixMeta.test.ts`
Expected: FAIL, `Failed to resolve import "../src/matrix/meta"`.

- [ ] **Step 3: Implement `src/matrix/meta.ts`**

```ts
import type { GameData } from '../data/types';
import { buildCombatant, type Combatant } from '../engine/combatant';
import { GameDataError, UnsupportedPokemonError } from '../errors';
import type { Ivs } from '../stats/stats';

/** One row of PvPoke's rankings JSON, as far as the matrix needs it. */
export interface RankingRow {
  readonly speciesId: string;
  readonly moveset: readonly string[];
}

/** A meta Pokémon exactly as simulated: species, moves, and the IVs/level PvPoke uses by default. */
export interface MetaEntry {
  readonly speciesId: string;
  /** [fast, charged1, charged2?] */
  readonly moveset: readonly [string, ...string[]];
  readonly ivs: Ivs;
  readonly level: number;
  readonly cp: number;
}

export interface ExcludedEntry {
  readonly speciesId: string;
  /** "<ErrorName>: <message>" */
  readonly reason: string;
}

export interface Meta {
  readonly entries: readonly MetaEntry[];
  readonly excluded: readonly ExcludedEntry[];
}

function rowMoveset(row: RankingRow): readonly [string, ...string[]] {
  const ms = row.moveset as unknown;
  if (!Array.isArray(ms) || ms.length < 2 || ms.some((m) => typeof m !== 'string' || m === '')) {
    throw new GameDataError(`${row.speciesId}: malformed ranking moveset ${JSON.stringify(ms)}`);
  }
  return ms as [string, ...string[]];
}

/** Pick the first `count` Pokémon in ranking order that the engine supports, recording the ones it skipped. */
export function buildMeta(gd: GameData, rankings: readonly RankingRow[], count: number): Meta {
  if (!Number.isInteger(count) || count < 1) throw new RangeError(`Meta size must be a positive integer, got ${count}`);
  const entries: MetaEntry[] = [];
  const excluded: ExcludedEntry[] = [];
  for (const row of rankings) {
    if (entries.length >= count) break;
    // A malformed row is a data bug, not an unsupported Pokémon, so it is checked outside the try.
    const moveset = rowMoveset(row);
    try {
      const [fastMoveId, ...chargedMoveIds] = moveset;
      const c = buildCombatant(gd, { speciesId: row.speciesId, fastMoveId, chargedMoveIds });
      entries.push({ speciesId: row.speciesId, moveset, ivs: { atk: c.ivs.atk, def: c.ivs.def, hp: c.ivs.hp }, level: c.level, cp: c.cp });
    } catch (err) {
      if (!(err instanceof UnsupportedPokemonError || err instanceof GameDataError)) throw err;
      excluded.push({ speciesId: row.speciesId, reason: `${err.name}: ${err.message}` });
    }
  }
  if (entries.length < count) throw new GameDataError(`Only ${entries.length} supported Pokémon in the rankings; asked for ${count}`);
  return { entries, excluded };
}

/** Build the battle-ready combatant for a stored meta entry. */
export function metaCombatant(gd: GameData, entry: MetaEntry): Combatant {
  const [fastMoveId, ...chargedMoveIds] = entry.moveset;
  return buildCombatant(gd, { speciesId: entry.speciesId, fastMoveId, chargedMoveIds, ivs: entry.ivs, level: entry.level });
}
```

`src/matrix/index.ts` (later tasks add their lines to it):
```ts
// Browser-safe barrel for the matchup matrix.
export * from './meta';
```

- [ ] **Step 4: Rewrite `scripts/oracle/meta.ts` on top of `buildMeta`**

```ts
import { readFileSync } from 'node:fs';
import type { GameData } from '../../src/data/types';
import { buildMeta, type RankingRow } from '../../src/matrix/meta';
import type { OracleMon } from './harness';

/** Top `count` ranked Great League Pokémon (with ranking movesets) that this engine supports. */
export function metaSpecies(gd: GameData, count: number): OracleMon[] {
  const rankings: RankingRow[] = JSON.parse(readFileSync('data/rankings-1500.json', 'utf8'));
  const meta = buildMeta(gd, rankings, count);
  // Unsupported (Aegislash, Cramorant, megas, etc.) are excluded from the oracle set by design (engine spec §10).
  for (const e of meta.excluded) console.error(`excluded ${e.speciesId}: ${e.reason}`);
  return meta.entries.map((e) => ({ speciesId: e.speciesId, moveset: [...e.moveset] }));
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npx vitest run tests/matrixMeta.test.ts`
Expected: PASS (all tests). If the cramorant reason isn't `UnsupportedPokemonError`, check `buildCombatant` with cramorant's ranking moveset. The test reflects the spec (Cramorant is unsupported), so fix the understanding, not the test.

- [ ] **Step 6: Typecheck and commit**

Run: `npm run typecheck`
Expected: no errors.

```bash
git add src/matrix/meta.ts src/matrix/index.ts scripts/oracle/meta.ts tests/matrixMeta.test.ts
git commit -m "feat: buildMeta selects the supported top-N meta from PvPoke rankings; oracle metaSpecies uses it"
```

---

### Task 2: One pair, nine scenarios (`simulateCell`)

**Files:**
- Create: `src/matrix/cell.ts`
- Modify: `src/matrix/index.ts`
- Test: `tests/matrixCell.test.ts`

**Interfaces:**
- Consumes: `runMatchup(gd, a, b, { shields, policies, maxTurns? }): MatchupResult` (`src/sim/runMatchup.ts`); `PvPokeLikePolicy` (`src/policy/pvpoke`); `TurnLimitError(message, events)` (`src/errors.ts`).
- Produces:
  ```ts
  type CellRow = readonly [number, number, number];
  type Cell = readonly [CellRow, CellRow, CellRow];          // cell[aShields][bShields] = a's rating
  interface MatrixRow { readonly id: string; readonly cells: readonly Cell[] } // cells[j] = vs meta j
  function cellFrom(f: (aShields: number, bShields: number) => number): Cell
  function simulateCell(gd: GameData, a: Combatant, b: Combatant, options?: { readonly maxTurns?: number }): Cell
  ```

- [ ] **Step 1: Write the failing tests**

`tests/matrixCell.test.ts`:
```ts
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
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run tests/matrixCell.test.ts`
Expected: FAIL, `Failed to resolve import "../src/matrix/cell"`.

- [ ] **Step 3: Implement `src/matrix/cell.ts`**

```ts
import type { GameData } from '../data/types';
import type { Combatant } from '../engine/combatant';
import { TurnLimitError } from '../errors';
import { PvPokeLikePolicy } from '../policy/pvpoke';
import { runMatchup } from '../sim/runMatchup';

export type CellRow = readonly [number, number, number];
/** cell[aShields][bShields]: a's battle rating (0-1000) against b with that many shields each. */
export type Cell = readonly [CellRow, CellRow, CellRow];

/** One Pokémon's ratings against a list of opponents (cells[j] is against opponent j). */
export interface MatrixRow {
  readonly id: string;
  readonly cells: readonly Cell[];
}

/** Build a cell by calling `f` for every [aShields][bShields] scenario. */
export function cellFrom(f: (aShields: number, bShields: number) => number): Cell {
  const row = (sa: number): CellRow => [f(sa, 0), f(sa, 1), f(sa, 2)];
  return [row(0), row(1), row(2)];
}

function rate(gd: GameData, a: Combatant, b: Combatant, shields: [number, number], maxTurns: number | undefined): number {
  try {
    // Policies keep per-battle state (trace), so each battle gets fresh ones.
    return runMatchup(gd, a, b, { shields, maxTurns, policies: [new PvPokeLikePolicy(), new PvPokeLikePolicy()] }).ratings[0];
  } catch (err) {
    if (err instanceof TurnLimitError) {
      throw new TurnLimitError(`${a.species.id} vs ${b.species.id} at ${shields[0]}-${shields[1]}: ${err.message}`, err.events);
    }
    throw err;
  }
}

/** Simulate a against b in all 9 shield scenarios and return a's ratings. */
export function simulateCell(gd: GameData, a: Combatant, b: Combatant, options: { readonly maxTurns?: number } = {}): Cell {
  return cellFrom((sa, sb) => rate(gd, a, b, [sa, sb], options.maxTurns));
}
```

Add to `src/matrix/index.ts`:
```ts
export * from './cell';
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run tests/matrixCell.test.ts`
Expected: PASS. The oracle test runs about 45k sims, roughly 15 s.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck`
Expected: no errors.

```bash
git add src/matrix/cell.ts src/matrix/index.ts tests/matrixCell.test.ts
git commit -m "feat: simulateCell rates one pair in all 9 shield scenarios; exact against the PvPoke oracle"
```

---

### Task 3: The user's team against the meta (`teamMatrix`, `parseRoster`, `RosterError`)

**Files:**
- Modify: `src/errors.ts` (append `RosterError`), `src/matrix/index.ts`
- Create: `src/matrix/teamMatrix.ts`
- Test: `tests/teamMatrix.test.ts`

**Interfaces:**
- Consumes: `buildCombatant` (`src/engine/combatant.ts`); `MetaEntry`, `metaCombatant`, `buildMeta`, `RankingRow` (Task 1); `simulateCell`, `MatrixRow` (Task 2); `GameDataError`, `StatsError`, `UnsupportedPokemonError`.
- Produces:
  ```ts
  class RosterError extends Error   // src/errors.ts, name 'RosterError'
  interface RosterEntry { readonly speciesId: string; readonly fastMoveId: string; readonly chargedMoveIds: readonly string[]; readonly ivs?: Ivs; readonly level?: number; readonly label?: string }
  function parseRoster(json: unknown): RosterEntry[]
  function teamMatrix(gd: GameData, roster: readonly RosterEntry[], meta: readonly MetaEntry[]): MatrixRow[]
  ```

- [ ] **Step 1: Write the failing tests**

`tests/teamMatrix.test.ts`:
```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadDefaultGameData } from '../src/data/node';
import { buildCombatant } from '../src/engine/combatant';
import { RosterError } from '../src/errors';
import { simulateCell } from '../src/matrix/cell';
import { buildMeta, metaCombatant, type RankingRow } from '../src/matrix/meta';
import { parseRoster, teamMatrix, type RosterEntry } from '../src/matrix/teamMatrix';

const gd = loadDefaultGameData();
const rankings: RankingRow[] = JSON.parse(readFileSync('data/rankings-1500.json', 'utf8'));
const meta = buildMeta(gd, rankings, 3).entries;
const fromRankings = (id: string, extra: Partial<RosterEntry> = {}): RosterEntry => {
  const [fastMoveId, ...chargedMoveIds] = rankings.find((r) => r.speciesId === id)!.moveset;
  return { speciesId: id, fastMoveId: fastMoveId!, chargedMoveIds, ...extra };
};
const expectedRow = (entry: RosterEntry) => {
  const c = buildCombatant(gd, { speciesId: entry.speciesId, fastMoveId: entry.fastMoveId, chargedMoveIds: entry.chargedMoveIds, ivs: entry.ivs, level: entry.level });
  return meta.map((m) => simulateCell(gd, c, metaCombatant(gd, m)));
};

describe('teamMatrix', () => {
  it('simulates each roster Pokémon, with its own IVs, against every meta entry in order', () => {
    const mine = fromRankings('azumarill', { ivs: { atk: 0, def: 15, hp: 15 } });
    const rows = teamMatrix(gd, [mine], meta);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe('azumarill');
    expect(rows[0]!.cells).toEqual(expectedRow(mine));
  });

  it('uses the label as the row id', () => {
    expect(teamMatrix(gd, [fromRankings('azumarill', { label: 'Azu (mine)' })], meta)[0]!.id).toBe('Azu (mine)');
  });

  it('keeps two of the same species as separate rows in roster order', () => {
    const a = fromRankings('melmetal', { ivs: { atk: 0, def: 15, hp: 15 }, label: 'Mel A' });
    const b = fromRankings('melmetal', { ivs: { atk: 15, def: 15, hp: 15 }, label: 'Mel B' });
    const rows = teamMatrix(gd, [a, b], meta);
    expect(rows.map((r) => r.id)).toEqual(['Mel A', 'Mel B']);
    expect(rows[0]!.cells).toEqual(expectedRow(a));
    expect(rows[1]!.cells).toEqual(expectedRow(b));
  });

  it('accepts a Pokémon with only one charged move', () => {
    const one = fromRankings('azumarill', { chargedMoveIds: ['ICE_BEAM'] });
    expect(teamMatrix(gd, [one], meta)[0]!.cells).toEqual(expectedRow(one));
  });

  it('handles a shadow Pokémon', () => {
    const shadow = fromRankings('quagsire_shadow');
    expect(teamMatrix(gd, [shadow], meta)[0]!.cells).toEqual(expectedRow(shadow));
  });

  it('returns no rows for an empty roster', () => {
    expect(teamMatrix(gd, [], meta)).toEqual([]);
  });

  it.each([
    ['an unknown species', { speciesId: 'nope', fastMoveId: 'BUBBLE', chargedMoveIds: ['ICE_BEAM'] }, /Unknown species nope/],
    ['an illegal move', { speciesId: 'azumarill', fastMoveId: 'COUNTER', chargedMoveIds: ['ICE_BEAM'] }, /cannot learn fast move COUNTER/],
    ['invalid IVs', { ...fromRankings('azumarill'), ivs: { atk: 16, def: 0, hp: 0 } }, /IVs must be integers 0-15/],
    ['CP over the cap', { ...fromRankings('melmetal'), level: 40 }, /over the 1500 cap/],
    ['a level that is not a half-level', { ...fromRankings('azumarill'), level: 20.3 }, /not a valid half-level/],
    ['an unsupported species', fromRankings('cramorant'), /cramorant/],
  ] as [string, RosterEntry, RegExp][])('rejects %s with a RosterError naming the entry', (_name, bad, message) => {
    const run = () => teamMatrix(gd, [fromRankings('azumarill'), bad], meta);
    expect(run).toThrow(RosterError);
    expect(run).toThrow(/^Roster entry 1 \(/);
    expect(run).toThrow(message);
  });
});

describe('parseRoster', () => {
  it('accepts a well-formed roster', () => {
    const json = [{ speciesId: 'azumarill', fastMoveId: 'BUBBLE', chargedMoveIds: ['ICE_BEAM', 'PLAY_ROUGH'], ivs: { atk: 0, def: 15, hp: 15 }, label: 'Azu' }];
    expect(parseRoster(json)).toEqual(json);
  });

  it.each([
    ['not an array', { speciesId: 'azumarill' }, /Roster must be a JSON array/],
    ['an entry without speciesId', [{ fastMoveId: 'BUBBLE', chargedMoveIds: ['ICE_BEAM'] }], /Roster entry 0: speciesId/],
    ['chargedMoveIds not a string array', [{ speciesId: 'azumarill', fastMoveId: 'BUBBLE', chargedMoveIds: 'ICE_BEAM' }], /Roster entry 0: chargedMoveIds/],
    ['ivs missing a stat', [{ ...fromRankings('azumarill'), ivs: { atk: 1, def: 2 } }], /Roster entry 0: ivs/],
    ['a non-numeric level', [{ ...fromRankings('azumarill'), level: '20' }], /Roster entry 0: level/],
  ])('rejects %s', (_name, json, message) => {
    expect(() => parseRoster(json)).toThrow(RosterError);
    expect(() => parseRoster(json)).toThrow(message);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run tests/teamMatrix.test.ts`
Expected: FAIL, `Failed to resolve import "../src/matrix/teamMatrix"`.

- [ ] **Step 3: Add `RosterError` to `src/errors.ts`** (append at the end)

```ts
/** Raised for a roster entry that is malformed or can't be built (unknown species, illegal move, bad IVs, over the CP cap, unsupported). */
export class RosterError extends Error {
  override name = 'RosterError';
}
```

- [ ] **Step 4: Implement `src/matrix/teamMatrix.ts`**

```ts
import type { GameData } from '../data/types';
import { buildCombatant, type Combatant } from '../engine/combatant';
import { GameDataError, RosterError, StatsError, UnsupportedPokemonError } from '../errors';
import type { Ivs } from '../stats/stats';
import { simulateCell, type MatrixRow } from './cell';
import { metaCombatant, type MetaEntry } from './meta';

/** One of the user's own Pokémon. */
export interface RosterEntry {
  readonly speciesId: string;
  readonly fastMoveId: string;
  readonly chargedMoveIds: readonly string[];
  /** Default: the species' default Great League IVs. */
  readonly ivs?: Ivs;
  /** Default: the highest level under 1500 CP for these IVs. */
  readonly level?: number;
  /** Display name, e.g. "Melmetal (my 0/15/14)"; the row id. */
  readonly label?: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string');

/** Check that parsed JSON has the shape of a roster; building the Pokémon is teamMatrix's job. */
export function parseRoster(json: unknown): RosterEntry[] {
  if (!Array.isArray(json)) throw new RosterError('Roster must be a JSON array of entries');
  return json.map((v, i): RosterEntry => {
    const bad = (field: string, expected: string): never => {
      throw new RosterError(`Roster entry ${i}: ${field} must be ${expected}`);
    };
    if (!isRecord(v)) return bad('the entry', 'an object');
    if (typeof v.speciesId !== 'string' || v.speciesId === '') bad('speciesId', 'a non-empty string');
    if (typeof v.fastMoveId !== 'string' || v.fastMoveId === '') bad('fastMoveId', 'a non-empty string');
    if (!isStringArray(v.chargedMoveIds)) bad('chargedMoveIds', 'an array of move ids');
    const ivs = v.ivs;
    if (ivs !== undefined && !(isRecord(ivs) && ['atk', 'def', 'hp'].every((k) => typeof ivs[k] === 'number'))) bad('ivs', 'an object with numeric atk, def and hp');
    if (v.level !== undefined && typeof v.level !== 'number') bad('level', 'a number');
    if (v.label !== undefined && typeof v.label !== 'string') bad('label', 'a string');
    return v as unknown as RosterEntry;
  });
}

function buildRosterEntry(gd: GameData, entry: RosterEntry, index: number): Combatant {
  try {
    return buildCombatant(gd, {
      speciesId: entry.speciesId, fastMoveId: entry.fastMoveId, chargedMoveIds: entry.chargedMoveIds, ivs: entry.ivs, level: entry.level,
    });
  } catch (err) {
    if (!(err instanceof GameDataError || err instanceof StatsError || err instanceof UnsupportedPokemonError)) throw err;
    throw new RosterError(`Roster entry ${index} (${entry.label ?? entry.speciesId}): ${err.message}`, { cause: err });
  }
}

/** Simulate each roster Pokémon against every meta entry in all 9 shield scenarios. */
export function teamMatrix(gd: GameData, roster: readonly RosterEntry[], meta: readonly MetaEntry[]): MatrixRow[] {
  // Build everything first so a bad entry fails before any simulation runs.
  const mine = roster.map((entry, i) => buildRosterEntry(gd, entry, i));
  const opponents = meta.map((m) => metaCombatant(gd, m));
  return mine.map((c, i) => ({
    id: roster[i]!.label ?? roster[i]!.speciesId,
    cells: opponents.map((o) => simulateCell(gd, c, o)),
  }));
}
```

Add to `src/matrix/index.ts`:
```ts
export * from './teamMatrix';
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npx vitest run tests/teamMatrix.test.ts`
Expected: PASS. If the cramorant case's message doesn't contain "cramorant", look at the actual `UnsupportedPokemonError` text. The `Roster entry 1 (cramorant)` prefix always contains it, so this should pass.

- [ ] **Step 6: Typecheck and commit**

Run: `npm run typecheck`
Expected: no errors (the `{ cause }` option needs ES2022 lib, which both tsconfigs have).

```bash
git add src/errors.ts src/matrix/teamMatrix.ts src/matrix/index.ts tests/teamMatrix.test.ts
git commit -m "feat: teamMatrix simulates the user's own Pokémon against the meta; RosterError and parseRoster"
```

---

### Task 4: Summaries and the matrix file format (`summarize`, `parseMatrixFile`, `metaRow`)

**Files:**
- Create: `src/matrix/summary.ts`, `src/matrix/matrixData.ts`
- Modify: `src/matrix/index.ts`
- Test: `tests/matrixSummaryData.test.ts`

**Interfaces:**
- Consumes: `Cell`, `CellRow`, `MatrixRow`, `cellFrom` (Task 2); `MetaEntry`, `ExcludedEntry` (Task 1); `GameDataError`.
- Produces:
  ```ts
  interface RowSummary { readonly average: Cell; readonly wins: Cell; readonly losses: Cell }
  function summarize(row: MatrixRow): RowSummary
  interface MatrixFile {
    readonly upstream: string;
    readonly generatedWith: { readonly metaSize: number; readonly policy: 'pvpoke'; readonly startEnergy: readonly [number, number] };
    readonly meta: readonly MetaEntry[];
    readonly excluded: readonly ExcludedEntry[];
    readonly ratings: readonly (readonly Cell[])[];   // ratings[a][b][aShields][bShields]
  }
  function parseMatrixFile(json: unknown): MatrixFile
  function metaRow(file: MatrixFile, speciesId: string): MatrixRow
  ```

- [ ] **Step 1: Write the failing tests**

`tests/matrixSummaryData.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { GameDataError } from '../src/errors';
import { cellFrom, type Cell } from '../src/matrix/cell';
import { metaRow, parseMatrixFile, type MatrixFile } from '../src/matrix/matrixData';
import { summarize } from '../src/matrix/summary';

const flat = (r: number): Cell => cellFrom(() => r);

describe('summarize', () => {
  it('averages per scenario (rounded) and counts wins >500 and losses <500; 500 is neither', () => {
    const s = summarize({ id: 'x', cells: [flat(700), flat(500), flat(301)] });
    expect(s.average).toEqual(flat(500)); // (700+500+301)/3 = 500.33
    expect(s.wins).toEqual(flat(1));
    expect(s.losses).toEqual(flat(1));
  });

  it('keeps scenarios separate', () => {
    const s = summarize({ id: 'x', cells: [cellFrom((sa, sb) => (sa > sb ? 800 : 200))] });
    expect(s.average[2][0]).toBe(800);
    expect(s.average[0][2]).toBe(200);
    expect(s.wins[1][0]).toBe(1);
    expect(s.losses[1][1]).toBe(1);
  });

  it('rejects a row with no opponents', () => {
    expect(() => summarize({ id: 'x', cells: [] })).toThrow(RangeError);
  });
});

const entry = (speciesId: string) => ({ speciesId, moveset: ['A', 'B'], ivs: { atk: 1, def: 2, hp: 3 }, level: 20, cp: 1499 });
const validFile = (): MatrixFile => ({
  upstream: 'a'.repeat(40),
  generatedWith: { metaSize: 2, policy: 'pvpoke', startEnergy: [0, 0] },
  meta: [entry('x'), entry('y')] as unknown as MatrixFile['meta'],
  excluded: [{ speciesId: 'z', reason: 'UnsupportedPokemonError: no' }],
  ratings: [[flat(500), flat(600)], [flat(400), flat(500)]],
});
const mutate = (f: (j: any) => void): unknown => {
  const j = JSON.parse(JSON.stringify(validFile()));
  f(j);
  return j;
};

describe('parseMatrixFile', () => {
  it('accepts a valid file', () => {
    expect(parseMatrixFile(JSON.parse(JSON.stringify(validFile())))).toEqual(validFile());
  });

  it.each([
    ['not an object', () => 5, /Matrix file: expected an object/],
    ['a bad upstream', () => mutate((j) => { j.upstream = 'abc'; }), /upstream/],
    ['a metaSize that disagrees with meta', () => mutate((j) => { j.generatedWith.metaSize = 3; }), /generatedWith\.metaSize/],
    ['a meta entry without moves', () => mutate((j) => { j.meta[1].moveset = ['A']; }), /meta\[1\]\.moveset/],
    ['a missing ratings row', () => mutate((j) => { j.ratings.pop(); }), /ratings: expected 2 rows/],
    ['a short ratings row', () => mutate((j) => { j.ratings[1].pop(); }), /ratings\[1\]: expected 2 cells/],
    ['a 2x3 cell', () => mutate((j) => { j.ratings[0][1].pop(); }), /ratings\[0\]\[1\]: expected a 3x3 array/],
    ['a rating above 1000', () => mutate((j) => { j.ratings[1][0][2][1] = 1001; }), /ratings\[1\]\[0\]\[2\]\[1\]: expected an integer 0-1000/],
    ['a fractional rating', () => mutate((j) => { j.ratings[0][0][0][0] = 1.5; }), /ratings\[0\]\[0\]\[0\]\[0\]/],
    ['excluded not an array', () => mutate((j) => { j.excluded = {}; }), /excluded/],
  ])('rejects %s with GameDataError naming the path', (_name, make, message) => {
    expect(() => parseMatrixFile(make())).toThrow(GameDataError);
    expect(() => parseMatrixFile(make())).toThrow(message);
  });
});

describe('metaRow', () => {
  it('returns a meta Pokémon\'s row', () => {
    expect(metaRow(validFile(), 'y')).toEqual({ id: 'y', cells: [flat(400), flat(500)] });
  });

  it('rejects a species not in the meta', () => {
    expect(() => metaRow(validFile(), 'bulbasaur')).toThrow(/bulbasaur is not in the matrix meta/);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run tests/matrixSummaryData.test.ts`
Expected: FAIL, `Failed to resolve import "../src/matrix/matrixData"`.

- [ ] **Step 3: Implement `src/matrix/summary.ts`**

```ts
import { cellFrom, type Cell, type MatrixRow } from './cell';

/** Per-scenario summary of one row: mean rating and how many opponents it beats or loses to. */
export interface RowSummary {
  readonly average: Cell;
  /** Opponents with rating > 500. */
  readonly wins: Cell;
  /** Opponents with rating < 500 (exactly 500 counts as neither). */
  readonly losses: Cell;
}

/** Summarise a row's ratings per shield scenario (no meta weighting). */
export function summarize(row: MatrixRow): RowSummary {
  if (row.cells.length === 0) throw new RangeError(`Row ${row.id} has no opponents to summarise`);
  const per = (f: (ratings: number[]) => number): Cell => cellFrom((sa, sb) => f(row.cells.map((c) => c[sa]![sb]!)));
  return {
    average: per((rs) => Math.round(rs.reduce((sum, r) => sum + r, 0) / rs.length)),
    wins: per((rs) => rs.filter((r) => r > 500).length),
    losses: per((rs) => rs.filter((r) => r < 500).length),
  };
}
```

- [ ] **Step 4: Implement `src/matrix/matrixData.ts`**

```ts
import { GameDataError } from '../errors';
import type { Cell, MatrixRow } from './cell';
import type { ExcludedEntry, MetaEntry } from './meta';

/** The committed meta × meta matrix (data/matrix-1500.json). */
export interface MatrixFile {
  /** PvPoke commit of the game data and rankings it was built from (data/UPSTREAM). */
  readonly upstream: string;
  readonly generatedWith: { readonly metaSize: number; readonly policy: 'pvpoke'; readonly startEnergy: readonly [number, number] };
  readonly meta: readonly MetaEntry[];
  readonly excluded: readonly ExcludedEntry[];
  /** ratings[a][b][aShields][bShields]: meta a's rating against meta b. */
  readonly ratings: readonly (readonly Cell[])[];
}

function fail(path: string, problem: string): never {
  throw new GameDataError(`Matrix file${path ? ` ${path}` : ''}: ${problem}`);
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function checkMetaEntry(v: unknown, path: string): void {
  if (!isRecord(v)) fail(path, 'expected an object');
  const { speciesId, moveset, ivs, level, cp } = v;
  if (typeof speciesId !== 'string' || speciesId === '') fail(`${path}.speciesId`, 'expected a non-empty string');
  if (!Array.isArray(moveset) || moveset.length < 2 || moveset.some((m) => typeof m !== 'string')) fail(`${path}.moveset`, 'expected [fast, charged, ...] move ids');
  if (!isRecord(ivs) || !['atk', 'def', 'hp'].every((k) => Number.isInteger(ivs[k]))) fail(`${path}.ivs`, 'expected integer atk, def and hp');
  if (typeof level !== 'number') fail(`${path}.level`, 'expected a number');
  if (!Number.isInteger(cp)) fail(`${path}.cp`, 'expected an integer');
}

function checkCell(v: unknown, path: string): void {
  if (!Array.isArray(v) || v.length !== 3 || v.some((row) => !Array.isArray(row) || row.length !== 3)) fail(path, 'expected a 3x3 array');
  (v as unknown[][]).forEach((row, sa) => row.forEach((r, sb) => {
    if (!Number.isInteger(r) || (r as number) < 0 || (r as number) > 1000) fail(`${path}[${sa}][${sb}]`, `expected an integer 0-1000, got ${JSON.stringify(r)}`);
  }));
}

/** Validate parsed JSON as a MatrixFile, naming the first offending path. */
export function parseMatrixFile(json: unknown): MatrixFile {
  if (!isRecord(json)) fail('', 'expected an object');
  const { upstream, generatedWith, meta, excluded, ratings } = json;
  if (typeof upstream !== 'string' || !/^[0-9a-f]{40}$/.test(upstream)) fail('upstream', 'expected a 40-character commit SHA');
  if (!Array.isArray(meta)) fail('meta', 'expected an array');
  meta.forEach((m, i) => checkMetaEntry(m, `meta[${i}]`));
  if (!isRecord(generatedWith) || generatedWith.metaSize !== meta.length) fail('generatedWith.metaSize', `expected ${meta.length} (the meta length)`);
  if (generatedWith.policy !== 'pvpoke') fail('generatedWith.policy', 'expected "pvpoke"');
  if (!Array.isArray(excluded) || excluded.some((e) => !isRecord(e) || typeof e.speciesId !== 'string' || typeof e.reason !== 'string')) {
    fail('excluded', 'expected an array of { speciesId, reason }');
  }
  if (!Array.isArray(ratings) || ratings.length !== meta.length) fail('ratings', `expected ${meta.length} rows`);
  ratings.forEach((row, a) => {
    if (!Array.isArray(row) || row.length !== meta.length) fail(`ratings[${a}]`, `expected ${meta.length} cells`);
    row.forEach((cell, b) => checkCell(cell, `ratings[${a}][${b}]`));
  });
  return json as unknown as MatrixFile;
}

/** Return a meta Pokémon's row (its ratings against every meta entry) from the matrix file. */
export function metaRow(file: MatrixFile, speciesId: string): MatrixRow {
  const i = file.meta.findIndex((m) => m.speciesId === speciesId);
  if (i === -1) throw new GameDataError(`${speciesId} is not in the matrix meta`);
  return { id: speciesId, cells: file.ratings[i]! };
}
```

Add to `src/matrix/index.ts`:
```ts
export * from './summary';
export * from './matrixData';
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npx vitest run tests/matrixSummaryData.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

Run: `npm run typecheck`
Expected: no errors. If TS doesn't narrow after a `fail(...)` call, check that `fail` is declared as a `function` with an explicit `: never` return type. Assertion-style narrowing needs that.

```bash
git add src/matrix/summary.ts src/matrix/matrixData.ts src/matrix/index.ts tests/matrixSummaryData.test.ts
git commit -m "feat: row summaries and the validated matrix file format"
```

---

### Task 5: The batch (`buildMatrixFile`, `mirrorMismatches`, `npm run gen-matrix`) and the committed matrix

**Files:**
- Create: `src/matrix/batch.ts`, `scripts/gen-matrix.ts`, `tests/matrixBatch.test.ts`, `tests/matrixCommitted.test.ts`
- Modify: `src/matrix/index.ts`, `package.json` (scripts)
- Generated and committed: `data/matrix-1500.json`, `reports/matrix-report.md`

**Interfaces:**
- Consumes: `buildMeta`, `metaCombatant`, `Meta` (Task 1); `simulateCell` (Task 2); `teamMatrix` (Task 3); `MatrixFile`, `parseMatrixFile`, `metaRow` (Task 4); `loadDefaultGameData` (`src/data/node.ts`).
- Produces:
  ```ts
  function buildMatrixFile(gd: GameData, meta: Meta, upstream: string, onRow?: (done: number, total: number) => void): MatrixFile
  interface MirrorMismatch { readonly a: string; readonly b: string; readonly shields: readonly [number, number]; readonly ab: number; readonly ba: number }
  function mirrorMismatches(file: MatrixFile, tolerance?: number): MirrorMismatch[]   // default tolerance 1
  // scripts/gen-matrix.ts
  const MATRIX_PATH = 'data/matrix-1500.json'; const DEFAULT_META_SIZE = 150;
  function readUpstream(): string
  function formatReport(file: MatrixFile, mismatches: readonly MirrorMismatch[], elapsedMs: number, date: string): string
  ```

- [ ] **Step 1: Write the failing batch tests**

`tests/matrixBatch.test.ts`:
```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { formatReport } from '../scripts/gen-matrix';
import { loadDefaultGameData } from '../src/data/node';
import { GameDataError } from '../src/errors';
import { buildMatrixFile, mirrorMismatches } from '../src/matrix/batch';
import { cellFrom, simulateCell } from '../src/matrix/cell';
import { parseMatrixFile, type MatrixFile } from '../src/matrix/matrixData';
import { buildMeta, metaCombatant, type RankingRow } from '../src/matrix/meta';

const gd = loadDefaultGameData();
const rankings: RankingRow[] = JSON.parse(readFileSync('data/rankings-1500.json', 'utf8'));
const upstream = readFileSync('data/UPSTREAM', 'utf8').trim();
const meta = buildMeta(gd, rankings, 4);

describe('buildMatrixFile', () => {
  const progress: number[] = [];
  const file = buildMatrixFile(gd, meta, upstream, (done) => progress.push(done));

  it('produces a valid file with every ordered pair, including self-pairs', () => {
    expect(parseMatrixFile(JSON.parse(JSON.stringify(file)))).toEqual(file);
    expect(file.generatedWith).toEqual({ metaSize: 4, policy: 'pvpoke', startEnergy: [0, 0] });
    expect(file.meta).toEqual(meta.entries);
    expect(file.excluded).toEqual(meta.excluded);
    const cs = meta.entries.map((e) => metaCombatant(gd, e));
    expect(file.ratings[2]![1]).toEqual(simulateCell(gd, cs[2]!, cs[1]!));
    expect(file.ratings[3]![3]).toEqual(simulateCell(gd, cs[3]!, cs[3]!));
  });

  it('reports progress once per row', () => {
    expect(progress).toEqual([1, 2, 3, 4]);
  });

  it('refuses an upstream that is not a commit SHA', () => {
    expect(() => buildMatrixFile(gd, meta, '')).toThrow(GameDataError);
    expect(() => buildMatrixFile(gd, meta, 'main')).toThrow(/data\/UPSTREAM must be a 40-character commit SHA/);
  });
});

describe('mirrorMismatches', () => {
  const two = (ab: number, ba: number): MatrixFile => ({
    upstream: 'a'.repeat(40),
    generatedWith: { metaSize: 2, policy: 'pvpoke', startEnergy: [0, 0] },
    meta: [{ speciesId: 'x' }, { speciesId: 'y' }] as unknown as MatrixFile['meta'],
    excluded: [],
    // x vs y is `ab` only at x=0 shields, y=2 shields; y vs x is `ba` only at y=2, x=0; all else 500.
    ratings: [
      [cellFrom(() => 500), cellFrom((sa, sb) => (sa === 0 && sb === 2 ? ab : 500))],
      [cellFrom((sa, sb) => (sa === 2 && sb === 0 ? ba : 500)), cellFrom(() => 500)],
    ],
  });

  it('pairs a[sa][sb] with b[sb][sa] and allows the 1-point floor gap', () => {
    expect(mirrorMismatches(two(700, 300))).toEqual([]);
    expect(mirrorMismatches(two(700, 299))).toEqual([]);
  });

  it('reports a pair that is off by more than the tolerance', () => {
    expect(mirrorMismatches(two(700, 250))).toEqual([{ a: 'x', b: 'y', shields: [0, 2], ab: 700, ba: 250 }]);
  });
});

describe('formatReport', () => {
  it('lists meta size, exclusions, timing and mismatch examples', () => {
    const file = buildMatrixFile(gd, buildMeta(gd, rankings, 1), upstream);
    const report = formatReport(
      { ...file, excluded: [{ speciesId: 'cramorant', reason: 'UnsupportedPokemonError: x' }] },
      [{ a: 'x', b: 'y', shields: [0, 2], ab: 700, ba: 250 }],
      61_000,
      '2026-10-16',
    );
    expect(report).toContain('# Matchup matrix report');
    expect(report).toContain('2026-10-16');
    expect(report).toContain('Meta size: 1');
    expect(report).toContain('cramorant: UnsupportedPokemonError: x');
    expect(report).toContain('61.0 s');
    expect(report).toContain('Mirror mismatches (off by more than 1): 1');
    expect(report).toContain('| x | y | 0-2 | 700 | 250 |');
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run tests/matrixBatch.test.ts`
Expected: FAIL, `Failed to resolve import "../scripts/gen-matrix"` (or `../src/matrix/batch`).

- [ ] **Step 3: Implement `src/matrix/batch.ts`**

```ts
import type { GameData } from '../data/types';
import { GameDataError } from '../errors';
import { simulateCell } from './cell';
import type { MatrixFile } from './matrixData';
import { metaCombatant, type Meta } from './meta';

/** A pair whose two sides' ratings in the mirrored scenario don't add up to 1000. */
export interface MirrorMismatch {
  readonly a: string;
  readonly b: string;
  readonly shields: readonly [number, number];
  /** a's rating vs b at shields [sa, sb]. */
  readonly ab: number;
  /** b's rating vs a at the mirrored shields [sb, sa]. */
  readonly ba: number;
}

/** Simulate every ordered pair of the meta (self-pairs included) into a MatrixFile. */
export function buildMatrixFile(gd: GameData, meta: Meta, upstream: string, onRow?: (done: number, total: number) => void): MatrixFile {
  if (!/^[0-9a-f]{40}$/.test(upstream)) throw new GameDataError(`data/UPSTREAM must be a 40-character commit SHA, got "${upstream}"`);
  const combatants = meta.entries.map((e) => metaCombatant(gd, e));
  const ratings = combatants.map((a, i) => {
    const row = combatants.map((b) => simulateCell(gd, a, b));
    onRow?.(i + 1, combatants.length);
    return row;
  });
  return {
    upstream,
    generatedWith: { metaSize: meta.entries.length, policy: 'pvpoke', startEnergy: [0, 0] },
    meta: meta.entries,
    excluded: meta.excluded,
    ratings,
  };
}

/** List mirrored cells whose ratings differ from summing to 1000 by more than `tolerance` (ratings are floored, so 1 is normal). */
export function mirrorMismatches(file: MatrixFile, tolerance = 1): MirrorMismatch[] {
  const out: MirrorMismatch[] = [];
  const n = file.meta.length;
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      for (let sa = 0; sa < 3; sa++) {
        for (let sb = 0; sb < 3; sb++) {
          // A self-pair's (sa, sb) and (sb, sa) are the same comparison; check it once.
          if (i === j && sa > sb) continue;
          const ab = file.ratings[i]![j]![sa]![sb]!;
          const ba = file.ratings[j]![i]![sb]![sa]!;
          if (Math.abs(ab + ba - 1000) > tolerance) {
            out.push({ a: file.meta[i]!.speciesId, b: file.meta[j]!.speciesId, shields: [sa, sb], ab, ba });
          }
        }
      }
    }
  }
  return out;
}
```

Add to `src/matrix/index.ts`:
```ts
export * from './batch';
```

- [ ] **Step 4: Implement `scripts/gen-matrix.ts`**

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadDefaultGameData } from '../src/data/node';
import { buildMatrixFile, mirrorMismatches, type MirrorMismatch } from '../src/matrix/batch';
import type { MatrixFile } from '../src/matrix/matrixData';
import { buildMeta, type RankingRow } from '../src/matrix/meta';

export const MATRIX_PATH = 'data/matrix-1500.json';
export const DEFAULT_META_SIZE = 150;
const REPORT_PATH = 'reports/matrix-report.md';

/** Read the vendored PvPoke commit from data/UPSTREAM, failing if the file is missing. */
export function readUpstream(): string {
  if (!existsSync('data/UPSTREAM')) throw new Error('data/UPSTREAM is missing; run npm run update-data -- <commit>');
  return readFileSync('data/UPSTREAM', 'utf8').trim();
}

/** Render the run report: meta size, exclusions, timing and mirror-check results. */
export function formatReport(file: MatrixFile, mismatches: readonly MirrorMismatch[], elapsedMs: number, date: string): string {
  const lines = [
    '# Matchup matrix report',
    '',
    `Generated ${date} by \`npm run gen-matrix\` from PvPoke commit \`${file.upstream}\`.`,
    '',
    `- Meta size: ${file.meta.length}`,
    `- Simulations: ${file.meta.length ** 2 * 9}`,
    `- Elapsed: ${(elapsedMs / 1000).toFixed(1)} s`,
    `- Mirror mismatches (off by more than 1): ${mismatches.length}`,
    '',
    '## Excluded (unsupported) before the meta was full',
    '',
    ...(file.excluded.length ? file.excluded.map((e) => `- ${e.speciesId}: ${e.reason}`) : ['None.']),
    '',
    '## Mirror mismatches (first 20)',
    '',
    'a\'s rating vs b at shields sa-sb, and b\'s rating vs a at sb-sa. These should add up to 1000 (999 after flooring).',
    '',
    '| a | b | shields (a-b) | a rating | b rating |',
    '|---|---|---|---|---|',
    ...mismatches.slice(0, 20).map((m) => `| ${m.a} | ${m.b} | ${m.shields[0]}-${m.shields[1]} | ${m.ab} | ${m.ba} |`),
    '',
  ];
  return lines.join('\n');
}

function parseSize(): number {
  const i = process.argv.indexOf('--size');
  if (i === -1) return DEFAULT_META_SIZE;
  const value = process.argv[i + 1] ?? '';
  if (!/^\d+$/.test(value) || Number(value) < 1) throw new Error(`--size must be a positive integer (got ${value || 'nothing'})`);
  return Number(value);
}

function main(): void {
  const size = parseSize();
  const upstream = readUpstream();
  const gd = loadDefaultGameData();
  const rankings: RankingRow[] = JSON.parse(readFileSync('data/rankings-1500.json', 'utf8'));
  const meta = buildMeta(gd, rankings, size);
  for (const e of meta.excluded) console.error(`excluded ${e.speciesId}: ${e.reason}`);

  const start = performance.now();
  const file = buildMatrixFile(gd, meta, upstream, (done, total) => {
    if (done % 10 === 0 || done === total) console.error(`${done}/${total} rows`);
  });
  const elapsed = performance.now() - start;
  const mismatches = mirrorMismatches(file);

  // Only the default size is the committed artifact; quick runs go to the gitignored cache.
  const out = size === DEFAULT_META_SIZE ? MATRIX_PATH : `.cache/matrix-1500-${size}.json`;
  mkdirSync('.cache', { recursive: true });
  writeFileSync(out, `${JSON.stringify(file)}\n`);
  if (size === DEFAULT_META_SIZE) {
    mkdirSync('reports', { recursive: true });
    writeFileSync(REPORT_PATH, formatReport(file, mismatches, elapsed, new Date().toISOString().slice(0, 10)));
  }
  console.log(`Wrote ${out}: ${size} x ${size} x 9 in ${(elapsed / 1000).toFixed(1)} s; ${mismatches.length} mirror mismatches`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}
```

In `package.json` `scripts`, add after `"sim"`:
```json
    "gen-matrix": "tsx scripts/gen-matrix.ts",
```

- [ ] **Step 5: Run the batch tests and confirm they pass**

Run: `npx vitest run tests/matrixBatch.test.ts`
Expected: PASS.

- [ ] **Step 6: Generate the real matrix**

Run: `npm run gen-matrix`
Expected: stderr lists exclusions (cramorant, aegislash_shield, and others) and row progress. stdout reads `Wrote data/matrix-1500.json: 150 x 150 x 9 in ~60 s; N mirror mismatches`. Check `reports/matrix-report.md` and `ls -lh data/matrix-1500.json` (about 1 MB).

If N isn't near zero (more than a handful), **stop and report**. Don't commit the data. The spec requires investigating before anything relies on symmetry.

- [ ] **Step 7: Write the committed-matrix tests**

`tests/matrixCommitted.test.ts`:
```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadDefaultGameData } from '../src/data/node';
import { simulateCell } from '../src/matrix/cell';
import { metaRow, parseMatrixFile } from '../src/matrix/matrixData';
import { buildMeta, metaCombatant, type RankingRow } from '../src/matrix/meta';
import { teamMatrix } from '../src/matrix/teamMatrix';

const gd = loadDefaultGameData();
const file = parseMatrixFile(JSON.parse(readFileSync('data/matrix-1500.json', 'utf8')));
const rankings: RankingRow[] = JSON.parse(readFileSync('data/rankings-1500.json', 'utf8'));

describe('committed data/matrix-1500.json', () => {
  it('was built from the vendored PvPoke commit', () => {
    expect(file.upstream).toBe(readFileSync('data/UPSTREAM', 'utf8').trim());
  });

  it('holds the current 150-Pokémon meta', () => {
    expect(file.generatedWith.metaSize).toBe(150);
    const meta = buildMeta(gd, rankings, 150);
    expect(file.meta).toEqual(meta.entries);
    expect(file.excluded).toEqual(meta.excluded);
  });

  it('matches a fresh simulation on a fixed sample of 200 pairs', () => {
    // Every 113th ordered pair: 200 pairs spread over the matrix, including self-pairs 0 and 113.
    const n = file.meta.length;
    const cs = file.meta.map((m) => metaCombatant(gd, m));
    let selfPairs = 0;
    for (let k = 0; k < 200; k++) {
      const idx = k * 113;
      const i = Math.floor(idx / n);
      const j = idx % n;
      if (i === j) selfPairs++;
      expect(file.ratings[i]![j], `${file.meta[i]!.speciesId} vs ${file.meta[j]!.speciesId}`).toEqual(simulateCell(gd, cs[i]!, cs[j]!));
    }
    expect(selfPairs).toBe(2);
  });

  it.each(['melmetal', 'mimikyu', 'morpeko_full_belly'])('gives the same row for %s through teamMatrix as through the batch', (id) => {
    const m = file.meta.find((e) => e.speciesId === id)!;
    const [fastMoveId, ...chargedMoveIds] = m.moveset;
    const [row] = teamMatrix(gd, [{ speciesId: id, fastMoveId, chargedMoveIds, ivs: m.ivs, level: m.level }], file.meta);
    expect(row!.cells).toEqual(metaRow(file, id).cells);
  });
});
```

- [ ] **Step 8: Run all the tests and the typecheck**

Run: `npm test && npm run typecheck`
Expected: everything passes, including the 197 existing tests.

- [ ] **Step 9: Commit**

```bash
git add src/matrix/batch.ts src/matrix/index.ts scripts/gen-matrix.ts package.json tests/matrixBatch.test.ts tests/matrixCommitted.test.ts data/matrix-1500.json reports/matrix-report.md
git commit -m "feat: gen-matrix batch writes the 150-Pokémon meta matrix in all 9 shield scenarios, with a mirror-check report"
```

---

### Task 6: Debug CLI (`npm run matrix`), docs, final verification

**Files:**
- Create: `scripts/matrix.ts`, `tests/matrixCli.test.ts`
- Modify: `scripts/sim.ts` (export `arg` and `parseShields`), `package.json`, `README.md`, `docs/superpowers/specs/2026-10-16-matchup-matrix-design.md`, `docs/superpowers/specs/2026-10-15-battle-engine-design.md` (§1 roadmap)

**Interfaces:**
- Consumes: `parseMatrixFile`, `metaRow`, `MatrixFile` (Task 4); `summarize` (Task 4); `parseRoster`, `teamMatrix` (Task 3); `MatrixRow` (Task 2); `MATRIX_PATH`, `readUpstream` (Task 5); `arg`, `parseShields` (`scripts/sim.ts`, exported in this task).
- Produces: `formatRow(gd: GameData, file: MatrixFile, row: MatrixRow, shields: readonly [number, number]): string` and the `npm run matrix` CLI.

- [ ] **Step 1: Export the helpers from `scripts/sim.ts`**

Change `function arg(` to `export function arg(` and `function parseShields(` to `export function parseShields(`. Add a docstring line above each:
```ts
/** Return the `count` values after `flag` on the command line, or undefined if the flag is absent. */
export function arg(flag: string, count: number): string[] | undefined {
```
```ts
/** Parse a `--shields A B` pair (integers 0-2), defaulting to 1 1. */
export function parseShields(values: string[] | undefined): [number, number] {
```

- [ ] **Step 2: Write the failing CLI tests**

`tests/matrixCli.test.ts`:
```ts
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
```

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `npx vitest run tests/matrixCli.test.ts`
Expected: FAIL. `scripts/matrix.ts` doesn't exist, so tsx exits with "Cannot find module" and the output assertions fail.

- [ ] **Step 4: Implement `scripts/matrix.ts`**

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadDefaultGameData } from '../src/data/node';
import type { GameData } from '../src/data/types';
import type { MatrixRow } from '../src/matrix/cell';
import { metaRow, parseMatrixFile, type MatrixFile } from '../src/matrix/matrixData';
import { summarize } from '../src/matrix/summary';
import { parseRoster, teamMatrix } from '../src/matrix/teamMatrix';
import { MATRIX_PATH, readUpstream } from './gen-matrix';
import { arg, parseShields } from './sim';

const LIST_LENGTH = 10;

/** Render one row: summary per scenario, then its best and worst opponents at the given shields. */
export function formatRow(gd: GameData, file: MatrixFile, row: MatrixRow, shields: readonly [number, number]): string {
  const name = (id: string): string => gd.species.get(id)?.name ?? id;
  const s = summarize(row);
  const [sa, sb] = shields;
  const scored = row.cells
    .map((cell, j) => ({ opponent: name(file.meta[j]!.speciesId), rating: cell[sa]![sb]! }))
    .sort((x, y) => y.rating - x.rating);
  const list = (items: typeof scored): string[] => items.map((x) => `  ${String(x.rating).padStart(4)}  ${x.opponent}`);
  return [
    gd.species.has(row.id) ? name(row.id) : row.id,
    `Average (1-1): ${s.average[1][1]}`,
    `Wins/losses: 0-0 ${s.wins[0][0]}/${s.losses[0][0]} · 1-1 ${s.wins[1][1]}/${s.losses[1][1]} · 2-2 ${s.wins[2][2]}/${s.losses[2][2]}`,
    `Best at ${sa}-${sb}:`,
    ...list(scored.slice(0, LIST_LENGTH)),
    `Worst at ${sa}-${sb}:`,
    ...list(scored.slice(-LIST_LENGTH).reverse()),
  ].join('\n');
}

function loadMatrix(): MatrixFile {
  const file = parseMatrixFile(JSON.parse(readFileSync(MATRIX_PATH, 'utf8')));
  const upstream = readUpstream();
  if (file.upstream !== upstream) {
    throw new Error(`${MATRIX_PATH} is stale (built from ${file.upstream}, data is ${upstream}); run npm run gen-matrix`);
  }
  return file;
}

function readRoster(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`Cannot read roster file ${path}: ${(e as Error).message}`);
  }
}

function main(): void {
  const usage = 'Usage: npm run matrix -- <speciesId> [--shields 1 1]  |  npm run matrix -- --roster <file.json> [--shields 1 1]';
  const shields = parseShields(arg('--shields', 2));
  const gd = loadDefaultGameData();
  const rosterArgs = arg('--roster', 1);

  if (rosterArgs !== undefined) {
    const path = rosterArgs[0];
    if (path === undefined || path.startsWith('--')) throw new Error('--roster needs a path to a roster JSON file');
    const roster = parseRoster(readRoster(path));
    const file = loadMatrix();
    const rows = teamMatrix(gd, roster, file.meta);
    console.log(rows.map((row) => formatRow(gd, file, row, shields)).join('\n\n'));
    return;
  }

  const speciesId = process.argv[2];
  if (speciesId === undefined || speciesId.startsWith('--')) throw new Error(usage);
  if (!gd.species.has(speciesId)) throw new Error(`Unknown species ${speciesId}`);
  const file = loadMatrix();
  console.log(formatRow(gd, file, metaRow(file, speciesId), shields));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}
```

In `package.json` `scripts`, add after `"gen-matrix"`:
```json
    "matrix": "tsx scripts/matrix.ts",
```

- [ ] **Step 5: Run the CLI tests and confirm they pass**

Run: `npx vitest run tests/matrixCli.test.ts tests/simCli.test.ts`
Expected: PASS. `simCli` still passes after the export change.

- [ ] **Step 6: Try it by hand**

Run: `npm run matrix -- melmetal` and `npm run matrix -- mimikyu --shields 0 0`
Expected: readable output. Check that Melmetal's worst list looks plausible against pvpoke.com's counters (e.g. `ninetales_shadow`, `stunfisk`, if they're in the meta).

- [ ] **Step 7: Update the README**

In `README.md`, change the opening line to:
```markdown
Pokémon GO Great League lab: a battle engine that matches PvPoke's simulator, a meta matchup matrix, and (later) a team builder and battle agent.
```
Add this section after `### Policies`:
```markdown
### Matchup matrix
- `data/matrix-1500.json` (committed) holds the 1v1 battle rating of every meta Pokémon against every other in all 9 shield scenarios. The meta is the top 150 Pokémon in PvPoke's Great League rankings that the engine supports, with PvPoke's ranking movesets and default IVs. `ratings[a][b][aShields][bShields]` is a's rating (0–1000, 500 = even).
- `npm run gen-matrix` rebuilds it (about a minute) and writes `reports/matrix-report.md`, which lists exclusions, timing and a mirror check. `--size N` does a quick run into `.cache/` instead. Rerun it after `npm run update-data` or any engine change; `tests/matrixCommitted.test.ts` fails while it is stale.
- `npm run matrix -- <speciesId> [--shields A B]` prints a meta Pokémon's averages, wins/losses and best/worst matchups.
- `npm run matrix -- --roster my-team.json` does the same for your own Pokémon, simulated on demand (`teamMatrix` in `src/matrix/`). The roster file is a JSON array:
  ```json
  [{ "speciesId": "azumarill", "fastMoveId": "BUBBLE", "chargedMoveIds": ["ICE_BEAM", "PLAY_ROUGH"],
     "ivs": { "atk": 0, "def": 15, "hp": 15 }, "label": "My Azumarill" }]
  ```
  `ivs`, `level` and `label` are optional; defaults are PvPoke's default IVs and the highest level under 1500 CP.
```
Add this bullet to `## Known exclusions`:
```markdown
- Meta gaps: unsupported Pokémon (Cramorant, Aegislash, megas and others) are missing from the matrix meta. The `excluded` list in `data/matrix-1500.json` and `reports/matrix-report.md` names them.
```
Add to `### Oracle results`, as its last bullet:
```markdown
- Matchup matrix: `simulateCell` reproduces every one of the 15,150 oracle cases exactly (`tests/matrixCell.test.ts`).
```

- [ ] **Step 8: Update the specs**

In `docs/superpowers/specs/2026-10-16-matchup-matrix-design.md`, change `Status: Approved for planning` to `Status: Implemented (2026-10-16)` and append:
```markdown
## 9. Implementation notes
- `simulateCell` takes an optional `{ maxTurns }`, used to test the turn-limit error.
- The pure batch logic (`buildMatrixFile`, `mirrorMismatches`) is in `src/matrix/batch.ts`; `scripts/gen-matrix.ts` only does I/O.
- `parseRoster` (in `teamMatrix.ts`) validates roster JSON shape for the CLI and, later, the web app.
- `gen-matrix --size N` with N ≠ 150 writes to `.cache/matrix-1500-<N>.json` and writes no report, so the committed file is never overwritten by a quick run.
- Mirror check result: see `reports/matrix-report.md`.
```
In `docs/superpowers/specs/2026-10-15-battle-engine-design.md` §1, replace the roadmap line `2. **Meta rankings** — offline batch producing ranking data artifacts.` with:
```markdown
2. **Meta rankings** — offline batch producing ranking data artifacts. Built as the matchup matrix (`2026-10-16-matchup-matrix-design.md`); a port of PvPoke's ranking algorithm is deferred.
```

- [ ] **Step 9: Full verification**

Run: `npm test && npm run typecheck`
Expected: all tests pass (the existing 197 plus the new ones); both typechecks are clean.

- [ ] **Step 10: Commit**

```bash
git add scripts/matrix.ts scripts/sim.ts package.json tests/matrixCli.test.ts README.md docs/superpowers/specs/2026-10-16-matchup-matrix-design.md docs/superpowers/specs/2026-10-15-battle-engine-design.md
git commit -m "feat: matrix debug CLI for meta Pokémon and roster files; docs for the matchup matrix"
```
