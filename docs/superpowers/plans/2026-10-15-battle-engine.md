# Battle Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A TypeScript Great League 1v1 battle simulator whose stats, damage and outcomes match PvPoke, verified against PvPoke's own simulator.

**Architecture:** Pure data → stats → engine layers. The engine is a deterministic, immutable turn function (`beginTurn` / `canAct` / `resolveTurn`) that reproduces PvPoke's action-queue model. Decision-making is a pluggable `Policy`; the default `PvPokeLikePolicy` is a faithful port of PvPoke's `ActionLogic`. A dev-only harness runs PvPoke's real JS in a Node `vm` to produce golden fixtures.

**Tech Stack:** TypeScript 5.6 (strict), Node ≥ 20 (dev machine has 24), npm, Vitest 2, tsx for scripts. No runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-10-15-battle-engine-design.md` (read section 10 "Findings" first).

**PvPoke reference:** upstream `https://github.com/pvpoke/pvpoke`, pinned commit `a23fb293300077028a65da534c73bd6367b7ef9d`. After Task 1, a checkout lives at `.cache/pvpoke/` (gitignored). File/line references below (e.g. `Battle.js:278-607`) are to `src/js/` at that commit.

## Global Constraints

- TypeScript `strict: true`; full type annotations; no `any` except at the JSON boundary in the loader and the PvPoke harness.
- Public functions get a one-sentence docstring (what, not how).
- Every function that can fail throws a typed error (`GameDataError`, `StatsError`, `UnsupportedPokemonError`, `IllegalActionError`, `TurnLimitError`); no silent fallbacks.
- No dead code, no commented-out blocks.
- Branch: `feat/tvanmook/battle-engine/20261015`. Commit prefixes `feat:`, `fix:`, `test:`, `docs:`, `chore:`. Commit after each task (more often is fine).
- Never touch `.env*`. Never weaken a test to make it pass.
- PvPoke code is never imported from `src/`; it is only used by `scripts/oracle/*` and fixture generation.
- When this plan and PvPoke behaviour disagree, PvPoke wins: fix the code and record the finding in the spec's section 10.
- Full suite (`npm test`) must pass before any task is marked done.

## Review Focus

1. **Float exactness:** damage must use PvPoke's float32 constants and multiplication order; a "simplified" formula passes most cases and silently breaks breakpoints. Pinned by the reference-damage tests in Task 4.
2. **Mirror / equal-attack matchups:** both sides throwing on the same turn with equal raw attack must both resolve (no CMP), possibly double-KO. Pinned by the CMP-tie test in Task 6.
3. **Unsupported Pokémon (form changers, megas, `percentMaxHP` moves):** must throw `UnsupportedPokemonError`, never simulate incorrectly. Pinned in Task 5.
4. **IVs that can't fit under the cap / out of range input:** `bestLevelUnderCap` returns `null`; `buildCombatant` throws `StatsError` for IVs outside 0–15 or a level above max. Pinned in Tasks 3 and 5.
5. **Moves not in the species' pool / one-charged-move Pokémon:** loader-backed validation throws; a combatant with a single charged move must simulate fine. Pinned in Task 5 and Task 7.

---

## File Structure

```
gbl-lab/
  package.json, tsconfig.json, vitest.config.ts, .gitignore
  README.md
  data/
    gamemaster.json            vendored PvPoke data (MIT)
    rankings-1500.json         vendored PvPoke GL overall rankings
    UPSTREAM                   pinned commit hash
    ATTRIBUTION.md
  docs/decisions/
    0001-typescript-in-browser.md
    0002-match-pvpoke-semantics.md
  src/
    errors.ts                  typed error classes
    data/types.ts              domain types (Species, moves, GameData)
    data/loader.ts             raw JSON → GameData, validated
    data/typeChart.ts          type effectiveness (PvPoke constants)
    data/index.ts              loadDefaultGameData() for Node scripts/tests
    stats/cpm.ts               CPM table
    stats/stats.ts             CP, HP, level search
    stats/ivRank.ts            stat-product IV ranking
    engine/constants.ts        float32 multipliers, turn length
    engine/damage.ts           buff multipliers, effective stats, damage
    engine/combatant.ts        buildCombatant()
    engine/state.ts            BattleState types + createBattle()
    engine/turn.ts             beginTurn / canAct / resolveTurn
    policy/types.ts            Policy interface
    policy/testPolicies.ts     FastOnly, Greedy, Scripted
    policy/pvpoke/moveMeta.ts  port of Pokemon.resetMoves move ordering
    policy/pvpoke/shield.ts    port of shield logic + ActionLogic.wouldShield
    policy/pvpoke/decide.ts    port of ActionLogic.decideAction
    policy/pvpoke/index.ts     PvPokeLikePolicy
    sim/rating.ts              battle rating
    sim/runMatchup.ts          runMatchup()
  scripts/
    update-data.ts             fetch pinned PvPoke, vendor data
    oracle/pvpokeHarness.cjs   run PvPoke JS headless
    gen-oracle.ts              write fixtures
    compare-oracle.ts          mismatch report
    sim.ts                     debug CLI
  tests/
    fixtures/                  oracle JSON
    *.test.ts
```

---

### Task 1: Scaffold, vendored data, ADRs

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `scripts/update-data.ts`, `data/ATTRIBUTION.md`, `docs/decisions/0001-typescript-in-browser.md`, `docs/decisions/0002-match-pvpoke-semantics.md`, `README.md`
- Generated: `data/gamemaster.json`, `data/rankings-1500.json`, `data/UPSTREAM`
- Test: `tests/scaffold.test.ts`

**Interfaces:**
- Produces: `npm test`, `npm run typecheck`, `npm run update-data -- <commit>`; `.cache/pvpoke/` checkout used by Tasks 9 and 12.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "gbl-lab",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "update-data": "tsx scripts/update-data.ts",
    "gen-oracle": "tsx scripts/gen-oracle.ts",
    "compare-oracle": "tsx scripts/compare-oracle.ts",
    "sim": "tsx scripts/sim.ts"
  },
  "devDependencies": {
    "@types/node": "22.10.2",
    "tsx": "4.19.2",
    "typescript": "5.6.3",
    "vitest": "2.1.8"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`, `vitest.config.ts`, `.gitignore`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src", "scripts", "tests"]
}
```

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/**/*.test.ts'], testTimeout: 600_000 },
});
```

```
# .gitignore
node_modules/
.cache/
reports/
```

- [ ] **Step 3: Write `scripts/update-data.ts`**

```ts
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const UPSTREAM_URL = 'https://github.com/pvpoke/pvpoke.git';
const CHECKOUT_DIR = join('.cache', 'pvpoke');

/** Fetch PvPoke at a pinned commit into .cache/pvpoke and vendor its data files into data/. */
function updateData(commit: string): void {
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error(`Expected a full 40-char commit hash, got "${commit}"`);
  }
  if (existsSync(CHECKOUT_DIR)) rmSync(CHECKOUT_DIR, { recursive: true, force: true });
  mkdirSync(CHECKOUT_DIR, { recursive: true });
  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: CHECKOUT_DIR, stdio: 'inherit' });
  };
  git('init', '-q');
  git('remote', 'add', 'origin', UPSTREAM_URL);
  git('fetch', '-q', '--depth', '1', 'origin', commit);
  git('checkout', '-q', 'FETCH_HEAD');

  const src = join(CHECKOUT_DIR, 'src', 'data');
  copyFileSync(join(src, 'gamemaster.json'), join('data', 'gamemaster.json'));
  copyFileSync(join(src, 'rankings', 'all', 'overall', 'rankings-1500.json'), join('data', 'rankings-1500.json'));
  writeFileSync(join('data', 'UPSTREAM'), `${commit}\n`);
  console.log(`Vendored PvPoke data at ${commit}`);
}

const commit = process.argv[2];
if (!commit) {
  console.error('Usage: npm run update-data -- <commit-hash>');
  process.exit(1);
}
updateData(commit);
```

- [ ] **Step 4: Install and vendor**

Run: `npm install && mkdir -p data && npm run update-data -- a23fb293300077028a65da534c73bd6367b7ef9d`
Expected: `Vendored PvPoke data at a23fb29...`; `data/gamemaster.json` (~1751 pokemon) and `data/rankings-1500.json` exist.

- [ ] **Step 5: Write `data/ATTRIBUTION.md` and the two ADRs**

`data/ATTRIBUTION.md`:
```markdown
# Data attribution

`gamemaster.json` and `rankings-1500.json` are from PvPoke (https://github.com/pvpoke/pvpoke),
MIT License, Copyright (c) PvPoke contributors. The pinned upstream commit is in `UPSTREAM`.
The CPM table in `src/stats/cpm.ts` and the constants in `src/engine/constants.ts` are
transcribed from the same commit (`src/js/pokemon/Pokemon.js`, `src/js/battle/DamageCalculator.js`).
```

`docs/decisions/0001-typescript-in-browser.md`:
```markdown
# 0001 — TypeScript, running in the browser

Status: accepted (2026-10-15)

Context: The tool must be usable on a phone without a server; later parts add a web UI and a play-vs-agent mode.

Decision: Write everything in strict TypeScript. The simulator runs in the browser; heavy batch jobs (meta rankings) run offline in Node and ship as static data. Host as a static site.

Consequences: One language, free hosting. If reinforcement learning is ever needed it is trained elsewhere and exported for in-browser inference.
```

`docs/decisions/0002-match-pvpoke-semantics.md`:
```markdown
# 0002 — Match PvPoke's simulation semantics exactly

Status: accepted (2026-10-15)

Context: The user's goal is to improve; wrong advice is worse than none. PvPoke is the community reference and is MIT licensed.

Decision: Reproduce PvPoke's mechanics (float32 constants, multiplication order, action queue, buff meter, CMP) and port its decision logic, including quirks such as the per-move "last damage" cache. When our understanding and PvPoke disagree, PvPoke wins. A Node harness running PvPoke's own code produces golden fixtures.

Consequences: Results are comparable with pvpoke.com. Some code mirrors PvPoke's structure rather than an idealised design; such places reference PvPoke file:line.
```

- [ ] **Step 6: Write the README skeleton**

```markdown
# gbl-lab

Pokémon GO Great League lab: a battle simulator that matches PvPoke, and (later) a team builder and battle agent.

## Run locally
- `npm install`
- `npm run sim -- medicham azumarill --shields 1 1` — simulate a matchup and print a timeline.

## Tests
- `npm test` — full suite, including the PvPoke oracle acceptance test.
- `npm run typecheck`

## Data
- `npm run update-data -- <pvpoke-commit>` refreshes `data/` from PvPoke and checks out PvPoke into `.cache/pvpoke` (needed by the oracle scripts).
- `npm run gen-oracle` regenerates `tests/fixtures/` from PvPoke's own simulator.
- `npm run compare-oracle` writes `reports/oracle-report.md` with the worst mismatches.

## Environment variables
None.
```

- [ ] **Step 7: Write the failing scaffold test**

```ts
// tests/scaffold.test.ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('vendored data', () => {
  it('is pinned to the upstream commit', () => {
    expect(readFileSync('data/UPSTREAM', 'utf8').trim()).toBe('a23fb293300077028a65da534c73bd6367b7ef9d');
  });
});
```

- [ ] **Step 8: Run tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: 1 test PASS; tsc no errors.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore scripts/update-data.ts data docs/decisions README.md tests/scaffold.test.ts
git commit -m "chore: scaffold project and vendor PvPoke data"
```

---

### Task 2: Domain types, errors, type chart, loader

**Files:**
- Create: `src/errors.ts`, `src/data/types.ts`, `src/data/typeChart.ts`, `src/data/loader.ts`, `src/data/index.ts`
- Test: `tests/typeChart.test.ts`, `tests/loader.test.ts`

**Interfaces:**
- Produces: `loadGameData(raw: unknown): GameData`, `loadDefaultGameData(): GameData`, `effectiveness(moveType: PokemonType, defenderTypes: readonly PokemonType[]): number`, all types below, error classes.

- [ ] **Step 1: Write `src/errors.ts`**

```ts
/** Raised when game data is malformed or references something missing. */
export class GameDataError extends Error {
  override name = 'GameDataError';
}

/** Raised for invalid stat inputs (IVs out of range, impossible level). */
export class StatsError extends Error {
  override name = 'StatsError';
}

/** Raised for Pokémon or moves whose mechanics this engine does not model yet. */
export class UnsupportedPokemonError extends Error {
  override name = 'UnsupportedPokemonError';
}

/** Raised when a policy returns an action the rules do not allow. */
export class IllegalActionError extends Error {
  override name = 'IllegalActionError';
}

/** Raised when a battle exceeds the turn limit; carries the events so far for debugging. */
export class TurnLimitError extends Error {
  override name = 'TurnLimitError';
  constructor(message: string, readonly events: readonly unknown[]) {
    super(message);
  }
}
```

- [ ] **Step 2: Write `src/data/types.ts`**

```ts
export const POKEMON_TYPES = [
  'normal', 'fighting', 'flying', 'poison', 'ground', 'rock', 'bug', 'ghost', 'steel',
  'fire', 'water', 'grass', 'electric', 'psychic', 'ice', 'dragon', 'dark', 'fairy',
] as const;

export type PokemonType = (typeof POKEMON_TYPES)[number];

export type StatPair = readonly [atk: number, def: number];

export type BuffTarget = 'self' | 'opponent' | 'both';

export interface MoveBuffs {
  /** Stages for 'self' or 'opponent' targets. */
  readonly stages: StatPair;
  readonly target: BuffTarget;
  /** Probability 0..1. */
  readonly chance: number;
  /** Only for target 'both'. */
  readonly selfStages?: StatPair;
  readonly opponentStages?: StatPair;
}

export interface FastMove {
  readonly kind: 'fast';
  readonly id: string;
  readonly name: string;
  readonly type: PokemonType;
  readonly power: number;
  readonly energyGain: number;
  readonly turns: number;
  readonly cooldownMs: number;
  readonly buffs?: MoveBuffs;
  readonly damageMethod: string;
  readonly tags: readonly string[];
}

export interface ChargedMove {
  readonly kind: 'charged';
  readonly id: string;
  readonly name: string;
  readonly type: PokemonType;
  readonly power: number;
  readonly energy: number;
  readonly buffs?: MoveBuffs;
  readonly damageMethod: string;
  readonly tags: readonly string[];
  /** Flags derived exactly as PvPoke GameMaster.js:880-896. */
  readonly selfDebuffing: boolean;
  readonly selfAttackDebuffing: boolean;
  readonly selfDefenseDebuffing: boolean;
  readonly selfBuffing: boolean;
}

export type Move = FastMove | ChargedMove;

export interface DefaultIvs {
  readonly level: number;
  readonly atk: number;
  readonly def: number;
  readonly hp: number;
}

export interface Species {
  readonly id: string;
  readonly dex: number;
  readonly name: string;
  /** One or two types; PvPoke's "none" placeholder is dropped. */
  readonly types: readonly PokemonType[];
  readonly base: { readonly atk: number; readonly def: number; readonly hp: number };
  readonly fastMoveIds: readonly string[];
  readonly chargedMoveIds: readonly string[];
  readonly eliteMoveIds: readonly string[];
  readonly tags: readonly string[];
  readonly nativeStatBuffs: StatPair;
  readonly hasFormChange: boolean;
  /** PvPoke's defaultIVs.cp1500, used by its rankings. */
  readonly defaultIvsGreat: DefaultIvs;
}

export interface GameData {
  readonly species: ReadonlyMap<string, Species>;
  readonly moves: ReadonlyMap<string, Move>;
  readonly maxBuffStages: number;
  readonly buffDivisor: number;
}
```

- [ ] **Step 3: Write the failing type-chart test**

```ts
// tests/typeChart.test.ts
import { describe, expect, it } from 'vitest';
import { effectiveness } from '../src/data/typeChart';

describe('effectiveness', () => {
  it('uses PvPoke float32 constants', () => {
    expect(effectiveness('fighting', ['steel'])).toBe(1.60000002384185791015625);
    expect(effectiveness('fighting', ['fairy'])).toBe(0.625);
    expect(effectiveness('ghost', ['normal'])).toBe(0.390625);
  });

  it('multiplies across dual types in defender type order', () => {
    expect(effectiveness('fighting', ['water', 'fairy'])).toBe(0.625);
    expect(effectiveness('ground', ['steel', 'rock'])).toBe(1.60000002384185791015625 * 1.60000002384185791015625);
    expect(effectiveness('electric', ['water', 'ground'])).toBe(1.60000002384185791015625 * 0.390625);
  });

  it('is neutral when no interaction', () => {
    expect(effectiveness('normal', ['water'])).toBe(1);
  });
});
```

- [ ] **Step 4: Run to confirm failure**

Run: `npx vitest run tests/typeChart.test.ts`
Expected: FAIL — cannot find module `../src/data/typeChart`.

- [ ] **Step 5: Write `src/data/typeChart.ts`** (transcribed from `DamageCalculator.js:140-282`)

