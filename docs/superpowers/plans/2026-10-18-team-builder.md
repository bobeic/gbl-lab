# Team Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Builder tab that recommends the top 10 teams of three from the user's roster, scored with pick3's coverage/consistency/safety formula.

**Architecture:**
- **Scoring:** pure functions over a ratings table, in `src/companion/teamBuilder.ts`.
- **Simulation:** simulates each roster Pokémon against the top-150 meta at 0-0/1-1/2-2 and caches results per entry, in `src/companion/builderSim.ts`. It runs in a Web Worker.
- **UI:** `BuilderScreen` takes an injectable `simulate` function, so tests use hand-made ratings and the app passes the worker-backed one.

**Tech Stack:** TypeScript, Preact, Vite (module workers), Vitest + @testing-library/preact (jsdom).

**Spec:** `docs/superpowers/specs/2026-10-18-team-builder-design.md`

## Global Constraints

- **Branch and base:** this branch sits on top of the icons branch (PR #6). Use `PokemonIcon` from `app/src/components/PokemonIcon.tsx` next to every Pokémon name.
- **Role scenarios:**
  - lead and safe switch are rated at 1-1;
  - closer at 0-0;
  - a win means rating `> 500`;
  - a consistent win also needs `> 500` at 0-0 and at 2-2.
- **Formulas:**
  - Coverage = covered ÷ meta size × 100.
  - Consistency = consistent role wins ÷ role wins × 100, and 0 when there are no role wins.
  - Safety = max(0, 100 − 20 × (safe switch's 1-1 ratings `< 300`) − 10 × (first 10 meta entries not covered)).
  - Score = 0.5 × coverage + 0.25 × consistency + 0.25 × safety.
- **Orders:** a team's score is the best of 6 orders, tried in this sequence over members `[a,b,c]` (in roster order): `[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]`. The first order with the highest score wins.
- **Ranking:** full precision for ranking, whole numbers for display. Ties go by roster order: compare the sorted roster indices lexicographically. Show the top 10.
- **Which teams:** every 3-combination of roster entries containing all pins (0–3 pins). Never two entries with the same Pokédex number (`gd.species.get(id).dex`); this includes shadow and regional forms.
- **Threats:** meta opponents where every member's 1-1 rating is `≤ 500`. Order them by best member 1-1 rating, ascending, and show at least 8.
- **Meta:** `buildMeta(gd, app.ranked, 150).entries`. Only 0-0, 1-1 and 2-2 are simulated.
- **Pins:** not persisted. They reset on reload and when the roster changes.
- **Unsupported roster entries** (`buildRosterCombatant` throws `RosterError`): skip them and name them in a note.
- **Layout:** for laptops, roughly 40% ranked list on the left and details on the right. Don't design for phone first.
- **Copy:**
  - Coverage: "N of 150 meta opponents beaten by someone in their role".
  - Consistency: "X% of those wins still hold at 0-0 and 2-2 shields".
  - Safety: "N hard counters to the safe switch · M of the top 10 uncovered".

## Review Focus

1. **The roster has two of the same species** (e.g. two Medichams, or Medicham and Shadow Medicham): they must never be on one team. Task 1 test `never pairs the same Pokédex number`.
2. **Pins that make no valid team** (e.g. two pins with the same dex): show "No team fits your pins", not an empty list. Task 1 test `returns no teams when pins clash` and Task 3 test `says no team fits the pins`.
3. **Fewer than 3 usable entries**, whether a small roster or unsupported entries: show a message pointing to the Team tab, and name the skipped entries. Task 3 test `asks for at least 3 usable Pokémon`.
4. **The roster changes while simulating:** the old result must never show, and pins reset. Task 3 test `ignores a stale result after the roster changes`.
5. **Large rosters:** the UI stays responsive and shows progress, because the simulation runs in the worker. Task 4 test (worker message protocol) and a manual check with a 40-entry roster.

---

### Task 1: Team scoring

**Files:**
- Create: `src/companion/teamBuilder.ts`
- Modify: `src/companion/index.ts` (add `export * from './teamBuilder';`)
- Test: `tests/companionTeamBuilder.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:

```ts
/** One Pokémon's ratings against one meta opponent at 0-0, 1-1 and 2-2. */
export type Diag = readonly [r00: number, r11: number, r22: number];
/** A usable roster entry: its roster index, Pokédex number and ratings[o] against meta opponent o. */
export interface Candidate { readonly index: number; readonly dex: number; readonly ratings: readonly Diag[] }
export interface TeamScore {
  /** Roster indices: lead, safe switch, closer. */
  readonly order: readonly [number, number, number];
  readonly score: number; readonly coverage: number; readonly consistency: number; readonly safety: number;
  /** Meta opponents covered. */
  readonly covered: number;
  /** Per role: opponents that member beats in its role scenario. */
  readonly roleWins: readonly [number, number, number];
  readonly safeCounters: number;
  readonly topUncovered: number;
  /** Meta indices nobody beats at 1-1, worst first. */
  readonly threats: readonly number[];
}
export function scoreOrder(team: readonly [Candidate, Candidate, Candidate]): TeamScore;
export function recommendTeams(candidates: readonly Candidate[], pins: readonly number[], limit?: number): TeamScore[]; // limit default 10; pins are roster indices
```

- [ ] **Step 1: Write the failing tests**

Build candidates with a helper `cand(index, dex, ratings: Diag[])`. Use a 12-opponent meta, so the top 10 is the first 10. Required tests and assertions:
- `scores coverage from role scenarios`:
  - the lead beats opponents 0–3 at 1-1 only (e.g. `[400, 600, 400]`);
  - the closer beats 4–5 at 0-0 only (`[600, 400, 400]`);
  - the safe switch beats nothing (all `[400,400,400]`).
  - Expect `covered` 6, `coverage` 50, and `roleWins` `[4, 0, 2]` for order `[lead, safe, closer]`.
- `counts consistency only for wins that hold at 0-0 and 2-2`: same team, but opponents 0–1 are `[600,600,600]` for the lead. Expect `consistency` 2/6 × 100.
- `consistency is 0 with no wins`: all ratings 400. Expect `consistency` 0 and `coverage` 0.
- `safety loses 20 per safe-switch counter and 10 per uncovered top-10, floored at 0`:
  - Case 1: the safe switch has two opponents rated `[x, 250, x]`, and 3 of the first 10 are uncovered. Expect `safety` 100 − 40 − 30 = 30.
  - Case 2: a safe switch with 6 counters gives 0.
- `score is 0.5 coverage + 0.25 consistency + 0.25 safety`: check `score` against those three fields with `toBeCloseTo`.
- `picks the best of the 6 orders`: a team where one member only wins at 0-0 must come back with that member as closer (`order[2]`).
- `never pairs the same Pokédex number`: 4 candidates, two of them with dex 308. No returned team contains both indices.
- `every team contains all pins`: pins `[2]` gives every `order` including 2. Pins `[0, 3]` gives every order including both.
- `returns no teams when pins clash`: two pins with the same dex give `[]`.
- `ranks by score, ties by roster order, top 10 only`: 7 identical candidates (35 teams, all equal) return exactly 10. The first team's sorted indices are `[0,1,2]`, then `[0,1,3]`.
- `lists threats worst first`: opponents 8 and 3 are unbeaten. Opponent 8's best member 1-1 rating is 100 and opponent 3's is 450, so expect `threats` `[8, 3]`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/companionTeamBuilder.test.ts`
Expected: FAIL (cannot resolve `../src/companion/teamBuilder` exports).

- [ ] **Step 3: Implement `scoreOrder` and `recommendTeams` in `src/companion/teamBuilder.ts`**

- Use the formulas in Global Constraints, and keep a doc comment citing pick3.
- `recommendTeams` enumerates `i<j<k` over `candidates` (in the order given, which is roster order). It skips dex clashes and teams missing a pin, calls `scoreOrder` on each of the 6 orders and keeps the first best.
- Sort by score descending; the stable sort keeps the enumeration order for ties. Slice to `limit`.
- Add the export to `src/companion/index.ts`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/companionTeamBuilder.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit**

```bash
git add src/companion/teamBuilder.ts src/companion/index.ts tests/companionTeamBuilder.test.ts
git commit -m "feat(companion): pick3-style team scoring and recommendation"
```

---

### Task 2: Roster simulation with a per-entry cache

**Files:**
- Modify: `src/matrix/cell.ts`. Add `simulateDiagonal` beside `simulateCell`, reusing the private `rate`.
- Create: `src/companion/builderSim.ts`
- Modify: `src/companion/index.ts` (add `export * from './builderSim';`)
- Test: `tests/companionBuilderSim.test.ts`

**Interfaces:**
- Consumes: `Diag`, `Candidate` (Task 1); `buildRosterCombatant`, `RosterEntry` (`src/matrix/teamMatrix.ts`); `metaCombatant`, `MetaEntry` (`src/matrix/meta.ts`); `RosterError` (`src/errors.ts`).
- Produces:

```ts
// src/matrix/cell.ts
/** a's ratings against b at 0-0, 1-1 and 2-2: the same values as simulateCell's diagonal. */
export function simulateDiagonal(gd: GameData, a: Combatant, b: Combatant): Diag;

// src/companion/builderSim.ts
/** Cache key: species, moves, IVs and level. The label is not part of it. */
export function entryKey(entry: RosterEntry): string;
export interface SimResult { readonly candidates: Candidate[]; readonly skipped: { readonly name: string; readonly reason: string }[] }
export function simulateRoster(
  gd: GameData, roster: readonly RosterEntry[], meta: readonly MetaEntry[],
  cache: Map<string, readonly Diag[]>, onProgress?: (done: number, total: number) => void,
): SimResult;
```

- [ ] **Step 1: Write the failing tests**

- `simulateDiagonal matches simulateCell's diagonal`:
  - Medicham (COUNTER / ICE_PUNCH, PSYCHIC) against Azumarill (BUBBLE / ICE_BEAM, PLAY_ROUGH);
  - expect `[cell[0][0], cell[1][1], cell[2][2]]`.
- `simulates each usable entry against the meta and records dex`:
  - meta is the first 3 entries of `buildMeta(gd, rankings, 150)`, using `data/rankings-1500.json`;
  - a roster of medicham and azumarill gives 2 candidates, with indices `[0,1]`, dex `[308, 184]`, each with 3 ratings.
- `skips unsupported entries and names them`:
  - the roster is `[medicham, aegislash_shield (AEGISLASH_CHARGE_PSYCHO_CUT / SHADOW_BALL, GYRO_BALL), azumarill]`;
  - expect candidate indices `[0, 2]`, and `skipped[0].name` is `'aegislash_shield'` (the label if one is given);
  - `skipped[0].reason` is non-empty.
- `reuses cached ratings`:
  - pre-fill `cache` with `entryKey(medicham)` mapped to `[[1,2,3],[1,2,3],[1,2,3]]`;
  - the result's medicham ratings equal that fake array, which proves no re-simulation;
  - azumarill's key is added to `cache` afterwards.
- `entryKey ignores the label`: the same entry with a different `label` gives the same key, and different IVs give a different key.
- `reports progress per entry`: `onProgress` is called with `(1,2)` then `(2,2)`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/companionBuilderSim.test.ts`
Expected: FAIL (missing exports).

- [ ] **Step 3: Implement**

- `simulateDiagonal` calls `rate` for `[0,0]`, `[1,1]` and `[2,2]`.
- `simulateRoster`:
  - builds meta combatants once;
  - for each entry, catches `RosterError` from `buildRosterCombatant` and pushes it to `skipped` (name = label ?? speciesId, reason = message);
  - otherwise takes cached ratings or simulates them and stores them;
  - `dex` comes from `gd.species.get(entry.speciesId)!.dex`;
  - calls `onProgress(i + 1, roster.length)` after each entry.
- `entryKey` is `JSON.stringify([speciesId, fastMoveId, chargedMoveIds, ivs ?? null, level ?? null])`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/companionBuilderSim.test.ts tests/matrixCell.test.ts`
Expected: PASS (6 new tests; the existing cell tests still pass).

- [ ] **Step 5: Commit**

```bash
git add src/matrix/cell.ts src/companion/builderSim.ts src/companion/index.ts tests/companionBuilderSim.test.ts
git commit -m "feat(companion): simulate the roster at 0-0/1-1/2-2 with a per-entry cache"
```

---

### Task 3: Builder screen

**Files:**
- Create: `app/src/screens/BuilderScreen.tsx`
- Modify: `app/src/styles.css`. Add a `.builder` layout: two columns at `min-width: 1100px`, about `minmax(0, 0.7fr) minmax(0, 1fr)`, and widen the shell with `.shell:has(.builder) { max-width: 1320px; }`, matching `.battle`.
- Test: `tests/app/BuilderScreen.test.tsx`

**Interfaces:**
- Consumes: `recommendTeams`, `TeamScore`, `Candidate`, `SimResult` (Tasks 1–2); `PokemonIcon`; `entryName`, `speciesName` (`app/src/names.ts`); `AppData`, `SavedApp`.
- Produces:

```ts
export type Simulate = (roster: readonly RosterEntry[], onProgress: (done: number, total: number) => void) => Promise<SimResult & { readonly metaIds: readonly string[] }>;
export interface BuilderScreenProps {
  readonly app: AppData;
  readonly roster: readonly RosterEntry[];
  readonly team: SavedApp['team'];
  readonly simulate: Simulate;
  readonly onUseTeam: (team: readonly [number, number, number]) => void;
}
export function BuilderScreen(props: BuilderScreenProps): JSX.Element;
```

**Behaviour:**
- **Running the simulation:** on mount, and whenever `roster` changes, call `simulate`. Show "Simulating N of M…" while it runs. Ignore a result if `roster` changed since that call started; compare against a ref.
- **Recomputing:** `recommendTeams` runs with `useMemo` over the candidates and pins.
- **Top bar:**
  - "Your collection (from Team tab): N Pokémon";
  - one chip per pin, each with an icon, the name, and a ✕ button labelled `Unpin <name>`;
  - a `<select aria-label="Pin a Pokémon">` listing unpinned roster entries, disabled once 3 are pinned.
- **Left column:** an ordered list `aria-label="Best teams"`. Each row is a button showing the rank, three icons with names in "Lead → Safe switch → Closer" order, and the rounded score. Clicking a row selects it; the first row is selected by default.
- **Right column:**
  - the selected team's three role cards (role label, icon, name, "wins N of M at 1-1/0-0");
  - the three copy lines from Global Constraints;
  - "Threats" with the first 8 threats (icon + `speciesName(app, metaIds[o])`), or "None" if there are none;
  - a button "Use this team". It reads "Your current team" and is disabled when `team` equals `order`.
- **Messages:**
  - `skipped` is non-empty: "Skipped (can't simulate): <names>".
  - Fewer than 3 candidates: "Add at least 3 Pokémon you can simulate on the Team tab to get recommendations."
  - Pins produce no teams: "No team fits your pins."

- [ ] **Step 1: Write the failing tests**

Use `testAppData()` from `tests/companionFixture`. Use a fake `simulate` that returns hand-made candidates for a 4-entry roster (medicham, azumarill, registeel, lanturn), with `metaIds` the first N ids of `app.ranked`, and calls `onProgress(4,4)`. Required tests:
- `ranks teams and shows the selected team's roles, scores and threats`:
  - after `await screen.findByRole('list', { name: 'Best teams' })`, there are 4 rows (C(4,3));
  - the details show "Lead", "Safe switch", "Closer", a line starting with "N of" for coverage, and the threat names.
- `use this team sends the order`: click "Use this team", and `onUseTeam` is called with the first team's `order`.
- `pinning filters the teams`: choose registeel in "Pin a Pokémon". Every row now includes "Registeel", and there are 3 rows.
- `says no team fits the pins`: use candidates where medicham and medicham_shadow share dex 308. Pinning both shows "No team fits your pins."
- `asks for at least 3 usable Pokémon`: `simulate` returns 2 candidates and 1 skipped (`aegislash_shield`). Expect the "Add at least 3…" message and "Skipped (can't simulate): aegislash_shield".
- `ignores a stale result after the roster changes`:
  - the first `simulate` call returns a promise the test resolves later;
  - rerender with a new roster, whose `simulate` resolves at once with different candidates;
  - then resolve the first. Only the second result's teams are shown, and pins are cleared.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/app/BuilderScreen.test.tsx`
Expected: FAIL (cannot resolve `BuilderScreen`).

- [ ] **Step 3: Implement `BuilderScreen` and the `.builder` CSS**

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/app/BuilderScreen.test.tsx`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add app/src/screens/BuilderScreen.tsx app/src/styles.css tests/app/BuilderScreen.test.tsx
git commit -m "feat(app): Builder screen with ranked teams, pins and team details"
```

---

### Task 4: Worker and the Builder tab

**Files:**
- Create: `app/src/builderWorker.ts`. This is the worker entry. It loads `app-data.json` itself, from `import.meta.env.BASE_URL`, with `loadAppData`. It builds the meta once and keeps the `Map` cache across requests.
- Create: `app/src/builderClient.ts`. It wraps the worker as a `Simulate`.
- Create: `src/companion/builderProtocol.ts`. This holds the message types and a pure `handleRequest`, so the protocol is testable without a worker.
- Modify: `app/src/App.tsx`:
  - add `'builder'` to `View`, and a `Builder` tab button between Team and the explainer link;
  - render `<BuilderScreen … simulate={workerSimulate} onUseTeam={(t) => dispatch({ type: 'setTeam', roster: saved.roster, team: t })} />`.
- Test: `tests/companionBuilderProtocol.test.ts`, plus an added case in `tests/app/App.test.tsx`.

**Interfaces:**
- Consumes: `simulateRoster`, `SimResult`, `Diag` (Task 2); `buildMeta`, `MetaEntry`; `Simulate`, `BuilderScreen` (Task 3).
- Produces:

```ts
// src/companion/builderProtocol.ts
export interface BuilderRequest { readonly id: number; readonly roster: readonly RosterEntry[] }
export type BuilderReply =
  | { readonly id: number; readonly type: 'progress'; readonly done: number; readonly total: number }
  | { readonly id: number; readonly type: 'done'; readonly result: SimResult; readonly metaIds: readonly string[] }
  | { readonly id: number; readonly type: 'error'; readonly message: string };
export function handleRequest(gd: GameData, meta: readonly MetaEntry[], cache: Map<string, readonly Diag[]>, req: BuilderRequest, post: (r: BuilderReply) => void): void;
// app/src/builderClient.ts
export const workerSimulate: Simulate; // lazily creates `new Worker(new URL('./builderWorker.ts', import.meta.url), { type: 'module' })`
```

- [ ] **Step 1: Write the failing tests**

- In `tests/companionBuilderProtocol.test.ts`:
  - `posts progress then done with meta ids`: a 3-entry meta and a 1-entry roster give posts `[{type:'progress',done:1,total:1}, {type:'done', metaIds: <3 ids>, …}]`, all with the request's `id`.
  - `posts an error instead of throwing`: if a `simulateRoster` failure is not a `RosterError` (e.g. a meta entry with an unknown species), it is posted as `type: 'error'`.
- In `tests/app/App.test.tsx`:
  - `opens the Builder tab`: clicking the "Builder" tab shows the Builder screen heading or collection line.
  - Pass a stub `simulate` via a new optional `AppProps.simulate` prop that defaults to `workerSimulate`. jsdom has no `Worker`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/companionBuilderProtocol.test.ts tests/app/App.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the protocol, worker, client and the App wiring**

- **Client:** keeps a counter for request ids and a map of pending ids to resolve, reject and onProgress. It rejects on `error` replies. It ignores replies for ids it no longer has.

- [ ] **Step 4: Run the tests, then the full gate**

Run: `npx vitest run tests/companionBuilderProtocol.test.ts tests/app/App.test.tsx`
Expected: PASS

Run: `npm run typecheck && npm test && npm run build`
Expected:
- all three exit 0;
- the build output lists a separate worker chunk, `builderWorker-*.js`.

- [ ] **Step 5: Manual check at laptop width**

- Run `npm run dev`.
- In a 1440×900 headless Chromium, import a 40-entry roster on the Team tab, then open Builder.
- Check:
  - the progress text advances while the tabs stay clickable;
  - the ranked list has icons;
  - "Use this team" makes the Team tab show those three in order;
  - no console errors.
- Save a screenshot to the scratchpad.

- [ ] **Step 6: Commit**

```bash
git add src/companion/builderProtocol.ts src/companion/index.ts app/src/builderWorker.ts app/src/builderClient.ts app/src/App.tsx tests/companionBuilderProtocol.test.ts tests/app/App.test.tsx
git commit -m "feat(app): Builder tab backed by a simulation worker"
```
