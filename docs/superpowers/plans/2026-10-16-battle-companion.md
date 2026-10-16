# Battle Companion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A phone-first static web app that, mid-battle, shows an opponent's likely moves and counts, rates the user's team against it at the current shields, and suggests stay/switch and shield calls that the user confirms with one tap.

**Architecture:**
- Pure, browser-safe logic lives in `src/companion/`. It covers counts, data, search, the opponent card, ratings, advice, battle state and persistence. All of it is tested with vitest and reuses `src/matrix` and `src/engine` unchanged, apart from one export.
- A Vite + Preact UI in `app/` renders that logic.
- A Node script builds the bundled data file at build time.
- A manual-trigger GitHub Actions workflow deploys to GitHub Pages.

**Tech Stack:**
- TypeScript (strict), Vite 5, Preact 10 with `@preact/preset-vite`, and `vite-plugin-pwa`;
- vitest 2.1.8, plus `jsdom` and `@testing-library/preact` for the UI tests.

**Spec:** `docs/superpowers/specs/2026-10-16-battle-companion-design.md`

## Global Constraints

- Everything in `src/` stays browser-safe: `npm run typecheck:browser` passes, and Node APIs are allowed only in `scripts/` and `src/data/node.ts`.
- Strict TypeScript everywhere, including `app/`.
- No server. The app is a static site hosted on GitHub Pages under the base path `/gbl-lab/`.
- Ratings are 0–1000 from the user's side, read as `cell[myShields][theirShields]` from `simulateCell` (PvPoke-like policy, even starting energy, full HP).
- **Rating colors:**
  - green: rating > 550;
  - amber: 450 ≤ rating ≤ 550 ("coin flip");
  - red: rating < 450.