```ts
import type { PokemonType } from './types';

export const SUPER_EFFECTIVE = 1.60000002384185791015625;
export const RESISTED = 0.625;
export const DOUBLE_RESISTED = 0.390625;

interface Traits {
  readonly weaknesses: readonly PokemonType[];
  readonly resistances: readonly PokemonType[];
  readonly immunities: readonly PokemonType[];
}

const TRAITS: Readonly<Record<PokemonType, Traits>> = {
  normal: { resistances: [], weaknesses: ['fighting'], immunities: ['ghost'] },
  fighting: { resistances: ['rock', 'bug', 'dark'], weaknesses: ['flying', 'psychic', 'fairy'], immunities: [] },
  flying: { resistances: ['fighting', 'bug', 'grass'], weaknesses: ['rock', 'electric', 'ice'], immunities: ['ground'] },
  poison: { resistances: ['fighting', 'poison', 'bug', 'fairy', 'grass'], weaknesses: ['ground', 'psychic'], immunities: [] },
  ground: { resistances: ['poison', 'rock'], weaknesses: ['water', 'grass', 'ice'], immunities: ['electric'] },
  rock: { resistances: ['normal', 'flying', 'poison', 'fire'], weaknesses: ['fighting', 'ground', 'steel', 'water', 'grass'], immunities: [] },
  bug: { resistances: ['fighting', 'ground', 'grass'], weaknesses: ['flying', 'rock', 'fire'], immunities: [] },
  ghost: { resistances: ['poison', 'bug'], weaknesses: ['ghost', 'dark'], immunities: ['normal', 'fighting'] },
  steel: {
    resistances: ['normal', 'flying', 'rock', 'bug', 'steel', 'grass', 'psychic', 'ice', 'dragon', 'fairy'],
    weaknesses: ['fighting', 'ground', 'fire'],
    immunities: ['poison'],
  },
  fire: { resistances: ['bug', 'steel', 'fire', 'grass', 'ice', 'fairy'], weaknesses: ['ground', 'rock', 'water'], immunities: [] },
  water: { resistances: ['steel', 'fire', 'water', 'ice'], weaknesses: ['grass', 'electric'], immunities: [] },
  grass: { resistances: ['ground', 'water', 'grass', 'electric'], weaknesses: ['flying', 'poison', 'bug', 'fire', 'ice'], immunities: [] },
  electric: { resistances: ['flying', 'steel', 'electric'], weaknesses: ['ground'], immunities: [] },
  psychic: { resistances: ['fighting', 'psychic'], weaknesses: ['bug', 'ghost', 'dark'], immunities: [] },
  ice: { resistances: ['ice'], weaknesses: ['fighting', 'fire', 'steel', 'rock'], immunities: [] },
  dragon: { resistances: ['fire', 'water', 'grass', 'electric'], weaknesses: ['dragon', 'ice', 'fairy'], immunities: [] },
  dark: { resistances: ['ghost', 'dark'], weaknesses: ['fighting', 'fairy', 'bug'], immunities: ['psychic'] },
  fairy: { resistances: ['fighting', 'bug', 'dark'], weaknesses: ['poison', 'steel'], immunities: ['dragon'] },
};

/** Return the type-effectiveness multiplier of a move type against a defender's types. */
export function effectiveness(moveType: PokemonType, defenderTypes: readonly PokemonType[]): number {
  let result = 1;
  for (const type of defenderTypes) {
    const traits = TRAITS[type];
    if (traits.weaknesses.includes(moveType)) result *= SUPER_EFFECTIVE;
    else if (traits.resistances.includes(moveType)) result *= RESISTED;
    else if (traits.immunities.includes(moveType)) result *= DOUBLE_RESISTED;
  }
  return result;
}
```

- [ ] **Step 6: Run the type-chart test**

Run: `npx vitest run tests/typeChart.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Write the failing loader tests**

```ts
// tests/loader.test.ts
import { describe, expect, it } from 'vitest';
import { GameDataError } from '../src/errors';
import { loadDefaultGameData, loadGameData } from '../src/data';

const minimal = (): Record<string, unknown> => ({
  settings: { maxBuffStages: 4, buffDivisor: 4 },
  pokemon: [
    {
      dex: 308, speciesId: 'medicham', speciesName: 'Medicham',
      baseStats: { atk: 121, def: 152, hp: 155 }, types: ['fighting', 'psychic'],
      fastMoves: ['COUNTER'], chargedMoves: ['POWER_UP_PUNCH'],
      defaultIVs: { cp1500: [49, 7, 15, 14] },
    },
  ],
  moves: [
    { moveId: 'COUNTER', name: 'Counter', type: 'fighting', power: 8, energy: 0, energyGain: 6, cooldown: 1000, turns: 2 },
    {
      moveId: 'POWER_UP_PUNCH', name: 'Power-Up Punch', type: 'fighting', power: 20, energy: 35, energyGain: 0,
      cooldown: 500, turns: 1, buffs: [1, 0], buffTarget: 'self', buffApplyChance: '1',
    },
  ],
});

describe('loadGameData', () => {
  it('parses species and moves into typed objects', () => {
    const gd = loadGameData(minimal());
    const medicham = gd.species.get('medicham');
    expect(medicham?.types).toEqual(['fighting', 'psychic']);
    expect(medicham?.defaultIvsGreat).toEqual({ level: 49, atk: 7, def: 15, hp: 14 });
    const counter = gd.moves.get('COUNTER');
    expect(counter).toMatchObject({ kind: 'fast', energyGain: 6, turns: 2, cooldownMs: 1000 });
    const pup = gd.moves.get('POWER_UP_PUNCH');
    expect(pup).toMatchObject({ kind: 'charged', energy: 35, selfBuffing: true, selfDebuffing: false });
    expect(pup?.buffs).toEqual({ stages: [1, 0], target: 'self', chance: 1 });
  });

  it('drops the "none" type placeholder', () => {
    const raw = minimal();
    (raw.pokemon as Record<string, unknown>[])[0]!.types = ['fighting', 'none'];
    expect(loadGameData(raw).species.get('medicham')?.types).toEqual(['fighting']);
  });

  it('rejects a species that references an unknown move', () => {
    const raw = minimal();
    (raw.pokemon as Record<string, unknown>[])[0]!.fastMoves = ['NOPE'];
    expect(() => loadGameData(raw)).toThrow(new GameDataError('medicham: unknown fast move NOPE'));
  });

  it('rejects a move with a non-numeric power', () => {
    const raw = minimal();
    (raw.moves as Record<string, unknown>[])[0]!.power = 'eight';
    expect(() => loadGameData(raw)).toThrow(GameDataError);
  });

  it('derives self-debuffing flags like PvPoke (Superpower)', () => {
    const gd = loadDefaultGameData();
    expect(gd.moves.get('SUPER_POWER')).toMatchObject({
      selfDebuffing: true, selfAttackDebuffing: true, selfDefenseDebuffing: true, selfBuffing: false,
    });
    expect(gd.moves.get('PSYCHIC')).toMatchObject({ selfDebuffing: false, selfBuffing: false });
    expect(gd.moves.get('PSYCHIC')?.buffs?.chance).toBe(0.1);
  });

  it('loads the vendored gamemaster', () => {
    const gd = loadDefaultGameData();
    expect(gd.species.size).toBeGreaterThan(1500);
    expect(gd.species.get('mimikyu')?.hasFormChange).toBe(true);
    expect(gd.species.get('registeel_shadow')?.tags).toContain('shadow');
  });
});
```

- [ ] **Step 8: Run to confirm failure**

Run: `npx vitest run tests/loader.test.ts`
Expected: FAIL — cannot find module `../src/data`.

- [ ] **Step 9: Write `src/data/loader.ts`**

```ts
import { GameDataError } from '../errors';
import {
  POKEMON_TYPES, type BuffTarget, type ChargedMove, type FastMove, type GameData, type Move,
  type MoveBuffs, type PokemonType, type Species, type StatPair,
} from './types';

type Raw = Record<string, unknown>;

function isRecord(value: unknown): value is Raw {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function num(obj: Raw, key: string, ctx: string): number {
  const value = obj[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new GameDataError(`${ctx}: field "${key}" must be a finite number`);
  }
  return value;
}

function str(obj: Raw, key: string, ctx: string): string {
  const value = obj[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new GameDataError(`${ctx}: field "${key}" must be a non-empty string`);
  }
  return value;
}

function strArray(obj: Raw, key: string, ctx: string, required: boolean): string[] {
  const value = obj[key];
  if (value === undefined && !required) return [];
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
    throw new GameDataError(`${ctx}: field "${key}" must be an array of strings`);
  }
  return value as string[];
}

function pair(value: unknown, ctx: string): StatPair {
  if (!Array.isArray(value) || value.length !== 2 || !value.every((v) => typeof v === 'number')) {
    throw new GameDataError(`${ctx}: expected a [atk, def] number pair`);
  }
  return [value[0] as number, value[1] as number];
}

function pokemonType(value: unknown, ctx: string): PokemonType {
  if (typeof value !== 'string' || !(POKEMON_TYPES as readonly string[]).includes(value)) {
    throw new GameDataError(`${ctx}: unknown type "${String(value)}"`);
  }
  return value as PokemonType;
}

function parseBuffs(m: Raw, ctx: string): MoveBuffs | undefined {
  if (m.buffs === undefined) return undefined;
  const target = str(m, 'buffTarget', ctx);
  if (target !== 'self' && target !== 'opponent' && target !== 'both') {
    throw new GameDataError(`${ctx}: unknown buffTarget "${target}"`);
  }
  const chance = Number.parseFloat(String(m.buffApplyChance));
  if (!Number.isFinite(chance) || chance < 0 || chance > 1) {
    throw new GameDataError(`${ctx}: buffApplyChance must be between 0 and 1`);
  }
  const buffs: MoveBuffs = { stages: pair(m.buffs, ctx), target: target as BuffTarget, chance };
  if (target === 'both') {
    return { ...buffs, selfStages: pair(m.buffsSelf, ctx), opponentStages: pair(m.buffsOpponent, ctx) };
  }
  return buffs;
}

function parseMove(m: unknown, index: number): Move {
  if (!isRecord(m)) throw new GameDataError(`moves[${index}]: expected an object`);
  const id = str(m, 'moveId', `moves[${index}]`);
  const common = {
    id,
    name: str(m, 'name', id),
    type: pokemonType(m.type, id),
    power: num(m, 'power', id),
    damageMethod: typeof m.damageMethod === 'string' ? m.damageMethod : 'default',
    tags: strArray(m, 'tags', id, false),
    buffs: parseBuffs(m, id),
  };
  const energyGain = num(m, 'energyGain', id);
  // Same classification as PvPoke GameMaster.js:831,856
  const category = typeof m.category === 'string' ? m.category : energyGain > 0 ? 'fast' : 'charged';
  if (category === 'fast') {
    const fast: FastMove = {
      ...common, kind: 'fast', energyGain, turns: num(m, 'turns', id), cooldownMs: num(m, 'cooldown', id),
    };
    return fast;
  }
  const b = common.buffs;
  // Flag derivation mirrors PvPoke GameMaster.js:880-896
  const selfDebuffing = !!b && b.target === 'self' && b.chance >= 0.5 && id !== 'DRAGON_ASCENT'
    && (b.stages[0] < 0 || b.stages[1] < 0);
  const selfBuffing = !!b && b.chance === 1 && (
    b.target === 'opponent'
    || (b.target === 'self' && (b.stages[0] > 0 || b.stages[1] > 0))
    || (b.target === 'both' && ((b.selfStages?.[0] ?? 0) > 0 || (b.selfStages?.[1] ?? 0) > 0))
  );
  const charged: ChargedMove = {
    ...common,
    kind: 'charged',
    energy: num(m, 'energy', id),
    selfDebuffing,
    selfAttackDebuffing: selfDebuffing && b!.stages[0] < 0,
    selfDefenseDebuffing: selfDebuffing && b!.stages[1] < 0,
    selfBuffing,
  };
  return charged;
}

function parseSpecies(p: unknown, index: number, moves: ReadonlyMap<string, Move>): Species {
  if (!isRecord(p)) throw new GameDataError(`pokemon[${index}]: expected an object`);
  const id = str(p, 'speciesId', `pokemon[${index}]`);
  if (!isRecord(p.baseStats)) throw new GameDataError(`${id}: missing baseStats`);
  if (!Array.isArray(p.types)) throw new GameDataError(`${id}: types must be an array`);
  const types = p.types.filter((t) => t !== 'none').map((t) => pokemonType(t, id));
  if (types.length < 1 || types.length > 2) throw new GameDataError(`${id}: must have 1 or 2 types`);

  const fastMoveIds = strArray(p, 'fastMoves', id, true);
  const chargedMoveIds = strArray(p, 'chargedMoves', id, true);
  for (const moveId of fastMoveIds) {
    if (moves.get(moveId)?.kind !== 'fast') throw new GameDataError(`${id}: unknown fast move ${moveId}`);
  }
  for (const moveId of chargedMoveIds) {
    if (moves.get(moveId)?.kind !== 'charged') throw new GameDataError(`${id}: unknown charged move ${moveId}`);
  }

  if (!isRecord(p.defaultIVs)) throw new GameDataError(`${id}: missing defaultIVs`);
  const iv = p.defaultIVs.cp1500;
  if (!Array.isArray(iv) || iv.length !== 4 || !iv.every((v) => typeof v === 'number')) {
    throw new GameDataError(`${id}: defaultIVs.cp1500 must be [level, atk, def, hp]`);
  }

  return {
    id,
    dex: num(p, 'dex', id),
    name: str(p, 'speciesName', id),
    types,
    base: { atk: num(p.baseStats, 'atk', id), def: num(p.baseStats, 'def', id), hp: num(p.baseStats, 'hp', id) },
    fastMoveIds,
    chargedMoveIds,
    eliteMoveIds: strArray(p, 'eliteMoves', id, false),
    tags: strArray(p, 'tags', id, false),
    nativeStatBuffs: p.nativeStatBuffs === undefined ? [0, 0] : pair(p.nativeStatBuffs, id),
    hasFormChange: p.formChange !== undefined,
    defaultIvsGreat: { level: iv[0] as number, atk: iv[1] as number, def: iv[2] as number, hp: iv[3] as number },
  };
}

/** Parse and validate a raw PvPoke gamemaster object into typed game data. */
export function loadGameData(raw: unknown): GameData {
  if (!isRecord(raw)) throw new GameDataError('gamemaster: expected an object');
  if (!Array.isArray(raw.moves)) throw new GameDataError('gamemaster: missing moves array');
  if (!Array.isArray(raw.pokemon)) throw new GameDataError('gamemaster: missing pokemon array');
  if (!isRecord(raw.settings)) throw new GameDataError('gamemaster: missing settings');

  const moves = new Map<string, Move>();
  raw.moves.forEach((m, i) => {
    const move = parseMove(m, i);
    moves.set(move.id, move);
  });

  const species = new Map<string, Species>();
  raw.pokemon.forEach((p, i) => {
    const s = parseSpecies(p, i, moves);
    species.set(s.id, s);
  });

  return {
    species,
    moves,
    maxBuffStages: num(raw.settings, 'maxBuffStages', 'settings'),
    buffDivisor: num(raw.settings, 'buffDivisor', 'settings'),
  };
}
```

- [ ] **Step 10: Write `src/data/index.ts`**

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadGameData } from './loader';
import type { GameData } from './types';

export { loadGameData } from './loader';
export * from './types';

let cached: GameData | undefined;

/** Load the vendored gamemaster from data/ (Node only; the web app will fetch it instead). */
export function loadDefaultGameData(): GameData {
  if (!cached) {
    const path = fileURLToPath(new URL('../../data/gamemaster.json', import.meta.url));
    cached = loadGameData(JSON.parse(readFileSync(path, 'utf8')));
  }
  return cached;
}
```

- [ ] **Step 11: Run loader tests**

Run: `npx vitest run tests/loader.test.ts`
Expected: PASS (6 tests). If the vendored gamemaster fails validation, the error names the entry — fix the loader to accept the real shape (do not loosen a check without a reason recorded in a comment).

- [ ] **Step 12: Full suite, typecheck, commit**

Run: `npm test && npm run typecheck` → all PASS.

```bash
git add src tests
git commit -m "feat: add game data loader, domain types and type chart"
```

---

### Task 3: CPM, CP, level search, IV ranking

**Files:**
- Create: `src/stats/cpm.ts`, `src/stats/stats.ts`, `src/stats/ivRank.ts`
- Test: `tests/stats.test.ts`, `tests/ivRank.test.ts`

**Interfaces:**
- Consumes: `Species` (Task 2), `StatsError`.
- Produces:
  - `cpmForLevel(level: number): number`
  - `interface Ivs { atk: number; def: number; hp: number }`
  - `computeCp(base: Species['base'], ivs: Ivs, cpm: number): number`
  - `computeStats(base: Species['base'], ivs: Ivs, level: number, dex: number): { atk: number; def: number; hp: number; cp: number; cpm: number }`
  - `bestLevelUnderCap(base: Species['base'], ivs: Ivs, cap: number, maxLevel: number): number | null`
  - `rankIvs(species: Species, opts?: { cap?: number; maxLevel?: number; ivFloor?: number }): IvRankEntry[]`

- [ ] **Step 1: Write `src/stats/cpm.ts`** — copy the 109-value `cpms` array verbatim from `.cache/pvpoke/src/js/pokemon/Pokemon.js:24`:

```ts
import { StatsError } from '../errors';

// Transcribed verbatim from PvPoke Pokemon.js:24 (index = (level - 1) * 2, levels 1..55).
const CPMS: readonly number[] = [
  0.0939999967813491, 0.135137430784308, 0.166397869586944, 0.192650914456886, 0.215732470154762, 0.236572655026622,
  0.255720049142837, 0.273530381100769, 0.290249884128570, 0.306057381335773, 0.321087598800659, 0.335445032295077,
  0.349212676286697, 0.362457748778790, 0.375235587358474, 0.387592411085168, 0.399567276239395, 0.411193549517250,
  0.422500014305114, 0.432926413410414, 0.443107545375824, 0.453059953871985, 0.462798386812210, 0.472336077786704,
  0.481684952974319, 0.490855810259008, 0.499858438968658, 0.508701756943992, 0.517393946647644, 0.525942508771329,
  0.534354329109191, 0.542635762230353, 0.550792694091796, 0.558830599438087, 0.566754519939422, 0.574569148039264,
  0.582278907299041, 0.589887911977272, 0.597400009632110, 0.604823657502073, 0.612157285213470, 0.619404110566050,
  0.626567125320434, 0.633649181622743, 0.640652954578399, 0.647580963301656, 0.654435634613037, 0.661219263506722,
  0.667934000492096, 0.674581899290818, 0.681164920330047, 0.687684905887771, 0.694143652915954, 0.700542893277978,
  0.706884205341339, 0.713169102333341, 0.719399094581604, 0.725575616972598, 0.731700003147125, 0.734741011137376,
  0.737769484519958, 0.740785574597326, 0.743789434432983, 0.746781208702482, 0.749761044979095, 0.752729105305821,
  0.755685508251190, 0.758630366519684, 0.761563837528228, 0.764486065255226, 0.767397165298461, 0.770297273971590,
  0.773186504840850, 0.776064945942412, 0.778932750225067, 0.781790064808426, 0.784636974334716, 0.787473583646825,
  0.790300011634826, 0.792803950958807, 0.795300006866455, 0.797803921486970, 0.800300002098083, 0.802803892322847,
  0.805299997329711, 0.807803863460723, 0.810299992561340, 0.812803834895026, 0.815299987792968, 0.817803806620319,
  0.820299983024597, 0.822803778631297, 0.825299978256225, 0.827803750922782, 0.830299973487854, 0.832803753381377,
  0.835300028324127, 0.837803755931569, 0.840300023555755, 0.842803729034748, 0.845300018787384, 0.847803702398935,
  0.850300014019012, 0.852803676019539, 0.855300009250640, 0.857803649892077, 0.860300004482269, 0.862803624012168,
  0.865299999713897,
];

/** Return the CP multiplier for a level in half-level steps from 1 to 55. */
export function cpmForLevel(level: number): number {
  const index = (level - 1) * 2;
  const cpm = CPMS[index];
  if (!Number.isInteger(index) || cpm === undefined) {
    throw new StatsError(`Level ${level} is not a valid half-level between 1 and 55`);
  }
  return cpm;
}
```

Verify the transcription against source (must print `109` and no diff output):
`sed -n 24p .cache/pvpoke/src/js/pokemon/Pokemon.js | sed 's/.*\[\(.*\)\];/\1/' | tr ',' '\n' | sed 's/^ *//' | grep -c .`