- **Switch rule:** suggest a switch only when the on-field rating is < 500 *and* a non-fainted teammate rates ≥ 500 *and* ≥ 100 points above it. These are constants `SWITCH_WIN_LINE = 500` and `SWITCH_MIN_MARGIN = 100`.
- **Shield rule:** advise only when the two forced outcomes differ by more than `SHIELD_CLOSE_MARGIN = 50`. Otherwise show "Shield call is close". If the user has no shields, show no shield line.
- The UI must state in one line that ratings assume a fresh 1v1 at the current shields (HP and energy aren't tracked).
- Only species in `data/rankings-1500.json` are searchable. The opponent's moveset is always that species' ranking moveset.
- **Unsupported opponent:** the card still shows moves and counts, and the team section reads exactly `Can't simulate {name}`, with no ratings and no suggestions. An unsupported Pokémon of the user's own is rejected at team setup with the error message.
- **Persistence:** roster and battle state are saved to `localStorage` after every change and restored on load. Every storage access is wrapped in try/catch, and the app works without storage.
- **Dependencies:** pin exact versions, each at least 14 days old (check with `npm view <pkg> time`). Candidates seen on 2026-10-16:
  - `vite@5.4.20` (vitest 2.1.8 needs Vite 5);
  - `preact@10.29.8`, `@preact/preset-vite@2.9.4`;
  - `vite-plugin-pwa@0.21.2`;
  - `@testing-library/preact@3.2.4`;
  - `jsdom@25.0.1`.

  If a candidate is too new, take the newest older patch.
- **Deploying is the user's call.** The workflow is `workflow_dispatch` only. Never trigger it, and never enable Pages in the repo settings.
- Branch: `feat/tvanmook/battle-companion/20261016` (exists, with the spec committed).
- Commit prefixes are `feat:`/`fix:`/`test:`/`docs:`/`chore:`. Every commit message ends with `Claude-Session: https://claude.ai/code/session_015e11psCSZNNB5zuMTborxo`.
- Don't commit `.superpowers/brainstorm` or `.superpowers/scratch`. Task 10 adds `.superpowers/` to `.gitignore`.

## Review Focus

1. **Duplicate species on the team** (e.g. two Azumarills with different IVs). Team members are identified by slot index, never by species id, so fainting or switching one never affects the other. Tests in Tasks 8 and 12.
2. **Corrupt, old-schema or unavailable `localStorage`** (private mode, quota, JSON from an older version). Loading falls back to defaults without crashing, and saving failures are swallowed. Test in Task 9.
3. **Shield counters and faints at their limits:** *I shielded* at 0 shields, *Mine fainted* when all three are down, a 4th distinct opponent. These are no-ops (or a clear refusal for the 4th opponent), never negative shields or a crash. Tests in Task 8.
4. **The opponent never throws a charged move in the simulation** (they faint first), so there is no shield advice rather than a made-up one. Test in Task 6.
5. **Search input with punctuation, case or accents** ("mr. m", "FARFETCH", "flabébé", leading spaces, empty). Matching ignores case, punctuation and diacritics, and an empty query returns nothing. Test in Task 3.

---

## File structure

| Path | Responsibility |
|---|---|
| `src/companion/counts.ts` | Fast-move count sequences |
| `src/companion/appData.ts` | Bundled data file: build (Node script) and load (browser) |
| `src/companion/search.ts` | Opponent name search |
| `src/companion/opponent.ts` | Opponent card model, combatant or unsupported reason |
| `src/companion/team.ts` | Build the user's team from roster entries; default movesets |
| `src/companion/advice.ts` | Ratings at shields, sort, stay/switch |
| `src/companion/shieldAdvice.ts` | Forced-first-shield policy and shield advice |
| `src/companion/reasons.ts` | Type reason line |
| `src/companion/battle.ts` | Battle state reducer with undo |
| `src/companion/persist.ts` | Versioned save/load of roster and battle |
| `src/companion/index.ts` | Barrel |
| `scripts/gen-app-data.ts` | Writes `app/public/app-data.json` |
| `app/` | Vite root: `index.html`, `src/main.tsx`, `src/App.tsx`, `src/screens/*.tsx`, `src/components/*.tsx`, `src/styles.css` |
| `vite.config.ts`, `tsconfig.app.json` | Build and type config for `app/` |
| `.github/workflows/pages.yml` | Manual Pages deploy |
| `docs/decisions/0004-vite-preact-web-app.md` | ADR |

---

### Task 1: Count sequences

**Files:**
- Create: `src/companion/counts.ts`, `src/companion/index.ts`
- Test: `tests/companionCounts.test.ts`

**Interfaces:**
- Produces:
  - `countSequence(energyGain: number, cost: number, throws?: number): number[]` (default 3 throws);
  - `formatCounts(seq: readonly number[]): string` (joins with `-`).
  - Throws `RangeError` for `energyGain <= 0`, `cost <= 0` or `cost > 100`.

- [ ] **Step 1: Write the failing tests.** Load the game data with `loadDefaultGameData()` and read moves from `gd.moves`. Each case asserts `formatCounts(countSequence(fast.energyGain, charged.energy))`:
  - PSYCHO_CUT→ICE_PUNCH `5-4-5`, PSYCHO_CUT→DYNAMIC_PUNCH `5-5-5`;
  - THUNDER_SHOCK→DOUBLE_IRON_BASH `4-4-4`, THUNDER_SHOCK→DYNAMIC_PUNCH `5-5-5`;
  - INFESTATION→WATER_PULSE `5-4-4`, INFESTATION→MIRROR_COAT `4-4-4`;
  - BUBBLE→ICE_BEAM `5-5-5`, BUBBLE→PLAY_ROUGH `6-5-6`;
  - SHADOW_CLAW→SHADOW_SNEAK `7-6-6`, SHADOW_CLAW→PLAY_ROUGH `8-7-8`.

  Also test:
  - the cap: `countSequence(20, 100)` gives `[5, 5, 5]` (energy can't bank above 100);
  - `countSequence(9, 40, 1)` gives `[5]`;
  - the three `RangeError` cases.
- [ ] **Step 2:** Run `npx vitest run tests/companionCounts.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement.** Simulate energy: add `energyGain` per fast move, capped at 100, until energy ≥ cost; record the count; subtract cost; repeat. Export from the barrel.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat: fast-move count sequences for the battle companion`.

### Task 2: Bundled app data

**Files:**
- Create: `src/companion/appData.ts`, `scripts/gen-app-data.ts`
- Modify: `package.json` (script `gen-app-data`), `.gitignore` (add `app/public/app-data.json`)
- Test: `tests/companionAppData.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface RankedSpecies { readonly speciesId: string; readonly name: string; readonly rank: number; readonly moveset: readonly [string, ...string[]] }
  interface AppDataFile { readonly upstream: string; readonly gamemaster: unknown; readonly rankings: readonly { speciesId: string; speciesName: string; moveset: string[] }[] }
  interface AppData { readonly gd: GameData; readonly ranked: readonly RankedSpecies[]; readonly byId: ReadonlyMap<string, RankedSpecies> }
  function buildAppDataFile(gamemasterRaw: unknown, rankingsRaw: unknown, upstream: string): AppDataFile
  function loadAppData(file: unknown): AppData   // throws GameDataError on bad shape
  ```
  - `rank` is the 0-based index in the rankings.
  - `buildAppDataFile` keeps only the gamemaster keys `settings`, `pokemon` and `moves`. It keeps every pokemon, because form-change partners and battle-only forms are referenced. Each ranking row is reduced to `speciesId`, `speciesName` and `moveset`.
  - `loadAppData` validates each moveset with the same rule as `rowMoveset` in `src/matrix/meta.ts`.

- [ ] **Step 1: Write the failing tests:**
  - built from `data/gamemaster.json` and `data/rankings-1500.json`, the result has 1153 `ranked` entries;
  - `byId.get('melmetal')` has rank 0 and moveset `['THUNDER_SHOCK','DOUBLE_IRON_BASH','DYNAMIC_PUNCH']`;
  - `gd.species.size` equals the full gamemaster's;
  - `JSON.stringify(file).length` is less than the combined raw files;
  - `loadAppData({})` and a row with an empty moveset throw `GameDataError`.
- [ ] **Step 2:** Run `npx vitest run tests/companionAppData.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement both functions.**
- [ ] **Step 4: Write the script.** `scripts/gen-app-data.ts` reads the two data files and `data/UPSTREAM` (via `readUpstream` from `scripts/gen-matrix.ts`) and writes `app/public/app-data.json`, creating the directory. Add `"gen-app-data": "tsx scripts/gen-app-data.ts"`.
- [ ] **Step 5:** Run the test and `npm run gen-app-data`. Expected: PASS, and the file exists.
- [ ] **Step 6: Commit** `feat: bundled app data file for the battle companion`.

### Task 3: Opponent search

**Files:**
- Create: `src/companion/search.ts`
- Test: `tests/companionSearch.test.ts`

**Interfaces:**
- Consumes: `RankedSpecies` (Task 2).
- Produces:
  - `normalizeName(s: string): string`: lowercase, NFD with diacritics stripped, and every non-alphanumeric run turned into one space, trimmed;
  - `searchSpecies(ranked: readonly RankedSpecies[], query: string, limit?: number): RankedSpecies[]`, with a default limit of 8.
  - A result matches when every query word is a prefix of some word in the normalized name. Results come in rank order. An empty or whitespace query returns `[]`.
  - Shadow forms are separate results (names like "Medicham (Shadow)"). This settles the spec §3.2 builder choice.

- [ ] **Step 1: Write the failing tests** against real ranked data from Task 2:
  - `"mel"`: the first result is melmetal;
  - `"mr. m"` and `"MR M"` both return `mr_mime` before `mr_mime_galarian`;
  - `"farfetch"` returns `farfetchd_galarian` before `farfetchd` (rank order);
  - `"flabébé"` returns `flabebe`;
  - `"ninetales sh"` returns `ninetales_shadow` first;
  - `"  "` returns `[]`;
  - results never exceed the limit.
- [ ] **Step 2:** Run `npx vitest run tests/companionSearch.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Precomputing normalized names is the builder's choice.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit** `feat: opponent name search`.

### Task 4: Opponent card and the user's team

**Files:**
- Create: `src/companion/opponent.ts`, `src/companion/team.ts`
- Modify: `src/matrix/teamMatrix.ts` (export `buildRosterEntry`, renamed to `buildRosterCombatant`; update its one caller)
- Test: `tests/companionOpponent.test.ts`

**Interfaces:**
- Consumes: `AppData` (Task 2), `countSequence` (Task 1), `RosterEntry`/`parseRoster` from `src/matrix/teamMatrix.ts`.
- Produces:
  ```ts
  interface MoveInfo { readonly id: string; readonly name: string; readonly type: PokemonType }
  interface FastInfo extends MoveInfo { readonly energyGain: number; readonly turns: number }
  interface ChargedInfo extends MoveInfo { readonly energy: number; readonly counts: readonly number[] }
  interface OpponentCard {
    readonly speciesId: string; readonly name: string; readonly types: readonly PokemonType[];
    readonly fast: FastInfo; readonly charged: readonly ChargedInfo[];
    readonly combatant: Combatant | null;          // null when unsupported
    readonly unsupportedReason: string | null;     // "<ErrorName>: <message>"
  }
  function opponentCard(app: AppData, speciesId: string): OpponentCard   // GameDataError for unknown/unranked id
  function movesetInfo(gd: GameData, fastMoveId: string, chargedMoveIds: readonly string[]): { fast: FastInfo; charged: ChargedInfo[] }
  function buildRosterCombatant(gd: GameData, entry: RosterEntry, index: number): Combatant  // in teamMatrix.ts, throws RosterError
  function defaultRosterEntry(app: AppData, speciesId: string): RosterEntry  // ranking moveset, no ivs
  ```
  - The opponent's combatant is built like `buildMeta` (default IVs). The card's counts use the *opponent's* fast move.
  - `movesetInfo` is reused for the user's own counts.

- [ ] **Step 1: Write the failing tests:**
  - melmetal card: fast `THUNDER_SHOCK` with `energyGain` 9 and `turns` 2; charged counts `[4,4,4]` and `[5,5,5]`; `combatant` is not null;
  - cramorant card: `combatant` is null, `unsupportedReason` starts with `UnsupportedPokemonError`, and the moves and counts are still present;
  - an unknown id throws `GameDataError`;
  - `buildRosterCombatant` with a misspelt move throws `RosterError` naming the entry;
  - `defaultRosterEntry(app, 'medicham')` has fast `PSYCHO_CUT`.
- [ ] **Step 2:** Run `npx vitest run tests/companionOpponent.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement and export.** Run `npx vitest run tests/teamMatrix.test.ts` too, to confirm the rename broke nothing.
- [ ] **Step 4:** Run both. Expected: PASS.
- [ ] **Step 5: Commit** `feat: opponent card model and roster combatants for the companion`.

### Task 5: Ratings and stay/switch

**Files:**
- Create: `src/companion/advice.ts`
- Test: `tests/companionAdvice.test.ts`

**Interfaces:**
- Consumes: `simulateCell`, `Cell` (`src/matrix/cell.ts`).
- Produces:
  ```ts
  const SWITCH_WIN_LINE = 500, SWITCH_MIN_MARGIN = 100;
  type RatingBand = 'win' | 'close' | 'loss';         // >550 / 450..550 / <450
  function ratingBand(r: number): RatingBand
  function teamCells(gd: GameData, team: readonly Combatant[], opp: Combatant): Cell[]
  function ratingAt(cell: Cell, myShields: number, theirShields: number): number
  type StaySwitch = { kind: 'stay'; slot: number; rating: number } | { kind: 'switch'; from: number; to: number; fromRating: number; toRating: number } | { kind: 'none' }
  function staySwitch(ratings: readonly number[], onField: number | null, fainted: readonly boolean[]): StaySwitch
  function rankSlots(ratings: readonly number[], fainted: readonly boolean[]): number[]  // non-fainted slots, best first, ties by slot
  ```
  - `staySwitch` returns `none` when `onField` is null or fainted.
  - The switch target is the best-rated eligible teammate.

- [ ] **Step 1: Write the failing tests:**
  - Araquanid/Medicham/Azumarill (default IVs, ranking movesets) vs Melmetal: `ratingAt(cell,1,1)` is 518/507/321, and Araquanid's full cell is `[[602,373,178],[687,518,428],[772,610,445]]`;
  - at 2-2, `staySwitch([445,663,294], 0, [f,f,f])` gives a switch to slot 1;
  - `staySwitch([480,560,300], 0, ...)` gives stay (margin 80 < 100);
  - `staySwitch([400,700,300], 0, [f,t,f])` gives stay (the only better teammate fainted);
  - `rankSlots([445,663,294],[f,f,t])` gives `[1,0]`;
  - `ratingBand` at 449, 450, 550 and 551.
- [ ] **Step 2:** Run `npx vitest run tests/companionAdvice.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit** `feat: team ratings and stay/switch suggestion`.

### Task 6: Shield advice

**Files:**
- Create: `src/companion/shieldAdvice.ts`
- Test: `tests/companionShield.test.ts`

**Interfaces:**
- Consumes: `PvPokeLikePolicy`, `Policy` (`src/policy`), `runMatchup`.
- Produces:
  ```ts
  const SHIELD_CLOSE_MARGIN = 50;
  class ForcedFirstShieldPolicy implements Policy { constructor(forced: boolean) }  // first chooseShield → forced; later calls and chooseAction → PvPokeLikePolicy
  type ShieldAdvice =
    | { kind: 'none' }                                            // no shields, or they never throw a charged move
    | { kind: 'close'; moveId: string; shieldRating: number; noShieldRating: number }
    | { kind: 'shield' | 'let-through'; moveId: string; shieldRating: number; noShieldRating: number };
  function shieldAdvice(gd: GameData, me: Combatant, opp: Combatant, shields: readonly [number, number]): ShieldAdvice
  ```
  - `me` is side 0. Each run uses fresh policies: side 0 forced, side 1 `PvPokeLikePolicy`.
  - `moveId` is the first `charged` event with `side === 1` in the shield run.
  - The result is `close` when `|shieldRating − noShieldRating| ≤ 50`.

- [ ] **Step 1: Write the failing tests:**
  - `ForcedFirstShieldPolicy(false)` makes the first incoming charged move unshielded. Araquanid vs Melmetal at 1-1: the first side-1 charged event has `shielded: false`, and with `true` it has `shielded: true`;
  - shields `[0, 2]` give `none`;
  - a matchup where the opponent dies before reaching charged-move energy gives `none`. Pick one by scanning a strong counter at `[2,0]`, e.g. medicham vs a low-bulk Pokémon, and pin the found pair in the test with a comment saying how it was found;
  - Araquanid vs Melmetal at `[2,2]` gives a `kind` that is consistent with its two ratings and the margin. The test computes the expected kind from the returned ratings and also pins the two ratings as literals, recorded after the first green run.
- [ ] **Step 2:** Run `npx vitest run tests/companionShield.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit** `feat: simulation-based shield advice`.

### Task 7: Type reasons

**Files:**
- Create: `src/companion/reasons.ts`
- Test: `tests/companionReasons.test.ts`

**Interfaces:**
- Consumes: `effectiveness`, `SUPER_EFFECTIVE` (`src/data/typeChart.ts`).
- Produces: `typeReason(me: Combatant, opp: Combatant, rating: number): string | null`. The exact copy:
  - **Their fast move is super effective (multiplier > 1) but `rating >= 500`:**
    - if every opponent charged move is resisted (multiplier < 1): `Takes super-effective {fast}, but resists both charged moves` (for one charged move: `resists {name}`);
    - otherwise, list the resisted ones: `Takes super-effective {fast}, but resists {a}` / `resists {a} and {b}`;
    - if none are resisted: `Takes super-effective {fast}, but wins on bulk and pressure`.
  - **Every opponent move is ≤ 1× but `rating < 450`:** `Loses despite resisting or taking neutral damage: their bulk and pressure win`.
  - **Otherwise:** if their fast move is super effective, `Takes super-effective {fast}`; else `null`.

- [ ] **Step 1: Write the failing tests:**
  - Araquanid vs Melmetal at 518 gives `Takes super-effective Thunder Shock, but resists both charged moves`. Araquanid is water/bug: Double Iron Bash (steel) and Dynamic Punch (fighting) are both resisted;
  - Azumarill vs Melmetal at 321 gives `Takes super-effective Thunder Shock`;
  - Medicham vs Melmetal at 507 gives `null`.
- [ ] **Step 2:** Run `npx vitest run tests/companionReasons.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit** `feat: type reason lines`.

### Task 8: Battle state reducer

**Files:**
- Create: `src/companion/battle.ts`
- Test: `tests/companionBattle.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface OpponentSlot { readonly speciesId: string; readonly fainted: boolean }
  interface BattleSnapshot {
    readonly myShields: number; readonly theirShields: number;
    readonly onField: number | null;                // team slot 0..2
    readonly fainted: readonly [boolean, boolean, boolean];
    readonly opponents: readonly OpponentSlot[];   // max 3
    readonly current: number | null;               // open opponent tab = their Pokémon on the field
    readonly awaitingWhoIsIn: boolean;
    readonly notice: string | null;                // e.g. "Already seen 3 opponents"
  }
  interface BattleState { readonly now: BattleSnapshot; readonly past: readonly BattleSnapshot[] }  // past capped at 50
  type BattleAction =
    | { type: 'newBattle' } | { type: 'addOpponent'; speciesId: string } | { type: 'selectOpponent'; index: number }
    | { type: 'iShielded' } | { type: 'theyShielded' } | { type: 'mineFainted' } | { type: 'theirsFainted' }
    | { type: 'switchIn'; slot: number } | { type: 'undo' };
  function initialBattle(): BattleState     // shields 2-2, onField 0, nothing fainted, no opponents
  function battleReducer(state: BattleState, action: BattleAction): BattleState
  ```
  **Rules:**
  - Every action except `undo` pushes the previous `now` onto `past`, but only when it changes something. `undo` pops.
  - **`addOpponent`:** an existing species is selected. Otherwise, with fewer than 3, it's appended and selected. With 3 already, state is unchanged except `notice`.
  - **Shields:** `iShielded`/`theyShielded` decrement, with a floor of 0 (at 0 it's a no-op).
  - **`mineFainted`:** marks `onField` fainted. With 2 left, it sets `onField` to null and `awaitingWhoIsIn` to true. With 1 left, that one is auto-switched in. With 0 left, `onField` becomes null.
  - **`switchIn`:** ignores fainted slots and clears `awaitingWhoIsIn`.
  - **`theirsFainted`:** marks the current opponent fainted.
  - **`newBattle`:** returns `initialBattle()` with an empty `past`.

- [ ] **Step 1: Write the failing tests, one per rule:**
  - shields never go below 0 and a no-op adds no undo entry;
  - a 4th distinct opponent leaves `opponents.length === 3` and sets `notice`;
  - re-adding a seen species selects it;
  - faint with 2 left gives `awaitingWhoIsIn`; with 1 left, an auto switch-in; all three down gives `onField === null`, and `mineFainted` again is a no-op;
  - `switchIn` to a fainted slot is ignored;
  - undo restores the exact previous snapshot, including after `mineFainted`;
  - `past` caps at 50;
  - a duplicate-species team (slots are indices) fainting slot 0 leaves slot 2 untouched.
- [ ] **Step 2:** Run `npx vitest run tests/companionBattle.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit** `feat: battle state reducer with undo`.

### Task 9: Persistence

**Files:**
- Create: `src/companion/persist.ts`
- Test: `tests/companionPersist.test.ts`

**Interfaces:**
- Consumes: `RosterEntry`/`parseRoster`, `BattleState`/`initialBattle`.
- Produces:
  ```ts
  interface KeyValueStore { getItem(k: string): string | null; setItem(k: string, v: string): void }
  interface SavedApp { readonly version: 1; readonly roster: readonly RosterEntry[]; readonly team: readonly [number, number, number] | null; readonly battle: BattleState }
  const STORAGE_KEY = 'gbl-companion';
  function defaultSavedApp(): SavedApp
  function loadSaved(store: KeyValueStore | null): SavedApp    // any failure → defaultSavedApp()
  function save(store: KeyValueStore | null, app: SavedApp): boolean  // false on failure, never throws
  ```
  - `team` holds indices into `roster`, lead first.
  - Validation: `version === 1`; the roster goes through `parseRoster`; `team` indices must be distinct and in range; the battle snapshot fields must have the right types. Anything invalid gives the default.
  - *Builder's choice:* the undo history may be dropped on save.

- [ ] **Step 1: Write the failing tests:**
  - a round-trip through an in-memory store;
  - each of these gives the default: garbage JSON, `version: 2`, a team index out of range, a store whose `getItem` throws, a `null` store;
  - `save` returns false and doesn't throw when `setItem` throws a quota error.
- [ ] **Step 2:** Run `npx vitest run tests/companionPersist.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run, then `npm run typecheck`. Expected: PASS and clean.
- [ ] **Step 5: Commit** `feat: versioned persistence for roster and battle`.

### Task 10: App scaffold

**Files:**
- Create:
  - `app/index.html`, `app/src/main.tsx`, `app/src/App.tsx`, `app/src/styles.css`;
  - `vite.config.ts`, `tsconfig.app.json`;
  - `docs/decisions/0004-vite-preact-web-app.md`.
- Modify: `package.json`, `vitest.config.ts`, `.gitignore`
- Test: `tests/app/App.test.tsx`

**Interfaces:**
- Consumes: `loadAppData`, `loadSaved`.
- Produces:
  - `App` component that fetches `${import.meta.env.BASE_URL}app-data.json` and shows `Loading…`, then the screens. On a fetch or parse failure it shows `Couldn't load game data` plus the error message.
  - Two views, **Battle** and **Team**, switched by a top nav, plus a **What the number means** link.
  - App state is held in a `useReducer` in `App`, saved through `save(localStorage)` on every change.

- [ ] **Step 1: Install the dev dependencies** at exact versions per Global Constraints. Add these scripts:
  - `dev`: `npm run gen-app-data && vite`;
  - `build`: `npm run gen-app-data && vite build`;
  - `preview`: `vite preview`;
  - `typecheck:app`: `tsc --noEmit -p tsconfig.app.json`, appended to `typecheck`.

  Set up Vite: `root: 'app'`, `base: '/gbl-lab/'`, `build.outDir: '../dist'`, the preact preset.

  Add `"jsx": "react-jsx"` and `"jsxImportSource": "preact"` to the base `tsconfig.json`, and add `app` to its `include`, so `tests/app/*.tsx` typecheck under `npm run typecheck`.

  Set up `tsconfig.app.json`: extends the base config, `jsx: react-jsx`, `jsxImportSource: preact`, `lib` ES2022 + DOM, `types: []` plus `vite/client`, and `include` covering `app/src` and `src`.

  Update vitest: include `tests/**/*.test.{ts,tsx}`. App tests use `// @vitest-environment jsdom`, and the preact preset (or esbuild `jsxImportSource`) handles TSX.

  Add `.superpowers/`, `dist/` and `app/public/app-data.json` to `.gitignore`.
- [ ] **Step 2: Write the failing test.** It renders `<App fetchData={...}>` (an injectable fetch for tests) with the data from `buildAppDataFile`. It asserts the Battle view shows the search box (placeholder `Search opponent…`) and the fresh-1v1 line `Ratings assume a fresh 1v1 at the current shields`. A rejected fetch shows `Couldn't load game data`.
- [ ] **Step 3:** Run `npx vitest run tests/app/App.test.tsx`. Expected: FAIL.
- [ ] **Step 4: Implement the scaffold.** Colors are CSS tokens taken from the approved mockup: the light set and the dark set under `prefers-color-scheme`.
  - They come from `/tmp/claude-1000/-home-toby-vanmook-Repos-Personal/81ae336e-9025-43c3-b240-306aa92db9af/scratchpad/battle-companion-mockups.html`, which is also published at https://claude.ai/artifact/UmkPdb5wqvMyXMKPfzvYUu.
  - Fonts: Barlow, Barlow Condensed and JetBrains Mono.
  - Write the ADR: Vite + Preact, chosen for a small bundle and fast startup on a phone; Vite 5 to stay compatible with vitest 2.
- [ ] **Step 5:** Run the test, `npm run typecheck` and `npm run build`. Expected: PASS, clean, and `dist/index.html` exists.
- [ ] **Step 6: Commit** `feat: Vite + Preact app scaffold for the battle companion`.

### Task 11: Team screen

**Files:**
- Create: `app/src/screens/TeamScreen.tsx`
- Test: `tests/app/TeamScreen.test.tsx`

**Interfaces:**
- Consumes: `searchSpecies`, `defaultRosterEntry`, `buildRosterCombatant`, `movesetInfo`, `parseRoster`, the `SavedApp` shape.
- Produces: `TeamScreen` props: `{ app: AppData; roster; team; onChange(roster, team) }`.

**Behavior:**
- **Adding a Pokémon:** pick a species with the same search as the battle screen. Moves default to the ranking moveset, and the fast and charged selects list the species' legal moves. IVs are three number inputs (0–15); level is optional.
- **Saving:** each entry is validated with `buildRosterCombatant` on save, and errors show inline (the `RosterError` message, including the unsupported case).
- **The team:** the user picks 3 roster entries in order, lead first, with move-up/down controls.
- **Import:** a textarea that pastes JSON through `parseRoster`; errors show inline.
- **Export:** shows the current roster as JSON in a read-only textarea, with a Copy button using `navigator.clipboard` and falling back to selecting the text.

- [ ] **Step 1: Write the failing tests:**
  - adding Medicham defaults its moves to Psycho Cut / Ice Punch / Dynamic Punch;
  - importing `[{"speciesId":"cramorant",...}]` shows an error containing `Cramorant` or `UnsupportedPokemonError`, and the roster is unchanged;
  - importing the README's roster example adds one entry;
  - choosing 3 entries and moving the third up changes the lead order passed to `onChange`.
- [ ] **Step 2:** Run `npx vitest run tests/app/TeamScreen.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit** `feat: team setup screen with import/export`.

### Task 12: Battle screen

**Files:**
- Create:
  - `app/src/screens/BattleScreen.tsx`;
  - `app/src/components/{OpponentCard,TeamRow,Suggestion,LogBar,ShieldTable,RatingExplainer}.tsx`.
- Test: `tests/app/BattleScreen.test.tsx`

**Interfaces:**
- Consumes everything in `src/companion`. Ratings are memoized per opponent species (e.g. a `Map<speciesId, Cell[]>` in a `useMemo` keyed by team), so moving between tabs doesn't re-simulate.

**Layout and behavior** (top to bottom, following mockup section 4):
- **Status bar:** both sides' shield pips, plus the names of my on-field Pokémon and theirs.
- **Search:** placeholder `Search opponent…`. Results appear as you type, and tapping one dispatches `addOpponent`.
- **Opponent tabs:** tapping one dispatches `selectOpponent`. Fainted tabs are struck through.
- **Opponent card:** name, types, the fast move as `{energyGain} energy / {turns} turns`, and each charged move with its `formatCounts` sequence.
- **Unsupported opponent:** the team section shows `Can't simulate {name}`, with no suggestion box.
- **Suggestion box** (only when there's an opponent and something on my field):
  - the stay/switch line. A switch reads `Losing ({r}). Switch to {name} ({r2})`, with buttons `Switched to {name}` (dispatches `switchIn`) and `Stayed in` (dismisses the box until the state changes);
  - the shield line: `Shield their first {move}` / `Let their first {move} through` / `Shield call is close`, with both ratings in small text, or nothing for `none`;
  - shield advice is computed for the on-field Pokémon only.
- **The fresh-1v1 line:** `Ratings assume a fresh 1v1 at the current shields`.
- **Team rows:** non-fainted rows come from `rankSlots`, best first, followed by fainted ones greyed out. Each row has the name (a label, or the species name), the colored rating, the user's counts, the `typeReason` line, a `Switch in` button (hidden on the on-field Pokémon) and a details icon that toggles the `ShieldTable` 3×3 grid.
- **"Who's in?" prompt:** while `awaitingWhoIsIn`, it lists the remaining Pokémon best first, as buttons.
- **Log bar:** `I shielded`, `They shielded`, `Mine fainted`, `Theirs fainted`, `They switched` (focuses the search), `Undo`, and `New battle`, which asks for confirmation first.
- **No team set:** the battle view shows `Set up your team first` and a link to the Team view.

- [ ] **Step 1: Write the failing tests.** Render with real app data and a saved team of Araquanid, Medicham and Azumarill (default IVs):
  - typing `mel` and tapping Melmetal shows `4-4-4` and `5-5-5`. A battle starts at 2-2, so the team rows read Medicham 663, Araquanid 445, Azumarill 294, in that order;
  - at 2-2 with Araquanid leading, the suggestion reads `Switch to Medicham`, and tapping `Switched to Medicham` makes Medicham on-field;
  - `I shielded` twice, then a third time, leaves 0 pips;
  - `Mine fainted` shows the `Who's in?` prompt with two buttons;
  - `Undo` restores it;
  - searching `cramorant` shows `Can't simulate Cramorant` and no suggestion box;
  - a team with two Azumarills renders both rows, and `Switch in` on the second targets slot 2.
- [ ] **Step 2:** Run `npx vitest run tests/app/BattleScreen.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement the components.** Touch targets must be at least 44 px tall, and the layout has to fit a 375 px-wide portrait screen with no horizontal scroll.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit** `feat: battle screen with suggestions and one-tap log`.

### Task 13: Offline, deploy config, docs

**Files:**
- Create: `.github/workflows/pages.yml`, `app/public/icon-192.png`, `app/public/icon-512.png` (simple generated icons)
- Modify: `vite.config.ts` (add `VitePWA`), `README.md`, the spec's `Status` line
- Test: `tests/appBuild.test.ts`

- [ ] **Step 1: Write the failing test.** It runs `npm run build` (with a long timeout) and asserts that `dist/` contains:
  - `manifest.webmanifest`, with `start_url` and `scope` both `/gbl-lab/` and `display: standalone`;
  - a service worker file (`sw.js`), whose precache list includes `app-data.json`.
- [ ] **Step 2:** Run `npx vitest run tests/appBuild.test.ts`. Expected: FAIL.
- [ ] **Step 3: Configure `VitePWA`.**
  - `registerType: 'autoUpdate'`;
  - the manifest: name `GBL Battle Companion`, short name `GBL Companion`, the icons, and theme colors from the tokens;
  - workbox `globPatterns` include `**/*.{js,css,html,json,png,woff2}`, and `maximumFileSizeToCacheInBytes` is raised above the app-data size.
  - Add `<link rel="apple-touch-icon">` and `<meta name="apple-mobile-web-app-capable" content="yes">` to `index.html`.
- [ ] **Step 4: Write the workflow.** `.github/workflows/pages.yml`: `on: workflow_dispatch` only. Steps: checkout, setup-node 22, `npm ci`, `npm test`, `npm run build`, `actions/upload-pages-artifact` with `dist`, `actions/deploy-pages`. Set `permissions: pages: write, id-token: write`.
- [ ] **Step 5: Update the README.** Add a "Battle companion" section covering:
  - what it is;
  - `npm run dev`, `npm run build`, `npm run preview`;
  - the one-time user steps to publish: enable Pages with source "GitHub Actions" in repo settings, then run the workflow from the Actions tab;
  - that HP and energy aren't tracked.

  Note that no environment variables are needed. Set the spec status to `Implemented (date)` after Task 12's suite is green.
- [ ] **Step 6:** Run `npm test` (full suite) and `npm run typecheck`. Expected: all pass, clean.
- [ ] **Step 7: Commit** `feat: installable offline app and manual Pages deploy workflow` and `docs: battle companion README`.

**Manual check (after the user publishes):** open it on the iPhone, add it to the home screen, then turn on airplane mode and reopen it. Switch to another app and back mid-battle, and check the state survives. Record the result in the PR description.