- [ ] **Step 2: Write the failing stats tests** (expected values produced by PvPoke's own simulator, see spec §10)

```ts
// tests/stats.test.ts
import { describe, expect, it } from 'vitest';
import { loadDefaultGameData } from '../src/data';
import { StatsError } from '../src/errors';
import { cpmForLevel } from '../src/stats/cpm';
import { bestLevelUnderCap, computeStats } from '../src/stats/stats';

const gd = loadDefaultGameData();
const sp = (id: string) => gd.species.get(id)!;

describe('cpm', () => {
  it('indexes half levels', () => {
    expect(cpmForLevel(1)).toBe(0.0939999967813491);
    expect(cpmForLevel(40)).toBe(0.790300011634826);
    expect(() => cpmForLevel(40.25)).toThrow(StatsError);
    expect(() => cpmForLevel(56)).toThrow(StatsError);
  });
});

describe('computeStats matches PvPoke', () => {
  it('Medicham 7/15/14 L49', () => {
    const s = computeStats(sp('medicham').base, { atk: 7, def: 15, hp: 14 }, 49, 308);
    expect(s).toMatchObject({ cp: 1500, hp: 141, atk: 106.91840362548825, def: 139.4951047301292 });
  });
  it('Azumarill 4/15/13 L43', () => {
    const s = computeStats(sp('azumarill').base, { atk: 4, def: 15, hp: 13 }, 43, 184);
    expect(s).toMatchObject({ cp: 1499, hp: 191, atk: 93.41479969024648, def: 134.48509955406175 });
  });
  it('Melmetal 4/10/14 L15.5', () => {
    const s = computeStats(sp('melmetal').base, { atk: 4, def: 10, hp: 14 }, 15.5, 809);
    expect(s).toMatchObject({ cp: 1500, hp: 146, atk: 120.96677701740566, def: 105.1885017542658 });
  });
  it('rejects IVs outside 0-15', () => {
    expect(() => computeStats(sp('medicham').base, { atk: 16, def: 0, hp: 0 }, 20, 308)).toThrow(StatsError);
  });
});

describe('bestLevelUnderCap', () => {
  it('finds the highest half-level at or under the cap', () => {
    expect(bestLevelUnderCap(sp('medicham').base, { atk: 7, def: 15, hp: 14 }, 1500, 50)).toBe(49);
    expect(bestLevelUnderCap(sp('registeel').base, { atk: 8, def: 15, hp: 14 }, 1500, 50)).toBe(22.5);
  });
  it('respects maxLevel when the cap is never reached', () => {
    expect(bestLevelUnderCap(sp('medicham').base, { atk: 0, def: 0, hp: 0 }, 1500, 40)).toBe(40);
  });
  it('returns null when even level 1 exceeds the cap', () => {
    expect(bestLevelUnderCap(sp('mewtwo').base, { atk: 15, def: 15, hp: 15 }, 10, 50)).toBeNull();
  });
});
```

- [ ] **Step 3: Run to confirm failure**

Run: `npx vitest run tests/stats.test.ts` → FAIL (module not found).

- [ ] **Step 4: Write `src/stats/stats.ts`** (mirrors `Pokemon.js:380-382, 425-428`)

```ts
import type { Species } from '../data/types';
import { StatsError } from '../errors';
import { cpmForLevel } from './cpm';

export interface Ivs {
  readonly atk: number;
  readonly def: number;
  readonly hp: number;
}

export interface ComputedStats {
  readonly atk: number;
  readonly def: number;
  readonly hp: number;
  readonly cp: number;
  readonly cpm: number;
}

const SHEDINJA_DEX = 292;

function assertIvs(ivs: Ivs): void {
  for (const value of [ivs.atk, ivs.def, ivs.hp]) {
    if (!Number.isInteger(value) || value < 0 || value > 15) {
      throw new StatsError(`IVs must be integers 0-15, got ${ivs.atk}/${ivs.def}/${ivs.hp}`);
    }
  }
}

/** Compute CP exactly as PvPoke does. */
export function computeCp(base: Species['base'], ivs: Ivs, cpm: number): number {
  return Math.floor(((base.atk + ivs.atk) * Math.pow(base.def + ivs.def, 0.5) * Math.pow(base.hp + ivs.hp, 0.5) * Math.pow(cpm, 2)) / 10);
}

/** Compute battle stats (unrounded atk/def, floored HP) and CP at a level. */
export function computeStats(base: Species['base'], ivs: Ivs, level: number, dex: number): ComputedStats {
  assertIvs(ivs);
  const cpm = cpmForLevel(level);
  const hp = dex === SHEDINJA_DEX ? 10 : Math.max(Math.floor(cpm * (base.hp + ivs.hp)), 10);
  return {
    atk: cpm * (base.atk + ivs.atk),
    def: cpm * (base.def + ivs.def),
    hp,
    cp: Math.max(computeCp(base, ivs, cpm), 10),
    cpm,
  };
}

/** Return the highest half-level up to maxLevel whose CP is at or under the cap, or null if none. */
export function bestLevelUnderCap(base: Species['base'], ivs: Ivs, cap: number, maxLevel: number): number | null {
  assertIvs(ivs);
  for (let level = maxLevel; level >= 1; level -= 0.5) {
    if (computeCp(base, ivs, cpmForLevel(level)) <= cap) return level;
  }
  return null;
}
```

- [ ] **Step 5: Run stats tests** → PASS (8 tests).

- [ ] **Step 6: Write the failing IV-rank tests**

```ts
// tests/ivRank.test.ts
import { describe, expect, it } from 'vitest';
import { loadDefaultGameData } from '../src/data';
import { rankIvs } from '../src/stats/ivRank';

const gd = loadDefaultGameData();

describe('rankIvs', () => {
  const ranks = rankIvs(gd.species.get('medicham')!);

  it('covers all 4096 combinations for a species that fits the cap', () => {
    expect(ranks).toHaveLength(4096);
  });

  it('sorts by stat product descending with 1-based ranks', () => {
    expect(ranks[0]!.rank).toBe(1);
    for (let i = 1; i < ranks.length; i++) {
      expect(ranks[i - 1]!.statProduct).toBeGreaterThanOrEqual(ranks[i]!.statProduct);
    }
    expect(ranks[0]!.percentOfBest).toBe(100);
  });

  it('never exceeds the cap', () => {
    expect(ranks.every((r) => r.cp <= 1500)).toBe(true);
  });

  it('respects the IV floor', () => {
    const lucky = rankIvs(gd.species.get('medicham')!, { ivFloor: 12 });
    expect(lucky).toHaveLength(64);
    expect(lucky.every((r) => r.ivs.atk >= 12 && r.ivs.def >= 12 && r.ivs.hp >= 12)).toBe(true);
  });

  it('matches the stat product PvPoke publishes for its default Melmetal', () => {
    const entry = rankIvs(gd.species.get('melmetal')!).find((r) => r.ivs.atk === 4 && r.ivs.def === 10 && r.ivs.hp === 14)!;
    // rankings-1500.json lists stats.product 1858 (= atk*def*hp / 1000, rounded)
    expect(Math.round(entry.statProduct / 1000)).toBe(1858);
  });
});
```

- [ ] **Step 7: Run to confirm failure** → FAIL (module not found).

- [ ] **Step 8: Write `src/stats/ivRank.ts`**

```ts
import type { Species } from '../data/types';
import { StatsError } from '../errors';
import { bestLevelUnderCap, computeStats, type Ivs } from './stats';

export interface IvRankEntry {
  readonly rank: number;
  readonly ivs: Ivs;
  readonly level: number;
  readonly cp: number;
  readonly atk: number;
  readonly def: number;
  readonly hp: number;
  readonly statProduct: number;
  readonly percentOfBest: number;
}

export interface IvRankOptions {
  readonly cap?: number;
  readonly maxLevel?: number;
  /** Minimum IV per stat: 0 wild, 1 good friend, 2 great, 3 ultra, 4 best, 5 weather, 10 raid/research, 12 lucky. */
  readonly ivFloor?: number;
}

/** Rank every IV combination of a species by stat product at its best level under the cap. */
export function rankIvs(species: Species, opts: IvRankOptions = {}): IvRankEntry[] {
  const cap = opts.cap ?? 1500;
  const maxLevel = opts.maxLevel ?? 50;
  const floor = opts.ivFloor ?? 0;
  if (!Number.isInteger(floor) || floor < 0 || floor > 15) throw new StatsError(`ivFloor must be 0-15, got ${floor}`);

  const rows: Omit<IvRankEntry, 'rank' | 'percentOfBest'>[] = [];
  for (let atk = floor; atk <= 15; atk++) {
    for (let def = floor; def <= 15; def++) {
      for (let hp = floor; hp <= 15; hp++) {
        const ivs = { atk, def, hp };
        const level = bestLevelUnderCap(species.base, ivs, cap, maxLevel);
        if (level === null) continue;
        const s = computeStats(species.base, ivs, level, species.dex);
        rows.push({ ivs, level, cp: s.cp, atk: s.atk, def: s.def, hp: s.hp, statProduct: s.atk * s.def * s.hp });
      }
    }
  }
  rows.sort((a, b) => b.statProduct - a.statProduct);
  const best = rows[0]?.statProduct ?? 0;
  return rows.map((r, i) => ({ ...r, rank: i + 1, percentOfBest: best === 0 ? 0 : Math.round((r.statProduct / best) * 10000) / 100 }));
}
```

- [ ] **Step 9: Run tests, typecheck, commit**

Run: `npm test && npm run typecheck` → all PASS.

```bash
git add src/stats tests/stats.test.ts tests/ivRank.test.ts
git commit -m "feat: add CP/level computation and IV stat-product ranking"
```

---

### Task 4: Damage and buff math

**Files:**
- Create: `src/engine/constants.ts`, `src/engine/damage.ts`
- Test: `tests/damage.test.ts`

**Interfaces:**
- Consumes: `effectiveness` (Task 2), `computeStats` (Task 3).
- Produces:
  - constants `TURN_MS = 500`, `MAX_ENERGY = 100`, `PVP_BONUS`, `STAB_MULTIPLIER`, `SHADOW_ATK`, `SHADOW_DEF`
  - `buffMultiplier(stage: number, divisor: number): number`
  - `clampStage(stage: number, max: number): number`
  - `calcDamage(power: number, stab: number, attack: number, defense: number, eff: number): number`

- [ ] **Step 1: Write `src/engine/constants.ts`** (from `DamageCalculator.js:2-10`)

```ts
export const TURN_MS = 500;
export const MAX_ENERGY = 100;
export const PVP_BONUS = 1.2999999523162841796875;
export const STAB_MULTIPLIER = 1.2000000476837158203125;
export const SHADOW_ATK = 1.2;
export const SHADOW_DEF = 0.83333331;
```

- [ ] **Step 2: Write the failing damage tests** (reference hits observed in PvPoke's simulator)

```ts
// tests/damage.test.ts
import { describe, expect, it } from 'vitest';
import { effectiveness } from '../src/data/typeChart';
import { buffMultiplier, calcDamage, clampStage } from '../src/engine/damage';
import { STAB_MULTIPLIER } from '../src/engine/constants';

const MEDICHAM = { atk: 106.91840362548825, def: 139.4951047301292 };
const AZUMARILL = { atk: 93.41479969024648, def: 134.48509955406175 };

describe('calcDamage reproduces PvPoke hits', () => {
  it('Counter: Medicham -> Azumarill = 4', () => {
    expect(calcDamage(8, STAB_MULTIPLIER, MEDICHAM.atk, AZUMARILL.def, effectiveness('fighting', ['water', 'fairy']))).toBe(4);
  });
  it('Bubble: Azumarill -> Medicham = 5', () => {
    expect(calcDamage(8, STAB_MULTIPLIER, AZUMARILL.atk, MEDICHAM.def, effectiveness('water', ['fighting', 'psychic']))).toBe(5);
  });
  it('Counter mirror = 3', () => {
    expect(calcDamage(8, STAB_MULTIPLIER, MEDICHAM.atk, MEDICHAM.def, effectiveness('fighting', ['fighting', 'psychic']))).toBe(3);
  });
  it('Ice Punch: Medicham -> Azumarill = 20', () => {
    expect(calcDamage(60, 1, MEDICHAM.atk, AZUMARILL.def, effectiveness('ice', ['water', 'fairy']))).toBe(20);
  });
});

describe('buff math', () => {
  it('uses (d+n)/d for boosts and d/(d-n) for drops', () => {
    expect(buffMultiplier(0, 4)).toBe(1);
    expect(buffMultiplier(1, 4)).toBe(1.25);
    expect(buffMultiplier(4, 4)).toBe(2);
    expect(buffMultiplier(-1, 4)).toBe(0.8);
    expect(buffMultiplier(-4, 4)).toBe(0.5);
  });
  it('clamps stages to +-max', () => {
    expect(clampStage(6, 4)).toBe(4);
    expect(clampStage(-5, 4)).toBe(-4);
    expect(clampStage(2, 4)).toBe(2);
  });
});
```

- [ ] **Step 3: Run to confirm failure** → FAIL (module not found).

- [ ] **Step 4: Write `src/engine/damage.ts`**

```ts
import { PVP_BONUS } from './constants';

/** Return the stat multiplier for a buff stage, as PvPoke Pokemon.getStatBuffMultiplier. */
export function buffMultiplier(stage: number, divisor: number): number {
  return stage > 0 ? (divisor + stage) / divisor : divisor / (divisor - stage);
}

/** Clamp a buff stage to [-max, max]. */
export function clampStage(stage: number, max: number): number {
  return Math.max(-max, Math.min(max, stage));
}

/** Compute one hit's damage; operand order matches PvPoke DamageCalculator.damage for float exactness. */
export function calcDamage(power: number, stab: number, attack: number, defense: number, eff: number): number {
  return Math.floor(power * stab * (attack / defense) * eff * 0.5 * PVP_BONUS) + 1;
}
```

- [ ] **Step 5: Run tests, typecheck, commit**

Run: `npm test && npm run typecheck` → PASS.

```bash
git add src/engine tests/damage.test.ts
git commit -m "feat: add float-exact damage and buff math"
```

---

### Task 5: Combatant builder

**Files:**
- Create: `src/engine/combatant.ts`
- Test: `tests/combatant.test.ts`

**Interfaces:**
- Consumes: `GameData`, `Species`, `computeStats`, `bestLevelUnderCap`, `effectiveness`, constants, `buffMultiplier`, `calcDamage`.
- Produces:
  - `interface PolicySettings { baitShields: 0 | 1 | 2; optimizeMoveTiming: boolean; farmEnergy: boolean }`
  - `interface Combatant { species; ivs: Ivs; level; cp; stats: { atk; def; hp }; shadow: boolean; fastMove: FastMove; chargedMoves: readonly ChargedMove[]; settings: PolicySettings }`
  - `interface CombatantSpec { speciesId: string; fastMoveId: string; chargedMoveIds: readonly string[]; ivs?: Ivs; level?: number; cpCap?: number; maxLevel?: number; settings?: Partial<PolicySettings> }`
  - `buildCombatant(gd: GameData, spec: CombatantSpec): Combatant`
  - `effectiveStat(c: Combatant, which: 'atk' | 'def', stage: number, divisor: number): number`
  - `moveDamage(attacker: Combatant, attackerAtkStage: number, defender: Combatant, defenderDefStage: number, move: Move, divisor: number): number`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/combatant.test.ts
import { describe, expect, it } from 'vitest';
import { loadDefaultGameData } from '../src/data';
import { GameDataError, StatsError, UnsupportedPokemonError } from '../src/errors';
import { buildCombatant, effectiveStat, moveDamage } from '../src/engine/combatant';

const gd = loadDefaultGameData();

describe('buildCombatant', () => {
  it('defaults to PvPoke default IVs and level for Great League', () => {
    const c = buildCombatant(gd, { speciesId: 'medicham', fastMoveId: 'COUNTER', chargedMoveIds: ['ICE_PUNCH', 'PSYCHIC'] });
    expect(c.ivs).toEqual({ atk: 7, def: 15, hp: 14 });
    expect(c.level).toBe(49);
    expect(c.cp).toBe(1500);
    expect(c.stats.hp).toBe(141);
    expect(c.settings).toEqual({ baitShields: 1, optimizeMoveTiming: true, farmEnergy: false });
  });

  it('finds the best level under the cap for custom IVs', () => {
    const c = buildCombatant(gd, { speciesId: 'azumarill', fastMoveId: 'BUBBLE', chargedMoveIds: ['ICE_BEAM'], ivs: { atk: 4, def: 15, hp: 13 } });
    expect(c.level).toBe(43);
    expect(c.chargedMoves).toHaveLength(1);
  });

  it('applies shadow multipliers in effective stats only', () => {
    const c = buildCombatant(gd, { speciesId: 'registeel_shadow', fastMoveId: 'LOCK_ON', chargedMoveIds: ['FOCUS_BLAST'] });
    expect(c.shadow).toBe(true);
    expect(effectiveStat(c, 'atk', 0, 4)).toBe(c.stats.atk * 1.2);
    expect(effectiveStat(c, 'def', 0, 4)).toBe(c.stats.def * 0.83333331);
  });

  it('accepts elite moves and rejects moves outside the pool', () => {
    expect(() => buildCombatant(gd, { speciesId: 'melmetal', fastMoveId: 'THUNDER_SHOCK', chargedMoveIds: ['DOUBLE_IRON_BASH'] })).not.toThrow();
    expect(() => buildCombatant(gd, { speciesId: 'medicham', fastMoveId: 'BUBBLE', chargedMoveIds: ['ICE_PUNCH'] }))
      .toThrow(new GameDataError('medicham cannot learn fast move BUBBLE'));
  });

  it('requires one or two charged moves', () => {
    expect(() => buildCombatant(gd, { speciesId: 'medicham', fastMoveId: 'COUNTER', chargedMoveIds: [] })).toThrow(GameDataError);
  });

  it('rejects unknown species, form changers and megas', () => {
    expect(() => buildCombatant(gd, { speciesId: 'nope', fastMoveId: 'X', chargedMoveIds: ['Y'] })).toThrow(GameDataError);
    expect(() => buildCombatant(gd, { speciesId: 'mimikyu', fastMoveId: 'SHADOW_CLAW', chargedMoveIds: ['PLAY_ROUGH'] }))
      .toThrow(UnsupportedPokemonError);
    expect(() => buildCombatant(gd, { speciesId: 'medicham_mega', fastMoveId: 'COUNTER', chargedMoveIds: ['ICE_PUNCH'] }))
      .toThrow(UnsupportedPokemonError);
  });

  it('rejects IVs that cannot fit under the cap and levels above max', () => {
    expect(() => buildCombatant(gd, { speciesId: 'medicham', fastMoveId: 'COUNTER', chargedMoveIds: ['ICE_PUNCH'], ivs: { atk: 15, def: 15, hp: 15 }, cpCap: 10 }))
      .toThrow(StatsError);
    expect(() => buildCombatant(gd, { speciesId: 'medicham', fastMoveId: 'COUNTER', chargedMoveIds: ['ICE_PUNCH'], ivs: { atk: 0, def: 0, hp: 0 }, level: 52 }))
      .toThrow(StatsError);
  });
});

describe('moveDamage', () => {
  it('reproduces PvPoke hits including STAB and effectiveness', () => {
    const med = buildCombatant(gd, { speciesId: 'medicham', fastMoveId: 'COUNTER', chargedMoveIds: ['ICE_PUNCH'] });
    const azu = buildCombatant(gd, { speciesId: 'azumarill', fastMoveId: 'BUBBLE', chargedMoveIds: ['ICE_BEAM'] });
    expect(moveDamage(med, 0, azu, 0, med.fastMove, 4)).toBe(4);
    expect(moveDamage(azu, 0, med, 0, azu.fastMove, 4)).toBe(5);
    expect(moveDamage(med, 0, azu, 0, med.chargedMoves[0]!, 4)).toBe(20);
  });
});
```

- [ ] **Step 2: Run to confirm failure** → FAIL (module not found).

- [ ] **Step 3: Write `src/engine/combatant.ts`**

```ts
import type { ChargedMove, FastMove, GameData, Move, Species } from '../data/types';
import { effectiveness } from '../data/typeChart';
import { GameDataError, StatsError, UnsupportedPokemonError } from '../errors';
import { bestLevelUnderCap, computeStats, type Ivs } from '../stats/stats';
import { SHADOW_ATK, SHADOW_DEF, STAB_MULTIPLIER } from './constants';
import { buffMultiplier, calcDamage } from './damage';

export interface PolicySettings {
  /** 0 never baits, 1 baits selectively, 2 always baits (PvPoke Pokemon.baitShields). */
  readonly baitShields: 0 | 1 | 2;
  readonly optimizeMoveTiming: boolean;
  /** Fast moves only. */
  readonly farmEnergy: boolean;
}

export interface Combatant {
  readonly species: Species;
  readonly ivs: Ivs;
  readonly level: number;
  readonly cp: number;
  readonly stats: { readonly atk: number; readonly def: number; readonly hp: number };
  readonly shadow: boolean;
  readonly fastMove: FastMove;
  readonly chargedMoves: readonly ChargedMove[];
  readonly settings: PolicySettings;
}

export interface CombatantSpec {
  readonly speciesId: string;
  readonly fastMoveId: string;
  readonly chargedMoveIds: readonly string[];
  readonly ivs?: Ivs;
  readonly level?: number;
  readonly cpCap?: number;
  readonly maxLevel?: number;
  readonly settings?: Partial<PolicySettings>;
}

const DEFAULT_SETTINGS: PolicySettings = { baitShields: 1, optimizeMoveTiming: true, farmEnergy: false };

function assertSupported(species: Species, moves: readonly Move[]): void {
  if (species.hasFormChange) throw new UnsupportedPokemonError(`${species.id} changes form in battle; not modelled yet`);
  if (species.tags.includes('mega')) throw new UnsupportedPokemonError(`${species.id} is a mega; not modelled yet`);
  for (const move of moves) {
    if (move.damageMethod !== 'default') throw new UnsupportedPokemonError(`${move.id} uses damage method ${move.damageMethod}`);
    if (move.kind === 'fast' && move.buffs) throw new UnsupportedPokemonError(`${move.id} is a fast move with buffs`);
  }
}

function resolveLevel(species: Species, spec: CombatantSpec, ivs: Ivs, cap: number, maxLevel: number): number {
  if (spec.level !== undefined) {
    if (spec.level > maxLevel) throw new StatsError(`Level ${spec.level} exceeds max level ${maxLevel}`);
    return spec.level;
  }
  if (!spec.ivs && cap === 1500) return species.defaultIvsGreat.level;
  const level = bestLevelUnderCap(species.base, ivs, cap, maxLevel);
  if (level === null) throw new StatsError(`${species.id} ${ivs.atk}/${ivs.def}/${ivs.hp} cannot fit under ${cap} CP`);
  return level;
}

/** Build a battle-ready Pokémon from a species, moves and optional IVs/level. */
export function buildCombatant(gd: GameData, spec: CombatantSpec): Combatant {
  const species = gd.species.get(spec.speciesId);
  if (!species) throw new GameDataError(`Unknown species ${spec.speciesId}`);

  if (!species.fastMoveIds.includes(spec.fastMoveId)) {
    throw new GameDataError(`${species.id} cannot learn fast move ${spec.fastMoveId}`);
  }
  if (spec.chargedMoveIds.length < 1 || spec.chargedMoveIds.length > 2) {
    throw new GameDataError(`${species.id} needs one or two charged moves, got ${spec.chargedMoveIds.length}`);
  }
  for (const id of spec.chargedMoveIds) {
    if (!species.chargedMoveIds.includes(id)) throw new GameDataError(`${species.id} cannot learn charged move ${id}`);
  }
  const fastMove = gd.moves.get(spec.fastMoveId) as FastMove;
  const chargedMoves = spec.chargedMoveIds.map((id) => gd.moves.get(id) as ChargedMove);
  assertSupported(species, [fastMove, ...chargedMoves]);

  const cap = spec.cpCap ?? 1500;
  const maxLevel = spec.maxLevel ?? 50;
  const d = species.defaultIvsGreat;
  const ivs = spec.ivs ?? (cap === 1500 ? { atk: d.atk, def: d.def, hp: d.hp } : { atk: 15, def: 15, hp: 15 });
  const level = resolveLevel(species, spec, ivs, cap, maxLevel);
  const stats = computeStats(species.base, ivs, level, species.dex);
  if (stats.cp > cap) throw new StatsError(`${species.id} at level ${level} is ${stats.cp} CP, over the ${cap} cap`);

  return {
    species,
    ivs,
    level,
    cp: stats.cp,
    stats: { atk: stats.atk, def: stats.def, hp: stats.hp },
    shadow: species.tags.includes('shadow'),
    fastMove,
    chargedMoves,
    settings: { ...DEFAULT_SETTINGS, ...spec.settings },
  };
}

/** Return attack or defense after buff stage and shadow multiplier (PvPoke Pokemon.getEffectiveStat). */
export function effectiveStat(c: Combatant, which: 'atk' | 'def', stage: number, divisor: number): number {
  let multiplier = buffMultiplier(stage, divisor);
  if (c.shadow) multiplier *= which === 'atk' ? SHADOW_ATK : SHADOW_DEF;
  return c.stats[which] * multiplier;
}

/** Compute the damage one use of a move deals given current buff stages. */
export function moveDamage(
  attacker: Combatant, attackerAtkStage: number, defender: Combatant, defenderDefStage: number, move: Move, divisor: number,
): number {
  const stab = attacker.species.types.includes(move.type) ? STAB_MULTIPLIER : 1;
  return calcDamage(
    move.power,
    stab,
    effectiveStat(attacker, 'atk', attackerAtkStage, divisor),
    effectiveStat(defender, 'def', defenderDefStage, divisor),
    effectiveness(move.type, defender.species.types),
  );
}
```

- [ ] **Step 4: Run tests, typecheck, commit**

Run: `npm test && npm run typecheck` → PASS.

```bash
git add src/engine/combatant.ts tests/combatant.test.ts
git commit -m "feat: add combatant builder with support checks"
```

---

### Task 6: Battle state and turn resolution

**Files:**
- Create: `src/engine/state.ts`, `src/engine/turn.ts`
- Test: `tests/turn.test.ts`

**Interfaces:**
- Consumes: `Combatant`, `moveDamage`, `clampStage`, constants, `IllegalActionError`.
- Produces:
  - `type Side = 0 | 1`; `other(side: Side): Side`
  - `interface SideState { hp; energy; cooldownMs; shields; buffs: StatPair; faintSource: 'none' | 'fast' | 'charged'; buffMeters: readonly (number | null)[]; lastDamage: { fast: number; charged: readonly number[] } }`
  - `interface QueuedAction { type: 'fast' | 'charged' | 'wait'; actor: Side; turn: number; chargedIndex: number; priority: number }`
  - `interface BattleRules { maxBuffStages: number; buffDivisor: number }`
  - `interface BattleState { combatants: readonly [Combatant, Combatant]; sides: readonly [SideState, SideState]; rules: BattleRules; turn: number; queue: readonly QueuedAction[]; chargedLastTurn: boolean; usePriority: boolean; over: boolean }`
  - `interface BattleSetup { shields: readonly [number, number]; startEnergy?: readonly [number, number] }`
  - `createBattle(combatants: readonly [Combatant, Combatant], setup: BattleSetup, rules: BattleRules): BattleState`
  - `type Action = { type: 'fast' } | { type: 'charged'; index: number } | { type: 'wait' }`
  - `type ShieldDecider = (state: BattleState, defender: Side, moveIndex: number, damage: number) => boolean`
  - `type BattleEvent` (union below)
  - `beginTurn(state: BattleState): BattleState`
  - `canAct(state: BattleState, side: Side): boolean`
  - `resolveTurn(state: BattleState, actions: readonly [Action | null, Action | null], decideShield: ShieldDecider): { state: BattleState; events: BattleEvent[] }`

Semantics to reproduce (PvPoke `Battle.step`, `Battle.js:278-607`; `useMove`, `Battle.js:1016-1656`):
1. `beginTurn`: each cooldown −500 (floor 0).
2. `canAct(side)`: not over, cooldown 0, both alive, and no charged move resolved last turn.
3. Queueing: fast adds the fast move's cooldown to the actor's cooldown; charged adds 500. Priority: 0, charged +10, +1 more if the actor's raw `stats.atk` > opponent's.
4. Eligibility: fast when `(turn − queuedTurn)·500 ≥ cooldown − 500`, or when a charged move resolved last turn and it was queued on an earlier turn; charged and wait immediately.
5. Eligible actions sort by priority descending (stable: queue order otherwise).
6. Fast resolves unless the opponent has HP < 1, or the actor has HP < 1 having fainted to a charged move. Fast: damage, energy + gain (cap 100), then HP.
7. Charged resolves if energy ≥ cost, and not (usePriority ∧ actor HP ≤ 0 ∧ fainted to charged ∧ move lacks `ignoresFaint`). Charged: damage computed and cached in `lastDamage`, energy − cost, then shield decision (if shields > 0 and move not `instant`) → damage 1, then HP, then buffs.
8. Buffs: chance 1 always; chance < 1 uses the meter (start = chance, or 0 when chance is exactly 0.5; add chance per use; applies when floor crosses an integer). Opponent target applied before self target. Clamp ±maxBuffStages.
9. After any charged move this turn, both cooldowns become 500.
10. `usePriority` = raw attacks differ.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/turn.test.ts
import { describe, expect, it } from 'vitest';
import { loadDefaultGameData } from '../src/data';
import { IllegalActionError } from '../src/errors';
import { buildCombatant, type CombatantSpec } from '../src/engine/combatant';
import { createBattle, type BattleState, type Side } from '../src/engine/state';
import { beginTurn, canAct, resolveTurn, type Action, type BattleEvent, type ShieldDecider } from '../src/engine/turn';

const gd = loadDefaultGameData();
const rules = { maxBuffStages: gd.maxBuffStages, buffDivisor: gd.buffDivisor };
const med = (charged: string[] = ['ICE_PUNCH', 'PSYCHIC']): CombatantSpec => ({ speciesId: 'medicham', fastMoveId: 'COUNTER', chargedMoveIds: charged });
const azu: CombatantSpec = { speciesId: 'azumarill', fastMoveId: 'BUBBLE', chargedMoveIds: ['ICE_BEAM', 'PLAY_ROUGH'] };

function battle(a: CombatantSpec, b: CombatantSpec, shields: [number, number] = [0, 0], startEnergy?: [number, number]): BattleState {
  return createBattle([buildCombatant(gd, a), buildCombatant(gd, b)], { shields, startEnergy }, rules);
}

const never: ShieldDecider = () => false;
const always: ShieldDecider = () => true;

/** Drive one turn where each side that can act uses the given chooser. */
function turn(s: BattleState, choose: (st: BattleState, side: Side) => Action, shield: ShieldDecider = never) {
  const pre = beginTurn(s);
  const actions = [0, 1].map((side) => (canAct(pre, side as Side) ? choose(pre, side as Side) : null)) as [Action | null, Action | null];
  return resolveTurn(pre, actions, shield);
}

function runFastOnly(s: BattleState): { state: BattleState; events: BattleEvent[] } {
  const events: BattleEvent[] = [];
  while (!s.over) {
    const r = turn(s, () => ({ type: 'fast' }));
    events.push(...r.events);
    s = r.state;
  }
  return { state: s, events };
}

describe('fast move timing', () => {
  it('lands a 2-turn move on turn 2 and a 3-turn move on turn 3', () => {
    const { events } = runFastOnly(battle(med(), azu));
    const fasts = events.filter((e) => e.kind === 'fast').slice(0, 3);
    expect(fasts.map((e) => [e.turn, e.side, e.damage])).toEqual([[2, 0, 4], [3, 1, 5], [4, 0, 4]]);
  });

  it('Medicham vs Azumarill fast-only ends on turn 87 with Azumarill at 19 HP (PvPoke: 450/549)', () => {
    const { state, events } = runFastOnly(battle(med(), azu));
    expect(state.sides[0].hp).toBe(0);
    expect(state.sides[1].hp).toBe(19);
    expect(events.at(-1)).toEqual({ kind: 'faint', turn: 87, side: 0 });
  });

  it('mirror double-KOs on the same turn', () => {
    const { state } = runFastOnly(battle(med(), med()));
    expect(state.sides.map((s) => s.hp)).toEqual([0, 0]);
  });

  it('caps energy at 100', () => {
    let s = battle(med(), { ...azu, speciesId: 'azumarill' });
    for (let i = 0; i < 40; i++) s = turn(s, () => ({ type: 'fast' })).state;
    expect(s.sides[0].energy).toBe(100);
  });
});

describe('charged moves', () => {
  it('spends energy, deals cached damage and blocks to 1 with a shield', () => {
    let s = battle(med(), azu, [1, 1], [40, 0]);
    const r = turn(s, (_st, side) => (side === 0 ? { type: 'charged', index: 0 } : { type: 'fast' }), always);
    s = r.state;
    expect(s.sides[0].energy).toBe(0);
    expect(s.sides[0].lastDamage.charged[0]).toBe(20);
    expect(s.sides[1].shields).toBe(0);
    expect(s.sides[1].hp).toBe(191 - 1);
    expect(r.events.find((e) => e.kind === 'charged')).toMatchObject({ side: 0, damage: 1, shielded: true });
  });

  it('resets both cooldowns to 500 and blocks new actions the next turn', () => {
    const s = turn(battle(med(), azu, [0, 0], [40, 0]), (_st, side) => (side === 0 ? { type: 'charged', index: 0 } : { type: 'fast' })).state;
    expect(s.sides.map((x) => x.cooldownMs)).toEqual([500, 500]);
    const pre = beginTurn(s);
    expect(canAct(pre, 0)).toBe(false);
    expect(canAct(pre, 1)).toBe(false);
  });

  it('resolves the higher raw attack first (CMP)', () => {
    const r = turn(battle(med(), azu, [0, 0], [100, 100]), () => ({ type: 'charged', index: 0 }));
    const order = r.events.filter((e) => e.kind === 'charged').map((e) => e.side);
    expect(order).toEqual([0, 1]);
  });

  it('with equal attack both charged moves resolve even if the first KOs', () => {
    const lowHp = battle(med(), med(), [0, 0], [100, 100]);
    const s = { ...lowHp, sides: [{ ...lowHp.sides[0], hp: 1 }, { ...lowHp.sides[1], hp: 1 }] as const };
    const r = turn(s, () => ({ type: 'charged', index: 0 }));
    expect(r.events.filter((e) => e.kind === 'charged')).toHaveLength(2);
    expect(r.state.sides.map((x) => x.hp)).toEqual([0, 0]);
  });

  it('with different attack the KO-d side does not fire', () => {
    const base = battle(med(), azu, [0, 0], [100, 100]);
    const s = { ...base, sides: [base.sides[0], { ...base.sides[1], hp: 1 }] as const };
    const r = turn(s, () => ({ type: 'charged', index: 0 }));
    expect(r.events.filter((e) => e.kind === 'charged').map((e) => e.side)).toEqual([0]);
  });

  it('rejects a charged move without enough energy', () => {
    const pre = beginTurn(battle(med(), azu));
    expect(() => resolveTurn(pre, [{ type: 'charged', index: 0 }, null], never)).toThrow(IllegalActionError);
  });

  it('rejects an action from a side that cannot act', () => {
    const s = turn(battle(med(), azu), () => ({ type: 'fast' })).state; // Medicham now mid-Counter
    const pre = beginTurn(s);
    expect(canAct(pre, 0)).toBe(false);
    expect(() => resolveTurn(pre, [{ type: 'fast' }, null], never)).toThrow(IllegalActionError);
  });
});

describe('buffs', () => {
  it('applies guaranteed self buffs (Power-Up Punch +1 atk)', () => {
    const r = turn(battle(med(['POWER_UP_PUNCH']), azu, [0, 0], [35, 0]), (_s, side) => (side === 0 ? { type: 'charged', index: 0 } : { type: 'fast' }));
    expect(r.state.sides[0].buffs).toEqual([1, 0]);
  });

  it('applies opponent debuffs even when shielded (Acid Spray -2 def)', () => {
    const s = createBattle(
      [buildCombatant(gd, { speciesId: 'qwilfish', fastMoveId: 'POISON_STING', chargedMoveIds: ['ACID_SPRAY'] }), buildCombatant(gd, azu)],
      { shields: [0, 1], startEnergy: [45, 0] }, rules,
    );
    const r = turn(s, (_st, side) => (side === 0 ? { type: 'charged', index: 0 } : { type: 'fast' }), always);
    expect(r.state.sides[1].shields).toBe(0);
    expect(r.state.sides[1].hp).toBe(s.sides[1].hp - 1);
    expect(r.state.sides[1].buffs).toEqual([0, -2]);
  });

  it('applies a 10% buff deterministically on the 10th use', () => {
    let s = battle(med(['PSYCHIC']), { speciesId: 'azumarill', fastMoveId: 'BUBBLE', chargedMoveIds: ['ICE_BEAM'] }, [0, 0]);
    const uses: number[] = [];
    for (let use = 1; use <= 10; use++) {
      const prepared = { ...s, sides: [{ ...s.sides[0], energy: 100, cooldownMs: 0 }, { ...s.sides[1], hp: 10_000 }] as const, chargedLastTurn: false };
      const r = resolveTurn(beginTurn(prepared), [{ type: 'charged', index: 0 }, null], never);
      if (r.events.some((e) => e.kind === 'buff')) uses.push(use);
      s = r.state;
    }
    expect(uses).toEqual([10]);
  });

  it('clamps stages at +4', () => {
    let s = battle(med(['POWER_UP_PUNCH']), azu);
    for (let i = 0; i < 6; i++) {
      const prepared = { ...s, sides: [{ ...s.sides[0], energy: 100, cooldownMs: 0 }, { ...s.sides[1], hp: 10_000 }] as const, chargedLastTurn: false };
      s = resolveTurn(beginTurn(prepared), [{ type: 'charged', index: 0 }, null], never).state;
    }
    expect(s.sides[0].buffs[0]).toBe(4);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run tests/turn.test.ts` → FAIL (modules not found).

- [ ] **Step 3: Write `src/engine/state.ts`**

```ts
import type { StatPair } from '../data/types';
import type { Combatant } from './combatant';
import { MAX_ENERGY } from './constants';
import { clampStage } from './damage';
import { moveDamage } from './combatant';

export type Side = 0 | 1;
export const SIDES: readonly Side[] = [0, 1];

/** Return the opposing side. */
export function other(side: Side): Side {
  return side === 0 ? 1 : 0;
}

export interface SideState {
  readonly hp: number;
  readonly energy: number;
  readonly cooldownMs: number;
  readonly shields: number;
  readonly buffs: StatPair;
  readonly faintSource: 'none' | 'fast' | 'charged';
  /** PvPoke buffApplyMeter per charged move; null when the move has no chance-based buff. */
  readonly buffMeters: readonly (number | null)[];
  /** PvPoke's mutable move.damage: last computed damage per move, read by decision logic. */
  readonly lastDamage: { readonly fast: number; readonly charged: readonly number[] };
}

export interface QueuedAction {
  readonly type: 'fast' | 'charged' | 'wait';
  readonly actor: Side;
  readonly turn: number;
  readonly chargedIndex: number;
  readonly priority: number;
}

export interface BattleRules {
  readonly maxBuffStages: number;
  readonly buffDivisor: number;
}

export interface BattleState {
  readonly combatants: readonly [Combatant, Combatant];
  readonly sides: readonly [SideState, SideState];
  readonly rules: BattleRules;
  readonly turn: number;
  readonly queue: readonly QueuedAction[];
  readonly chargedLastTurn: boolean;
  readonly usePriority: boolean;
  readonly over: boolean;
}

export interface BattleSetup {
  readonly shields: readonly [number, number];
  readonly startEnergy?: readonly [number, number];
}

function initialMeter(chance: number | undefined): number | null {
  if (chance === undefined || chance >= 1) return null;
  // PvPoke Pokemon.resetMoves: 50% moves apply on the second use
  return chance === 0.5 ? 0 : chance;
}

/** Create the starting state of a 1v1 battle. */
export function createBattle(combatants: readonly [Combatant, Combatant], setup: BattleSetup, rules: BattleRules): BattleState {
  const buffs = combatants.map((c) => [
    clampStage(c.species.nativeStatBuffs[0], rules.maxBuffStages),
    clampStage(c.species.nativeStatBuffs[1], rules.maxBuffStages),
  ] as const);

  const side = (i: Side): SideState => {
    const me = combatants[i];
    const opp = combatants[other(i)];
    const dmg = (move: Combatant['fastMove'] | Combatant['chargedMoves'][number]) =>
      moveDamage(me, buffs[i]![0], opp, buffs[other(i)]![1], move, rules.buffDivisor);
    return {
      hp: me.stats.hp,
      energy: Math.min(setup.startEnergy?.[i] ?? 0, MAX_ENERGY),
      cooldownMs: 0,
      shields: setup.shields[i],
      buffs: buffs[i]!,
      faintSource: 'none',
      buffMeters: me.chargedMoves.map((m) => initialMeter(m.buffs?.chance)),
      lastDamage: { fast: dmg(me.fastMove), charged: me.chargedMoves.map(dmg) },
    };
  };

  return {
    combatants,
    sides: [side(0), side(1)],
    rules,
    turn: 1,
    queue: [],
    chargedLastTurn: false,
    usePriority: combatants[0].stats.atk !== combatants[1].stats.atk,
    over: false,
  };
}
```

- [ ] **Step 4: Write `src/engine/turn.ts`**

```ts
import type { StatPair } from '../data/types';
import { IllegalActionError } from '../errors';
import { moveDamage } from './combatant';
import { MAX_ENERGY, TURN_MS } from './constants';
import { clampStage } from './damage';
import { SIDES, other, type BattleState, type QueuedAction, type Side, type SideState } from './state';

export type Action = { readonly type: 'fast' } | { readonly type: 'charged'; readonly index: number } | { readonly type: 'wait' };

export type ShieldDecider = (state: BattleState, defender: Side, moveIndex: number, damage: number) => boolean;

export type BattleEvent =
  | { readonly kind: 'fast'; readonly turn: number; readonly side: Side; readonly moveId: string; readonly damage: number; readonly energyGained: number }
  | { readonly kind: 'charged'; readonly turn: number; readonly side: Side; readonly moveId: string; readonly damage: number; readonly shielded: boolean }
  | { readonly kind: 'buff'; readonly turn: number; readonly side: Side; readonly stages: StatPair; readonly sourceMoveId: string }
  | { readonly kind: 'faint'; readonly turn: number; readonly side: Side };

/** Start a turn: tick both cooldowns down by one turn. */
export function beginTurn(state: BattleState): BattleState {
  const tick = (s: SideState): SideState => ({ ...s, cooldownMs: Math.max(0, s.cooldownMs - TURN_MS) });
  return { ...state, sides: [tick(state.sides[0]), tick(state.sides[1])] };
}

/** Whether a side may choose an action this turn. */
export function canAct(state: BattleState, side: Side): boolean {
  const me = state.sides[side];
  const opp = state.sides[other(side)];
  return !state.over && !state.chargedLastTurn && me.cooldownMs === 0 && me.hp > 0 && opp.hp > 0;
}

function addStages(current: StatPair, delta: StatPair, max: number): StatPair {
  return [clampStage(current[0] + delta[0], max), clampStage(current[1] + delta[1], max)];
}

/** Resolve a turn given each side's chosen action (null when it cannot or does not act). */
export function resolveTurn(
  state: BattleState, actions: readonly [Action | null, Action | null], decideShield: ShieldDecider,
): { state: BattleState; events: BattleEvent[] } {
  const { combatants, rules } = state;
  const sides: [SideState, SideState] = [state.sides[0], state.sides[1]];
  const events: BattleEvent[] = [];
  const queue: QueuedAction[] = [...state.queue];
  const cooldowns: [number, number] = [sides[0].cooldownMs, sides[1].cooldownMs];

  for (const side of SIDES) {
    const action = actions[side];
    if (!action) continue;
    if (!canAct(state, side)) throw new IllegalActionError(`Side ${side} cannot act on turn ${state.turn}`);
    let chargedIndex = -1;
    let priority = 0;
    if (action.type === 'fast') {
      cooldowns[side] += combatants[side].fastMove.cooldownMs;
    } else if (action.type === 'charged') {
      const move = combatants[side].chargedMoves[action.index];
      if (!move) throw new IllegalActionError(`Side ${side} has no charged move ${action.index}`);
      if (sides[side].energy < move.energy) {
        throw new IllegalActionError(`Side ${side} has ${sides[side].energy} energy, ${move.id} needs ${move.energy}`);
      }
      chargedIndex = action.index;
      cooldowns[side] += TURN_MS;
      // PvPoke Battle.getTurnAction priority: charged +10, +1 for higher raw attack (CMP)
      priority = 10 + (combatants[side].stats.atk > combatants[other(side)].stats.atk ? 1 : 0);
    }
    queue.push({ type: action.type, actor: side, turn: state.turn, chargedIndex, priority });
  }
  sides[0] = { ...sides[0], cooldownMs: cooldowns[0] };
  sides[1] = { ...sides[1], cooldownMs: cooldowns[1] };

  const turnActions: QueuedAction[] = [];
  const remaining: QueuedAction[] = [];
  for (const q of queue) {
    const eligible = q.type !== 'fast'
      || (state.turn - q.turn) * TURN_MS >= combatants[q.actor].fastMove.cooldownMs - TURN_MS
      || (state.chargedLastTurn && q.turn < state.turn);
    (eligible ? turnActions : remaining).push(q);
  }
  turnActions.sort((a, b) => b.priority - a.priority);

  const snapshot = (): BattleState => ({ ...state, sides: [sides[0], sides[1]] });
  let chargedUsed = 0;

  for (const act of turnActions) {
    const me = act.actor;
    const op = other(me);
    const attacker = combatants[me];
    const defender = combatants[op];

    if (act.type === 'fast') {
      if (sides[op].hp < 1) continue;
      if (sides[me].hp < 1 && sides[me].faintSource === 'charged') continue;
      const move = attacker.fastMove;
      const damage = moveDamage(attacker, sides[me].buffs[0], defender, sides[op].buffs[1], move, rules.buffDivisor);
      sides[me] = {
        ...sides[me],
        energy: Math.min(MAX_ENERGY, sides[me].energy + move.energyGain),
        lastDamage: { ...sides[me].lastDamage, fast: damage },
      };
      const hp = Math.max(0, sides[op].hp - damage);
      sides[op] = { ...sides[op], hp, faintSource: hp <= 0 ? 'fast' : sides[op].faintSource };
      events.push({ kind: 'fast', turn: state.turn, side: me, moveId: move.id, damage, energyGained: move.energyGain });
    } else if (act.type === 'charged') {
      const idx = act.chargedIndex;
      const move = attacker.chargedMoves[idx]!;
      if (sides[me].energy < move.energy) continue;
      if (state.usePriority && sides[me].hp <= 0 && sides[me].faintSource === 'charged' && !move.tags.includes('ignoresFaint')) continue;

      let damage = moveDamage(attacker, sides[me].buffs[0], defender, sides[op].buffs[1], move, rules.buffDivisor);
      const charged = [...sides[me].lastDamage.charged];
      charged[idx] = damage;
      sides[me] = { ...sides[me], energy: sides[me].energy - move.energy, lastDamage: { ...sides[me].lastDamage, charged } };

      let shielded = false;
      if (sides[op].shields > 0 && !move.tags.includes('instant') && decideShield(snapshot(), op, idx, damage)) {
        shielded = true;
        damage = 1;
        sides[op] = { ...sides[op], shields: sides[op].shields - 1 };
      }
      const hp = Math.max(0, sides[op].hp - damage);
      sides[op] = { ...sides[op], hp, faintSource: hp <= 0 ? 'charged' : sides[op].faintSource };
      events.push({ kind: 'charged', turn: state.turn, side: me, moveId: move.id, damage, shielded });
      chargedUsed++;

      const buffs = move.buffs;
      if (buffs) {
        let applies = buffs.chance === 1;
        const meter = sides[me].buffMeters[idx];
        if (buffs.chance < 1 && meter !== null && meter !== undefined) {
          // PvPoke Battle.js:1401-1410 deterministic buff meter
          const next = meter + buffs.chance;
          applies = Math.floor(next) > Math.floor(meter);
          const meters = [...sides[me].buffMeters];
          meters[idx] = next;
          sides[me] = { ...sides[me], buffMeters: meters };
        }
        if (applies) {
          if (buffs.target === 'opponent' || buffs.target === 'both') {
            const stages = buffs.target === 'both' ? buffs.opponentStages! : buffs.stages;
            sides[op] = { ...sides[op], buffs: addStages(sides[op].buffs, stages, rules.maxBuffStages) };
            events.push({ kind: 'buff', turn: state.turn, side: op, stages, sourceMoveId: move.id });
          }
          if (buffs.target === 'self' || buffs.target === 'both') {
            const stages = buffs.target === 'both' ? buffs.selfStages! : buffs.stages;
            sides[me] = { ...sides[me], buffs: addStages(sides[me].buffs, stages, rules.maxBuffStages) };
            events.push({ kind: 'buff', turn: state.turn, side: me, stages, sourceMoveId: move.id });
          }
        }
      }
    }
  }

  if (chargedUsed > 0) {
    sides[0] = { ...sides[0], cooldownMs: TURN_MS };
    sides[1] = { ...sides[1], cooldownMs: TURN_MS };
  }
  for (const side of SIDES) {
    if (sides[side].hp <= 0) events.push({ kind: 'faint', turn: state.turn, side });
  }

  return {
    state: {
      ...state,
      sides,
      queue: remaining,
      turn: state.turn + 1,
      chargedLastTurn: turnActions.some((a) => a.type === 'charged'),
      over: sides[0].hp <= 0 || sides[1].hp <= 0,
    },
    events,
  };
}
```

- [ ] **Step 5: Run turn tests**

Run: `npx vitest run tests/turn.test.ts`
Expected: PASS. If the "turn 87 / 19 HP" test fails, compare against PvPoke via Task 9's harness before changing it — that number was computed by hand and matches PvPoke's 450/549 rating.

- [ ] **Step 6: Full suite, typecheck, commit**

```bash
npm test && npm run typecheck
git add src/engine/state.ts src/engine/turn.ts tests/turn.test.ts
git commit -m "feat: add deterministic battle state and turn resolution"
```

---

### Task 7: Policies interface, test policies, battle rating, runMatchup

**Files:**
- Create: `src/policy/types.ts`, `src/policy/testPolicies.ts`, `src/sim/rating.ts`, `src/sim/runMatchup.ts`
- Test: `tests/runMatchup.test.ts`

**Interfaces:**
- Consumes: Task 6 exports, `TurnLimitError`.
- Produces:
  - `interface Policy { chooseAction(state: BattleState, me: Side): Action; chooseShield(state: BattleState, me: Side, incomingMoveIndex: number, damage: number): boolean }`
  - `FastOnlyPolicy`, `GreedyPolicy`, `ScriptedPolicy` (classes implementing `Policy`)
  - `interface ScriptedCharged { side: Side; turn: number; index: number; shielded: boolean }`
  - `battleRating(selfHp: number, selfMaxHp: number, oppHp: number, oppMaxHp: number): number`
  - `interface MatchupOptions { shields: readonly [number, number]; startEnergy?: readonly [number, number]; policies: readonly [Policy, Policy]; maxTurns?: number }`
  - `interface MatchupResult { winner: Side | null; ratings: [number, number]; hp: [number, number]; energy: [number, number]; shields: [number, number]; turns: number; events: BattleEvent[] }`
  - `runMatchup(gd: GameData, a: Combatant, b: Combatant, options: MatchupOptions): MatchupResult`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/runMatchup.test.ts
import { describe, expect, it } from 'vitest';
import { loadDefaultGameData } from '../src/data';
import { TurnLimitError } from '../src/errors';
import { buildCombatant } from '../src/engine/combatant';
import { FastOnlyPolicy, GreedyPolicy, ScriptedPolicy } from '../src/policy/testPolicies';
import { battleRating } from '../src/sim/rating';
import { runMatchup } from '../src/sim/runMatchup';

const gd = loadDefaultGameData();
const med = buildCombatant(gd, { speciesId: 'medicham', fastMoveId: 'COUNTER', chargedMoveIds: ['ICE_PUNCH', 'DYNAMIC_PUNCH'] });
const azu = buildCombatant(gd, { speciesId: 'azumarill', fastMoveId: 'BUBBLE', chargedMoveIds: ['ICE_BEAM', 'HYDRO_PUMP'] });
const fast = new FastOnlyPolicy();

describe('battleRating', () => {
  it('matches PvPoke formula', () => {
    expect(battleRating(19, 191, 0, 141)).toBe(549);
    expect(battleRating(0, 141, 19, 191)).toBe(450);
    expect(battleRating(0, 141, 0, 141)).toBe(500);
  });
});

describe('runMatchup', () => {
  it('fast-only Medicham vs Azumarill = 450 / 549 (PvPoke)', () => {
    const r = runMatchup(gd, med, azu, { shields: [0, 0], policies: [fast, fast] });
    expect(r.ratings).toEqual([450, 549]);
    expect(r.winner).toBe(1);
  });

  it('scripted Ice Beam on turn 40 and Dynamic Punch on turn 50 = 416 / 583 (PvPoke sandbox)', () => {
    const script = new ScriptedPolicy([
      { side: 0, turn: 20, index: 0, shielded: true },
      { side: 0, turn: 50, index: 1, shielded: false },
      { side: 1, turn: 40, index: 0, shielded: false },
    ]);
    const r = runMatchup(gd, med, azu, { shields: [1, 1], policies: [script, script] });
    expect(r.ratings).toEqual([416, 583]);
    const charged = r.events.filter((e) => e.kind === 'charged').map((e) => [e.turn, e.side, e.moveId, e.damage]);
    expect(charged).toEqual([[40, 1, 'ICE_BEAM', 40], [50, 0, 'DYNAMIC_PUNCH', 35]]);
  });

  it('ties are reported as no winner', () => {
    const r = runMatchup(gd, med, med, { shields: [0, 0], policies: [fast, fast] });
    expect(r.winner).toBeNull();
    expect(r.ratings).toEqual([500, 500]);
  });

  it('greedy policy throws charged moves and works with one charged move', () => {
    const solo = buildCombatant(gd, { speciesId: 'azumarill', fastMoveId: 'BUBBLE', chargedMoveIds: ['ICE_BEAM'] });
    const greedy = new GreedyPolicy();
    const r = runMatchup(gd, med, solo, { shields: [1, 1], policies: [greedy, greedy] });
    expect(r.events.some((e) => e.kind === 'charged')).toBe(true);
    expect(r.shields).toEqual([0, 0]);
  });

  it('throws TurnLimitError with events attached', () => {
    try {
      runMatchup(gd, med, azu, { shields: [0, 0], policies: [fast, fast], maxTurns: 10 });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(TurnLimitError);
      expect((e as TurnLimitError).events.length).toBeGreaterThan(0);
    }
  });
});
```

(The scripted expectations come from the PvPoke sandbox spike recorded in spec §10: Medicham's turn-20 Ice Punch never fires because Medicham is mid-Counter on turn 20, exactly as in PvPoke.)

- [ ] **Step 2: Run to confirm failure** → FAIL (modules not found).

- [ ] **Step 3: Write `src/policy/types.ts`**

```ts
import type { BattleState, Side } from '../engine/state';
import type { Action } from '../engine/turn';

/** A decision-maker for one side of a battle. */
export interface Policy {
  /** Choose this turn's action; only called when the side can act. */
  chooseAction(state: BattleState, me: Side): Action;
  /** Decide whether to shield an incoming charged move that would deal `damage`. */
  chooseShield(state: BattleState, me: Side, incomingMoveIndex: number, damage: number): boolean;
}
```

- [ ] **Step 4: Write `src/policy/testPolicies.ts`**

```ts
import type { BattleState, Side } from '../engine/state';
import { other } from '../engine/state';
import type { Action } from '../engine/turn';
import type { Policy } from './types';

/** Uses only fast moves and never shields. */
export class FastOnlyPolicy implements Policy {
  /** Always choose the fast move. */
  chooseAction(): Action {
    return { type: 'fast' };
  }

  /** Never shield. */
  chooseShield(): boolean {
    return false;
  }
}

/** Throws the first affordable charged move in slot order; always shields. */
export class GreedyPolicy implements Policy {
  /** Choose the first affordable charged move, else the fast move. */
  chooseAction(state: BattleState, me: Side): Action {
    const energy = state.sides[me].energy;
    const index = state.combatants[me].chargedMoves.findIndex((m) => energy >= m.energy);
    return index >= 0 ? { type: 'charged', index } : { type: 'fast' };
  }

  /** Always shield. */
  chooseShield(): boolean {
    return true;
  }
}

export interface ScriptedCharged {
  readonly side: Side;
  readonly turn: number;
  readonly index: number;
  /** Whether the opponent shields this move (PvPoke sandbox `settings.shielded`). */
  readonly shielded: boolean;
}

/** Mirrors PvPoke sandbox mode: charged moves at scripted turns if possible, otherwise fast moves. */
export class ScriptedPolicy implements Policy {
  constructor(private readonly script: readonly ScriptedCharged[]) {}

  /** Throw the scripted charged move for this turn if affordable, else the fast move. */
  chooseAction(state: BattleState, me: Side): Action {
    const entry = this.script.find((s) => s.side === me && s.turn === state.turn);
    if (!entry) return { type: 'fast' };
    const move = state.combatants[me].chargedMoves[entry.index];
    return move && state.sides[me].energy >= move.energy ? { type: 'charged', index: entry.index } : { type: 'fast' };
  }

  /** Shield when the attacker's scripted move for this turn is marked shielded. */
  chooseShield(state: BattleState, me: Side): boolean {
    const entry = this.script.find((s) => s.side === other(me) && s.turn === state.turn);
    return entry?.shielded ?? false;
  }
}
```

- [ ] **Step 5: Write `src/sim/rating.ts` and `src/sim/runMatchup.ts`**

```ts
// src/sim/rating.ts
/** PvPoke battle rating: 500 x share of opponent HP removed + 500 x share of own HP left. */
export function battleRating(selfHp: number, selfMaxHp: number, oppHp: number, oppMaxHp: number): number {
  return Math.floor(500 * ((oppMaxHp - oppHp) / oppMaxHp) + 500 * (selfHp / selfMaxHp));
}
```

```ts
// src/sim/runMatchup.ts
import type { GameData } from '../data/types';
import type { Combatant } from '../engine/combatant';
import { TurnLimitError } from '../errors';
import { createBattle, SIDES, type Side } from '../engine/state';
import { beginTurn, canAct, resolveTurn, type Action, type BattleEvent } from '../engine/turn';
import type { Policy } from '../policy/types';
import { battleRating } from './rating';

export interface MatchupOptions {
  readonly shields: readonly [number, number];
  readonly startEnergy?: readonly [number, number];
  readonly policies: readonly [Policy, Policy];
  readonly maxTurns?: number;
}

export interface MatchupResult {
  readonly winner: Side | null;
  readonly ratings: [number, number];
  readonly hp: [number, number];
  readonly energy: [number, number];
  readonly shields: [number, number];
  readonly turns: number;
  readonly events: BattleEvent[];
}

/** Simulate a 1v1 until a faint and return ratings, final state and the event log. */
export function runMatchup(gd: GameData, a: Combatant, b: Combatant, options: MatchupOptions): MatchupResult {
  const maxTurns = options.maxTurns ?? 1000;
  let state = createBattle([a, b], { shields: options.shields, startEnergy: options.startEnergy }, {
    maxBuffStages: gd.maxBuffStages, buffDivisor: gd.buffDivisor,
  });
  const events: BattleEvent[] = [];
  const [p0, p1] = options.policies;
  const policies = [p0, p1];

  while (!state.over) {
    if (state.turn > maxTurns) throw new TurnLimitError(`Battle exceeded ${maxTurns} turns`, events);
    const pre = beginTurn(state);
    const actions = SIDES.map((side) => (canAct(pre, side) ? policies[side]!.chooseAction(pre, side) : null)) as [Action | null, Action | null];
    const result = resolveTurn(pre, actions, (s, defender, idx, dmg) => policies[defender]!.chooseShield(s, defender, idx, dmg));
    events.push(...result.events);
    state = result.state;
  }

  const [s0, s1] = state.sides;
  const ratings: [number, number] = [
    battleRating(s0.hp, a.stats.hp, s1.hp, b.stats.hp),
    battleRating(s1.hp, b.stats.hp, s0.hp, a.stats.hp),
  ];
  return {
    winner: ratings[0] > ratings[1] ? 0 : ratings[1] > ratings[0] ? 1 : null,
    ratings,
    hp: [s0.hp, s1.hp],
    energy: [s0.energy, s1.energy],
    shields: [s0.shields, s1.shields],
    turns: state.turn - 1,
    events,
  };
}
```

- [ ] **Step 6: Run tests, typecheck, commit**

Run: `npm test && npm run typecheck` → PASS. If the scripted sandbox test disagrees, use Task 9's harness to diff event logs before changing anything.

```bash
git add src/policy src/sim tests/runMatchup.test.ts
git commit -m "feat: add policy interface, test policies and runMatchup"
```

---

### Task 8: Debug CLI

**Files:**
- Create: `scripts/sim.ts`
- Test: `tests/simCli.test.ts`

**Interfaces:**
- Consumes: `buildCombatant`, `runMatchup`, policies. Initially uses `GreedyPolicy`; Task 13 switches the default to `PvPokeLikePolicy`.
- Produces: `formatTimeline(result: MatchupResult, names: [string, string], moveNames: Map<string, string>): string` (exported from `scripts/sim.ts`) and the CLI `npm run sim -- <a> <b> [--shields x y] [--policy greedy|fast]`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/simCli.test.ts
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('sim CLI', () => {
  it('prints ratings and a timeline using ranking movesets', () => {
    const out = execFileSync('npx', ['tsx', 'scripts/sim.ts', 'medicham', 'azumarill', '--shields', '0', '0', '--policy', 'fast'], { encoding: 'utf8' });
    expect(out).toContain('Medicham');
    expect(out).toContain('Azumarill');
    expect(out).toMatch(/Rating\s+\d+\s+vs\s+\d+/);
    expect(out).toMatch(/T\s*2\s+Medicham\s+Counter\s+4/);
  });

  it('exits non-zero with a clear message for an unknown species', () => {
    expect(() => execFileSync('npx', ['tsx', 'scripts/sim.ts', 'nope', 'azumarill'], { encoding: 'utf8', stdio: 'pipe' })).toThrow(/Unknown species nope/);
  });
});
```

- [ ] **Step 2: Run to confirm failure** → FAIL.

- [ ] **Step 3: Write `scripts/sim.ts`** — moves default to the moveset in `data/rankings-1500.json`; override with `--moves FAST,CH1,CH2`.

```ts
import { readFileSync } from 'node:fs';
import { loadDefaultGameData } from '../src/data';
import { buildCombatant, type Combatant } from '../src/engine/combatant';
import type { Side } from '../src/engine/state';
import { FastOnlyPolicy, GreedyPolicy } from '../src/policy/testPolicies';
import type { Policy } from '../src/policy/types';
import { runMatchup, type MatchupResult } from '../src/sim/runMatchup';

interface RankingEntry { speciesId: string; moveset: string[] }

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

function main(): void {
  const [aId, bId] = process.argv.slice(2);
  if (!aId || !bId) throw new Error('Usage: npm run sim -- <speciesA> <speciesB> [--shields 1 1] [--policy greedy|fast] [--moves-a F,C1,C2] [--moves-b F,C1,C2]');
  const gd = loadDefaultGameData();
  const rankings: RankingEntry[] = JSON.parse(readFileSync('data/rankings-1500.json', 'utf8'));

  const make = (id: string, flag: string): Combatant => {
    const override = arg(flag, 1)?.[0]?.split(',');
    const moveset = override ?? rankings.find((r) => r.speciesId === id)?.moveset;
    if (!gd.species.has(id)) throw new Error(`Unknown species ${id}`);
    if (!moveset) throw new Error(`No ranking moveset for ${id}; pass ${flag} FAST,CHARGED1[,CHARGED2]`);
    const [fastMoveId, ...chargedMoveIds] = moveset;
    return buildCombatant(gd, { speciesId: id, fastMoveId: fastMoveId!, chargedMoveIds });
  };

  const a = make(aId, '--moves-a');
  const b = make(bId, '--moves-b');
  const shields = (arg('--shields', 2) ?? ['1', '1']).map(Number) as [number, number];
  const policyName = arg('--policy', 1)?.[0] ?? 'greedy';
  const policy: Policy = policyName === 'fast' ? new FastOnlyPolicy() : new GreedyPolicy();
  const result = runMatchup(gd, a, b, { shields, policies: [policy, policy] });
  const moveNames = new Map([...gd.moves.values()].map((m) => [m.id, m.name]));
  console.log(formatTimeline(result, [a.species.name, b.species.name], moveNames));
}

try {
  main();
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
```

- [ ] **Step 4: Run tests, typecheck, commit**

```bash
npm test && npm run typecheck
git add scripts/sim.ts tests/simCli.test.ts
git commit -m "feat: add matchup debug CLI"
```

---

### Task 9: PvPoke headless harness + engine oracle (fast-only and scripted)

**Files:**
- Create: `scripts/oracle/pvpokeHarness.cjs`, `scripts/oracle/harness.d.ts`, `scripts/oracle/meta.ts`, `scripts/gen-oracle.ts` (engine part)
- Generated: `tests/fixtures/engine-oracle.json`
- Test: `tests/engineOracle.test.ts`

**Interfaces:**
- Consumes: `.cache/pvpoke` (Task 1), `runMatchup`, `FastOnlyPolicy`, `ScriptedPolicy`.
- Produces:
  - `createPvpoke(srcDir: string): PvpokeHarness` with `simulate(req: PvpokeRequest): PvpokeResult`
  - `PvpokeRequest = { a: OracleMon; b: OracleMon; shields: [number, number]; mode: 'default' | 'fastOnly' | 'scripted'; script?: ScriptedCharged[] }`
  - `OracleMon = { speciesId: string; moveset: string[] }` (fast first)
  - `PvpokeResult = { ratings: [number, number]; hp: [number, number]; events: { turn: number; side: 0 | 1; type: string; name: string; damage: number }[] }`
  - `metaSpecies(gd: GameData, count: number): OracleMon[]` — top `count` from `data/rankings-1500.json` that `buildCombatant` accepts.
  - fixture format: `{ upstream: string; cases: OracleCase[] }`, `OracleCase = { a: OracleMon; b: OracleMon; shields: [number, number]; mode; script?; ratings; hp }`

- [ ] **Step 1: Write `scripts/oracle/pvpokeHarness.cjs`** (generalises the spike in spec §10)

```js
// Runs PvPoke's own browser JS headless in a Node vm. Dev-only oracle; never imported by src/.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const FILES = [
  'GameMaster.js', 'pokemon/Pokemon.js', 'pokemon/Player.js', 'battle/DamageCalculator.js',
  'battle/timeline/TimelineEvent.js', 'battle/timeline/TimelineAction.js', 'training/DecisionOption.js',
  'battle/actions/ActionLogic.js', 'battle/Battle.js',
];

/** Load PvPoke from a checkout's src/ directory and return a simulate() function. */
function createPvpoke(srcDir) {
  const gamemaster = JSON.parse(fs.readFileSync(path.join(srcDir, 'data', 'gamemaster.json'), 'utf8'));
  const pending = [];
  // jQuery stub: every DOM call is a no-op chain; $.ajax defers the gamemaster callback.
  const chain = new Proxy(function () {}, { get: (_t, k) => (k === 'length' ? 0 : chain), apply: () => chain });
  const $ = new Proxy(function () { return chain; }, {
    get: (_t, k) => {
      if (k === 'ajax') return (o) => { if (String(o.url).includes('gamemaster')) pending.push(() => o.success(gamemaster)); };
      if (k === 'each') return (arr, fn) => arr.forEach((v, i) => fn(i, v));
      return chain;
    },
    apply: () => chain,
  });
  const ctx = {
    $, jQuery: $, host: 'localhost/', webRoot: '', siteVersion: '1', settings: { gamemaster: 'gamemaster' },
    console: { log() {}, error: console.error, warn() {} }, Math, JSON,
    document: { addEventListener() {} }, setTimeout, clearTimeout, setInterval, clearInterval,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const file of FILES) vm.runInContext(fs.readFileSync(path.join(srcDir, 'js', file), 'utf8'), ctx, { filename: file });
  vm.runInContext('var gm = GameMaster.getInstance();', ctx);
  pending.splice(0).forEach((fn) => fn());

  vm.runInContext(`
    function __mk(battle, mon, index, shields, fastOnly) {
      var p = new Pokemon(mon.speciesId, index, battle);
      p.initialize(1500);
      p.selectMove('fast', mon.moveset[0]);
      p.selectMove('charged', mon.moveset[1], 0);
      if (mon.moveset[2]) p.selectMove('charged', mon.moveset[2], 1); else p.selectMove('charged', 'none', 1);
      p.setShields(shields);
      if (fastOnly) p.farmEnergy = true;
      return p;
    }
    function __simulate(req) {
      var b = new Battle(); b.setCP(1500);
      var fastOnly = req.mode === 'fastOnly';
      var a = __mk(b, req.a, 0, req.shields[0], fastOnly), z = __mk(b, req.b, 1, req.shields[1], fastOnly);
      b.setNewPokemon(a, 0, false); b.setNewPokemon(z, 1, false);
      if (req.mode === 'scripted') {
        b.setSandboxMode(true);
        b.setActions(req.script.map(function (s) {
          return new TimelineAction('charged', s.side, s.turn, s.index, { shielded: s.shielded, buffs: false, priority: 0 });
        }));
      }
      var tl = b.simulate();
      return JSON.stringify({
        ratings: b.getBattleRatings(),
        hp: [a.hp, z.hp],
        events: tl.filter(function (e) { return /^(fast|charged|shield)/.test(e.type); })
          .map(function (e) { return { turn: e.turn, side: e.actor, type: e.type, name: e.name, damage: e.values ? e.values[0] : 0 }; }),
      });
    }
  `, ctx);

  return {
    simulate(req) {
      ctx.__req = req;
      return JSON.parse(vm.runInContext('__simulate(__req)', ctx));
    },
  };
}

module.exports = { createPvpoke };
```

Note: if `selectMove('charged', 'none', 1)` errors for single-charged-move species, check `Pokemon.js:988-995` and adapt (the intent is "only one charged move").

- [ ] **Step 2: Write `scripts/oracle/harness.d.ts`** so TS scripts can import it with types

```ts
import type { ScriptedCharged } from '../../src/policy/testPolicies';

export interface OracleMon { speciesId: string; moveset: string[] }
export interface PvpokeRequest {
  a: OracleMon; b: OracleMon; shields: [number, number];
  mode: 'default' | 'fastOnly' | 'scripted'; script?: ScriptedCharged[];
}
export interface PvpokeEvent { turn: number; side: 0 | 1; type: string; name: string; damage: number }
export interface PvpokeResult { ratings: [number, number]; hp: [number, number]; events: PvpokeEvent[] }
export interface PvpokeHarness { simulate(req: PvpokeRequest): PvpokeResult }
export function createPvpoke(srcDir: string): PvpokeHarness;
```

- [ ] **Step 3: Write `scripts/oracle/meta.ts`**

```ts
import { readFileSync } from 'node:fs';
import type { GameData } from '../../src/data/types';
import { buildCombatant } from '../../src/engine/combatant';
import type { OracleMon } from './harness';

/** Top `count` ranked Great League Pokémon (with ranking movesets) that this engine supports. */
export function metaSpecies(gd: GameData, count: number): OracleMon[] {
  const rankings: { speciesId: string; moveset: string[] }[] = JSON.parse(readFileSync('data/rankings-1500.json', 'utf8'));
  const out: OracleMon[] = [];
  for (const r of rankings) {
    if (out.length >= count) break;
    try {
      const [fastMoveId, ...chargedMoveIds] = r.moveset;
      buildCombatant(gd, { speciesId: r.speciesId, fastMoveId: fastMoveId!, chargedMoveIds });
      out.push({ speciesId: r.speciesId, moveset: r.moveset });
    } catch {
      // Unsupported (form change, mega, etc.) - excluded from the oracle set by design (spec §10).
    }
  }
  return out;
}
```

- [ ] **Step 4: Write `scripts/gen-oracle.ts`** (engine fixtures now; Task 12 adds the default-policy fixtures)

```ts
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { loadDefaultGameData } from '../src/data';
import type { ScriptedCharged } from '../src/policy/testPolicies';
import type { OracleMon, PvpokeHarness, PvpokeRequest } from './oracle/harness';
import { metaSpecies } from './oracle/meta';

const require = createRequire(import.meta.url);
const { createPvpoke } = require('./oracle/pvpokeHarness.cjs') as { createPvpoke: (dir: string) => PvpokeHarness };

const upstream = readFileSync('data/UPSTREAM', 'utf8').trim();
const pvpoke = createPvpoke('.cache/pvpoke/src');
const gd = loadDefaultGameData();

/** Deterministic pseudo-random generator so fixtures are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Chance-buff moves are excluded from scripted cases: PvPoke sandbox mode never applies them. */
function hasChanceBuff(mon: OracleMon): boolean {
  return mon.moveset.slice(1).some((id) => {
    const m = gd.moves.get(id);
    return !!m && m.kind === 'charged' && !!m.buffs && m.buffs.chance < 1;
  });
}

function record(req: PvpokeRequest) {
  const res = pvpoke.simulate(req);
  return { ...req, ratings: res.ratings, hp: res.hp };
}

function engineCases() {
  const meta = metaSpecies(gd, 40);
  const rand = mulberry32(20261015);
  const cases = [];
  for (let i = 0; i < meta.length; i++) {
    for (let j = i; j < meta.length; j++) {
      cases.push(record({ a: meta[i]!, b: meta[j]!, shields: [0, 0], mode: 'fastOnly' }));
    }
  }
  const scriptable = meta.filter((m) => !hasChanceBuff(m));
  for (let n = 0; n < 400; n++) {
    const a = scriptable[Math.floor(rand() * scriptable.length)]!;
    const b = scriptable[Math.floor(rand() * scriptable.length)]!;
    const script: ScriptedCharged[] = [];
    for (let k = 0; k < 6; k++) {
      const side = (rand() < 0.5 ? 0 : 1) as 0 | 1;
      const mon = side === 0 ? a : b;
      script.push({ side, turn: 5 + Math.floor(rand() * 60), index: Math.floor(rand() * (mon.moveset.length - 1)), shielded: rand() < 0.5 });
    }
    cases.push(record({ a, b, shields: [Math.floor(rand() * 3), Math.floor(rand() * 3)] as [number, number], mode: 'scripted', script }));
  }
  return cases;
}

mkdirSync('tests/fixtures', { recursive: true });
const engine = engineCases();
writeFileSync('tests/fixtures/engine-oracle.json', JSON.stringify({ upstream, cases: engine }));
console.log(`engine-oracle.json: ${engine.length} cases`);
```

- [ ] **Step 5: Generate fixtures**

Run: `npm run gen-oracle`
Expected: `engine-oracle.json: 1220 cases` (820 fast-only pairs + 400 scripted). If PvPoke throws inside the vm, read the stack (the filename is given) and extend the stub (e.g. add a missing global) — do not edit PvPoke files.

- [ ] **Step 6: Write the failing engine-oracle test**

```ts
// tests/engineOracle.test.ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadDefaultGameData } from '../src/data';
import { buildCombatant } from '../src/engine/combatant';
import { FastOnlyPolicy, ScriptedPolicy, type ScriptedCharged } from '../src/policy/testPolicies';
import { runMatchup } from '../src/sim/runMatchup';

interface Mon { speciesId: string; moveset: string[] }
interface Case { a: Mon; b: Mon; shields: [number, number]; mode: 'fastOnly' | 'scripted'; script?: ScriptedCharged[]; ratings: [number, number]; hp: [number, number] }

const gd = loadDefaultGameData();
const fixture: { cases: Case[] } = JSON.parse(readFileSync('tests/fixtures/engine-oracle.json', 'utf8'));
const build = (m: Mon) => buildCombatant(gd, { speciesId: m.speciesId, fastMoveId: m.moveset[0]!, chargedMoveIds: m.moveset.slice(1) });

describe('engine matches PvPoke exactly', () => {
  for (const mode of ['fastOnly', 'scripted'] as const) {
    it(`${mode}: identical ratings and HP for every case`, () => {
      const mismatches: string[] = [];
      for (const c of fixture.cases.filter((x) => x.mode === mode)) {
        const policy = mode === 'fastOnly' ? new FastOnlyPolicy() : new ScriptedPolicy(c.script!);
        const r = runMatchup(gd, build(c.a), build(c.b), { shields: c.shields, policies: [policy, policy] });
        if (r.ratings[0] !== c.ratings[0] || r.ratings[1] !== c.ratings[1] || r.hp[0] !== c.hp[0] || r.hp[1] !== c.hp[1]) {
          mismatches.push(`${c.a.speciesId} vs ${c.b.speciesId} ${JSON.stringify(c.shields)}: ours ${r.ratings} pvpoke ${c.ratings}`);
        }
      }
      expect(mismatches.slice(0, 10)).toEqual([]);
    });
  }
});
```

- [ ] **Step 7: Run and fix the engine until it passes 100%**

Run: `npx vitest run tests/engineOracle.test.ts`
Expected: PASS for both modes. For each mismatch, diff event logs: run the harness for that case (`pvpoke.simulate(case).events`) and print our `r.events`, find the first differing turn, fix `src/engine/turn.ts`, and add a focused regression test to `tests/turn.test.ts` for the rule that was wrong. Record any new PvPoke rule in spec §10.

- [ ] **Step 8: Full suite, typecheck, commit**

```bash
npm test && npm run typecheck
git add scripts/oracle scripts/gen-oracle.ts tests/fixtures/engine-oracle.json tests/engineOracle.test.ts docs/superpowers/specs
git commit -m "test: add PvPoke headless harness and exact engine oracle"
```

---

### Tasks 10–12: Porting PvPoke's decision logic (`PvPokeLikePolicy`)

These tasks port about 1,300 lines of heuristics. Pasting a speculative translation into this plan would be less accurate than translating from source with the oracle checking it, so these tasks set out a **translation protocol**, exact source ranges, the target signatures, and concrete tests. The oracle in Task 12 is the acceptance gate.

**Translation protocol (applies to Tasks 10–12):**
1. Translate statement by statement from the pinned source. Keep PvPoke's variable names where reasonable and start each translated block with a comment `// PvPoke ActionLogic.js:<from>-<to>`.
2. PvPoke reads and mutates `Pokemon` objects. The port reads a **view** built from `BattleState` (`PokeView` below). Where PvPoke temporarily mutates (e.g. `applyStatBuffs` inside the DP loop, then resets), compute on local copies instead.
3. `move.damage` reads use `SideState.lastDamage`. Where PvPoke writes `move.damage` inside decision logic (`ActionLogic.js:320, 336, 1046, 1159`), compute the value locally. If oracle diffs trace back to those writes leaking into later turns, extend `Policy.chooseAction` to return `{ action, lastDamageUpdates }` and apply the updates in `runMatchup` (record this in spec §10).
4. Skip code for form changes (Aegislash, Cramorant, Mimikyu), mega moves, `decisionMethod == "random"`, and emulate/sandbox-only branches. They are unreachable for supported Pokémon in simulate mode. Leave a one-line comment naming what was skipped.
5. `battle.logDecision(...)` calls become entries in an optional `trace: string[]` on the policy. They are useful for coaching later and cost nothing.

**Shared view type** (create in `src/policy/pvpoke/view.ts` during Task 10):

```ts
import type { ChargedMove, FastMove } from '../../data/types';
import type { Combatant } from '../../engine/combatant';
import type { BattleState, Side, SideState } from '../../engine/state';

/** Read-only, PvPoke-shaped view of one side, so the port reads like the original. */
export interface PokeView {
  readonly side: Side;
  readonly c: Combatant;
  readonly s: SideState;
  readonly fastMove: FastMove;
  readonly chargedMoves: readonly ChargedMove[];
  /** Charged moves sorted/prioritised as PvPoke Pokemon.resetMoves (Pokemon.js:722-868). */
  readonly activeChargedMoves: readonly ChargedMove[];
  readonly bestChargedMove: ChargedMove | null;
  readonly fastestChargedMove: ChargedMove | null;
  /** Indexes into chargedMoves for activeChargedMoves entries. */
  indexOf(move: ChargedMove): number;
  /** PvPoke move.damage for this move against the opponent, from SideState.lastDamage. */
  damageOf(move: FastMove | ChargedMove): number;
  /** PvPoke move.dpe (damage / energy, buff-adjusted as Pokemon.initializeMove:880-910). */
  dpeOf(move: ChargedMove): number;
}

/** Build the PvPoke-shaped views for both sides of a battle. */
export declare function views(state: BattleState, me: Side): { poke: PokeView; opponent: PokeView };
```

---

### Task 10: Move metadata + shield logic

**Files:**
- Create: `src/policy/pvpoke/view.ts`, `src/policy/pvpoke/moveMeta.ts`, `src/policy/pvpoke/shield.ts`
- Test: `tests/pvpokeMoveMeta.test.ts`, `tests/pvpokeShield.test.ts`

**Interfaces:**
- Produces: `views(state, me)` (implementation of the declaration above), `orderChargedMoves(c: Combatant, s: SideState): { active: ChargedMove[]; best: ChargedMove | null; fastest: ChargedMove | null }`, `dpe(move, damage, buffDivisor): number`, `pvpokeShield(state: BattleState, me: Side, incomingMoveIndex: number, damage: number): boolean`, `wouldShield(state, attackerSide, defenderSide, move): { value: boolean }`.

Sources:
- `orderChargedMoves`: `Pokemon.js:722-868` (sorting by energy, buff and self-debuff reordering, best-move DPE selection; skip the Aegislash and Obstruct-free branches only if unreachable — **keep** the Obstruct clauses and the "Zap Cannon Registeel clause", which are reachable).
- `dpe`: `Pokemon.js:893-911`.
- `pvpokeShield`: `Battle.js:1076-1128` (simulate, non-sandbox, `decisionMethod == "default"`): default `true`; overridden by `wouldShield(...).value` for self-buffing moves (`move.buffs && move.selfBuffing` with self atk-up or opponent def-down), and when the defender's `bestChargedMove.selfDefenseDebuffing` (attacker has shields → `wouldShield`; otherwise the cycle-damage check at `Battle.js:1094-1110`).
- `wouldShield`: `ActionLogic.js:1154-1262`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/pvpokeMoveMeta.test.ts
import { describe, expect, it } from 'vitest';
import { loadDefaultGameData } from '../src/data';
import { buildCombatant } from '../src/engine/combatant';
import { createBattle } from '../src/engine/state';
import { orderChargedMoves } from '../src/policy/pvpoke/moveMeta';

const gd = loadDefaultGameData();
const rules = { maxBuffStages: 4, buffDivisor: 4 };
const vs = (id: string, fast: string, charged: string[]) => {
  const me = buildCombatant(gd, { speciesId: id, fastMoveId: fast, chargedMoveIds: charged });
  const opp = buildCombatant(gd, { speciesId: 'azumarill', fastMoveId: 'BUBBLE', chargedMoveIds: ['ICE_BEAM'] });
  const st = createBattle([me, opp], { shields: [1, 1] }, rules);
  return orderChargedMoves(me, st.sides[0]);
};

describe('orderChargedMoves (PvPoke Pokemon.resetMoves)', () => {
  it('sorts by energy and picks the cheaper move as fastest', () => {
    const r = vs('medicham', 'COUNTER', ['PSYCHIC', 'ICE_PUNCH']);
    expect(r.fastest?.id).toBe('ICE_PUNCH');
    expect(r.active.map((m) => m.id)).toEqual(['ICE_PUNCH', 'PSYCHIC']);
  });

  it('prefers a close-energy self-buffing move as the bait (PUP)', () => {
    const r = vs('medicham', 'COUNTER', ['ICE_PUNCH', 'POWER_UP_PUNCH']);
    expect(r.active[0]!.id).toBe('POWER_UP_PUNCH');
  });

  it('applies the Zap Cannon Registeel clause', () => {
    const r = vs('registeel', 'LOCK_ON', ['FOCUS_BLAST', 'ZAP_CANNON']);
    expect(r.best?.id).toBeDefined();
  });
});
```

Replace the weak `toBeDefined()` assertion with the value PvPoke produces: in the harness, construct that Registeel vs Azumarill and read `p.bestChargedMove.moveId` (`vm.runInContext` after `b.setNewPokemon` and `p.resetMoves()`), then assert it. Do the same for any other assertion you are unsure about. **Every expected value in these tests must come from the harness, not from reasoning.**

```ts
// tests/pvpokeShield.test.ts
import { describe, expect, it } from 'vitest';
import { loadDefaultGameData } from '../src/data';
import { buildCombatant } from '../src/engine/combatant';
import { createBattle } from '../src/engine/state';
import { pvpokeShield } from '../src/policy/pvpoke/shield';

const gd = loadDefaultGameData();
const rules = { maxBuffStages: 4, buffDivisor: 4 };

describe('pvpokeShield', () => {
  it('shields a normal charged move by default', () => {
    const st = createBattle([
      buildCombatant(gd, { speciesId: 'medicham', fastMoveId: 'COUNTER', chargedMoveIds: ['ICE_PUNCH'] }),
      buildCombatant(gd, { speciesId: 'azumarill', fastMoveId: 'BUBBLE', chargedMoveIds: ['ICE_BEAM'] }),
    ], { shields: [1, 1], startEnergy: [40, 0] }, rules);
    expect(pvpokeShield(st, 1, 0, 20)).toBe(true);
  });

  it('defers to wouldShield for an early Power-Up Punch', () => {
    const st = createBattle([
      buildCombatant(gd, { speciesId: 'medicham', fastMoveId: 'COUNTER', chargedMoveIds: ['POWER_UP_PUNCH'] }),
      buildCombatant(gd, { speciesId: 'azumarill', fastMoveId: 'BUBBLE', chargedMoveIds: ['ICE_BEAM'] }),
    ], { shields: [1, 1], startEnergy: [35, 0] }, rules);
    expect(pvpokeShield(st, 1, 0, 6)).toBe(false);
  });
});
```

Again, confirm both expectations with the harness (call `ActionLogic.wouldShield` and reproduce the `Battle.js:1076-1128` decision) and correct them before implementing.

- [ ] **Step 2: Run to confirm failure.**
- [ ] **Step 3: Implement `view.ts`, `moveMeta.ts`, `shield.ts` per the protocol and source ranges.**
- [ ] **Step 4: Run tests → PASS; `npm test && npm run typecheck` → PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat: port PvPoke move ordering and shield logic"`

---

### Task 11: Port `ActionLogic.decideAction`

**Files:**
- Create: `src/policy/pvpoke/decide.ts`, `src/policy/pvpoke/index.ts`
- Test: `tests/pvpokeDecide.test.ts`

**Interfaces:**
- Consumes: `views`, `orderChargedMoves`, `pvpokeShield`, `wouldShield`, `moveDamage`, `effectiveStat`.
- Produces: `decideAction(state: BattleState, me: Side, trace?: string[]): Action`; `class PvPokeLikePolicy implements Policy { constructor(opts?: { trace?: boolean }); readonly trace: string[]; chooseAction(...); chooseShield(...) }` where `chooseShield` delegates to `pvpokeShield`.

Port in this order, committing after each sub-step once its tests pass:

| Sub-step | Source (`ActionLogic.js`) | Content |
|---|---|---|
| 11a | 6–40 | early exits: no charged moves, `farmEnergy`, energy-to-each-move bookkeeping |
| 11b | 42–208 | opponent-in-fast-move handling, "can opponent KO me during my fast move", the turns-to-live queue, throw-best-move-if-dying |
| 11c | 210–252 | lethal charged move; (skip Mimikyu branch 236–252, protocol rule 4) |
| 11d | 254–363 | optimise move timing (uses `state.queue`, which mirrors `battle.getQueuedActions()`) |
| 11e | 388–437 | the "can't KO in limited cycles" simple selection |
| 11f | 439–803 | the DP over (energy, opponent HP, turns, opponent shields, moves, attack buffs, chance) |
| 11g | 804–1031 | post-plan strategy: farm-down, baiting, self-debuff deferral and stacking, final move choice |

- [ ] **Step 1: Write the failing tests** — a small set of known-behaviour matchups. Expected values come from the harness (`mode: 'default'`):

```ts
// tests/pvpokeDecide.test.ts
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { loadDefaultGameData } from '../src/data';
import { buildCombatant } from '../src/engine/combatant';
import { PvPokeLikePolicy } from '../src/policy/pvpoke';
import { runMatchup } from '../src/sim/runMatchup';
import type { OracleMon, PvpokeHarness } from '../scripts/oracle/harness';

const require = createRequire(import.meta.url);
const { createPvpoke } = require('../scripts/oracle/pvpokeHarness.cjs') as { createPvpoke: (d: string) => PvpokeHarness };
const pvpoke = createPvpoke('.cache/pvpoke/src');
const gd = loadDefaultGameData();

const CASES: [OracleMon, OracleMon, [number, number]][] = [
  [{ speciesId: 'medicham', moveset: ['COUNTER', 'ICE_PUNCH', 'PSYCHIC'] }, { speciesId: 'azumarill', moveset: ['BUBBLE', 'ICE_BEAM', 'PLAY_ROUGH'] }, [1, 1]],
  [{ speciesId: 'medicham', moveset: ['COUNTER', 'ICE_PUNCH', 'PSYCHIC'] }, { speciesId: 'azumarill', moveset: ['BUBBLE', 'ICE_BEAM', 'PLAY_ROUGH'] }, [0, 0]],
  [{ speciesId: 'melmetal', moveset: ['THUNDER_SHOCK', 'DOUBLE_IRON_BASH', 'DYNAMIC_PUNCH'] }, { speciesId: 'registeel', moveset: ['LOCK_ON', 'FOCUS_BLAST', 'ZAP_CANNON'] }, [0, 0]],
  [{ speciesId: 'medicham', moveset: ['COUNTER', 'POWER_UP_PUNCH', 'ICE_PUNCH'] }, { speciesId: 'medicham', moveset: ['COUNTER', 'POWER_UP_PUNCH', 'ICE_PUNCH'] }, [2, 2]],
  [{ speciesId: 'melmetal', moveset: ['THUNDER_SHOCK', 'SUPER_POWER', 'ROCK_SLIDE'] }, { speciesId: 'azumarill', moveset: ['BUBBLE', 'ICE_BEAM', 'PLAY_ROUGH'] }, [1, 1]],
];

const build = (m: OracleMon) => buildCombatant(gd, { speciesId: m.speciesId, fastMoveId: m.moveset[0]!, chargedMoveIds: m.moveset.slice(1) });

describe('PvPokeLikePolicy reproduces PvPoke decisions', () => {
  for (const [a, b, shields] of CASES) {
    it(`${a.speciesId} vs ${b.speciesId} ${shields.join('-')}`, () => {
      const expected = pvpoke.simulate({ a, b, shields, mode: 'default' });
      const r = runMatchup(gd, build(a), build(b), { shields, policies: [new PvPokeLikePolicy(), new PvPokeLikePolicy()] });
      const ours = r.events.filter((e) => e.kind === 'charged').map((e) => [e.turn, e.side]);
      const theirs = expected.events.filter((e) => e.type.startsWith('charged')).map((e) => [e.turn, e.side]);
      expect(ours).toEqual(theirs);
      expect(r.ratings).toEqual(expected.ratings);
    });
  }
});
```

Medicham vs Azumarill 1-1 must give 324 / 675 (spike result, spec §10).

- [ ] **Step 2: Run to confirm failure.**
- [ ] **Steps 3–9: Port sub-steps 11a–11g** in order. After each one: `npx vitest run tests/pvpokeDecide.test.ts`. Not every case will pass until 11g is done. Commit each sub-step: `git commit -m "feat: port ActionLogic <section>"`.
- [ ] **Step 10: All decide tests PASS; `npm test && npm run typecheck` PASS; commit.**

---

### Task 12: Default-policy oracle, acceptance test, mismatch report

**Files:**
- Modify: `scripts/gen-oracle.ts` (add default-policy cases)
- Create: `scripts/compare-oracle.ts`, `tests/oracle.acceptance.test.ts`
- Generated: `tests/fixtures/oracle-gl.json`, `reports/oracle-report.md` (gitignored)

**Interfaces:**
- Consumes: harness, `metaSpecies`, `PvPokeLikePolicy`, `runMatchup`.
- Produces: `compareOracle(): { total: number; winnerAgreement: number; medianAbsRatingDiff: number; worst: OracleDiff[] }` exported from `scripts/compare-oracle.ts`.

- [ ] **Step 1: Extend `scripts/gen-oracle.ts`** — append after the engine fixtures:

```ts
function defaultCases() {
  const meta = metaSpecies(gd, 100);
  const cases = [];
  for (const s of [0, 1, 2] as const) {
    for (let i = 0; i < meta.length; i++) {
      for (let j = i; j < meta.length; j++) {
        cases.push(record({ a: meta[i]!, b: meta[j]!, shields: [s, s], mode: 'default' }));
      }
    }
  }
  return cases;
}

const def = defaultCases();
writeFileSync('tests/fixtures/oracle-gl.json', JSON.stringify({ upstream, cases: def }));
console.log(`oracle-gl.json: ${def.length} cases`);
```

Run: `npm run gen-oracle` → `oracle-gl.json: 15150 cases`.

- [ ] **Step 2: Write `scripts/compare-oracle.ts`**

```ts
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { loadDefaultGameData } from '../src/data';
import { buildCombatant } from '../src/engine/combatant';
import { PvPokeLikePolicy } from '../src/policy/pvpoke';
import { runMatchup } from '../src/sim/runMatchup';
import type { OracleMon, PvpokeHarness } from './oracle/harness';

export interface OracleDiff {
  a: OracleMon; b: OracleMon; shields: [number, number];
  ours: [number, number]; theirs: [number, number]; diff: number; winnerAgrees: boolean;
}

interface Case { a: OracleMon; b: OracleMon; shields: [number, number]; ratings: [number, number] }

const sign = (r: [number, number]): number => Math.sign(r[0] - r[1]);

/** Run every default-policy oracle case through our engine and summarise agreement with PvPoke. */
export function compareOracle(): { total: number; winnerAgreement: number; medianAbsRatingDiff: number; worst: OracleDiff[] } {
  const gd = loadDefaultGameData();
  const { cases } = JSON.parse(readFileSync('tests/fixtures/oracle-gl.json', 'utf8')) as { cases: Case[] };
  const build = (m: OracleMon) => buildCombatant(gd, { speciesId: m.speciesId, fastMoveId: m.moveset[0]!, chargedMoveIds: m.moveset.slice(1) });
  const diffs: OracleDiff[] = cases.map((c) => {
    const r = runMatchup(gd, build(c.a), build(c.b), { shields: c.shields, policies: [new PvPokeLikePolicy(), new PvPokeLikePolicy()] });
    return {
      a: c.a, b: c.b, shields: c.shields, ours: r.ratings, theirs: c.ratings,
      diff: Math.abs(r.ratings[0] - c.ratings[0]), winnerAgrees: sign(r.ratings) === sign(c.ratings),
    };
  });
  const sorted = [...diffs].map((d) => d.diff).sort((x, y) => x - y);
  return {
    total: diffs.length,
    winnerAgreement: diffs.filter((d) => d.winnerAgrees).length / diffs.length,
    medianAbsRatingDiff: sorted[Math.floor(sorted.length / 2)] ?? 0,
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
    `Winner agreement: ${(summary.winnerAgreement * 100).toFixed(2)}% (target >= 98%)`,
    `Median |rating diff|: ${summary.medianAbsRatingDiff} (target <= 25)`, '',
    '## Worst mismatches', '',
  ];
  for (const d of summary.worst) {
    const build = (m: OracleMon) => buildCombatant(gd, { speciesId: m.speciesId, fastMoveId: m.moveset[0]!, chargedMoveIds: m.moveset.slice(1) });
    const ours = runMatchup(gd, build(d.a), build(d.b), { shields: d.shields, policies: [new PvPokeLikePolicy(), new PvPokeLikePolicy()] });
    const theirs = pvpoke.simulate({ a: d.a, b: d.b, shields: d.shields, mode: 'default' });
    lines.push(`### ${d.a.speciesId} vs ${d.b.speciesId} ${d.shields.join('-')}: ours ${d.ours} / pvpoke ${d.theirs}`, '');
    lines.push('| ours | pvpoke |', '|---|---|');
    const o = ours.events.filter((e) => e.kind === 'charged').map((e) => `T${e.turn} s${e.side} ${e.moveId}${'shielded' in e && e.shielded ? ' (S)' : ''}`);
    const t = theirs.events.filter((e) => !e.type.startsWith('fast')).map((e) => `T${e.turn} s${e.side} ${e.name}${e.type === 'shield' ? ' (S)' : ''}`);
    for (let i = 0; i < Math.max(o.length, t.length); i++) lines.push(`| ${o[i] ?? ''} | ${t[i] ?? ''} |`);
    lines.push('');
  }
  mkdirSync('reports', { recursive: true });
  writeFileSync('reports/oracle-report.md', lines.join('\n'));
  console.log(lines.slice(0, 5).join('\n'));
}
```

- [ ] **Step 3: Write the acceptance test**

```ts
// tests/oracle.acceptance.test.ts
import { describe, expect, it } from 'vitest';
import { compareOracle } from '../scripts/compare-oracle';

describe('PvPoke oracle acceptance (spec §7.2)', () => {
  const summary = compareOracle();

  it('agrees on the winner in at least 98% of matchups', () => {
    expect(summary.winnerAgreement).toBeGreaterThanOrEqual(0.98);
  });

  it('has a median absolute rating difference of at most 25', () => {
    expect(summary.medianAbsRatingDiff).toBeLessThanOrEqual(25);
  });
});
```

- [ ] **Step 4: Iterate until it passes**

Run: `npm run compare-oracle`, open `reports/oracle-report.md`, fix the most common cause in the port (each fix gets a regression case added to `tests/pvpokeDecide.test.ts`), and repeat. Stop when the acceptance test passes. If it stalls, stop and report the remaining mismatch categories rather than loosening the thresholds.

- [ ] **Step 5: Full suite, typecheck, commit**

```bash
npm test && npm run typecheck
git add scripts tests
git commit -m "test: add PvPoke oracle acceptance test and mismatch report"
```

---

### Task 13: Wire the default policy into the CLI, finish docs

**Files:**
- Modify: `scripts/sim.ts`, `tests/simCli.test.ts`, `README.md`, spec §10

- [ ] **Step 1: Add a failing CLI test** — default policy reproduces PvPoke:

```ts
it('defaults to the PvPoke-like policy (Medicham vs Azumarill 1-1 = 324 / 675)', () => {
  const out = execFileSync('npx', ['tsx', 'scripts/sim.ts', 'medicham', 'azumarill', '--shields', '1', '1', '--moves-a', 'COUNTER,ICE_PUNCH,PSYCHIC', '--moves-b', 'BUBBLE,ICE_BEAM,PLAY_ROUGH'], { encoding: 'utf8' });
  expect(out).toContain('Rating 324 vs 675');
});
```

- [ ] **Step 2: Run → FAIL. Step 3: In `scripts/sim.ts`, default `--policy` to `pvpoke` (`new PvPokeLikePolicy({ trace: true })`) and add `--trace` to print the policy's decision trace under the timeline. Step 4: Run → PASS.**
- [ ] **Step 5: Update the README** (policies, oracle numbers from the latest report, known exclusions: form changers and megas) and spec §10 with any new findings.
- [ ] **Step 6: `npm test && npm run typecheck` → PASS; commit** — `git commit -m "feat: default CLI to PvPoke-like policy; docs"`

---

## Self-review notes

- Spec coverage: data (T1–2), stats + IV rank (T3), damage (T4), combatant (T5), engine + events (T6), policies + runMatchup + rating (T7), CLI (T8, T13), oracle + acceptance (T9, T12), PvPoke-like policy (T10–11), error handling (typed errors across T2–T7), ADRs + README (T1, T13).
- Tasks 10–11 deliberately use a translation protocol instead of inline code (see the preamble before Task 10). Their tests take expected values from the harness, never from reasoning.
- Signatures checked across tasks: `buildCombatant`, `createBattle`, `beginTurn`/`canAct`/`resolveTurn`, `runMatchup(gd, a, b, options)`, `Policy.chooseShield(state, me, idx, damage)`, `formatTimeline(result, names, moveNames)`.
