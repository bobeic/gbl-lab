# Battle Engine — Design Spec (Sub-project 1)

Date: 2026-10-15
Status: Implemented (2026-10-15)

## 1. Context and intent

### What the user wants (stated)
- Get better at Pokémon GO Battle League, Great League (1500 CP cap).
- Understand *what* they are doing wrong and *where* — explanations over bare scores.
- Team choice first (which 3, order, moves); in-battle coaching (shield/bait/switch decisions) later.
- Motivating example: adding a good Melmetal made their team feel worse, likely because it displaced their bulky Pokémon. The tooling must be able to explain such regressions.
- Only a handful of battle-ready Pokémon (PvPoke-recommended moves, powered to the 1500 cap). Manual entry is fine; no Poke Genie import needed.
- A "wanted list": which species (and IVs) to look out for and prioritise, ranked by how much they'd improve the current team. Event alignment is a later extra.
- Web UI usable on a phone.

### Assumptions (not stated, agreed implicitly)
- Fidelity to PvPoke matters; wrong advice is worse than none.
- Meta opponents come from PvPoke's Great League rankings.

### Overall roadmap (each sub-project gets its own spec → plan → build)
1. **Battle engine + data + validation** — this spec.
2. **Meta rankings** — offline batch producing ranking data artifacts.
3. **Team builder web app** — roster, best teams, threats/coverage, team diff, wanted list with target IVs.
4. **Later** — event alignment, play-vs-agent, coaching (battle replay with alternative decisions).

### Platform decision
TypeScript everywhere, running in the browser as a static site; heavy batch work runs offline in Node. Rationale: one language, free static hosting, phone access without a server, and PvPoke demonstrates in-browser simulation is fast enough. RL (if ever) can be trained elsewhere and exported. To be recorded as an ADR.

## 2. Scope

**In scope:** game data loading, stat/CP/level/IV-rank computation, a 1v1 battle engine with PvPoke-equivalent mechanics, a pluggable decision policy with a PvPoke-like default, battle rating, an oracle-based validation harness, and a debug CLI.

**Out of scope:** 3v3 and switching (state shape must allow it), any UI, team building, rankings batch, agents.

## 3. Data and stats

### 3.1 Game data
- Vendor PvPoke's `gamemaster.json` (MIT licensed, github.com/pvpoke/pvpoke) into `data/`, pinned to a recorded upstream commit, with `data/ATTRIBUTION.md`.
- Vendor PvPoke's Great League overall rankings JSON (defines the meta and serves as a secondary oracle).
- `npm run update-data` refreshes both from a specified upstream commit and records it.
- A loader parses data into strict types: `Species` (dex, id, name, types, base stats, fast/charged move ids, elite moves, tags incl. shadow eligibility), `FastMove` (power, energy gain, turns), `ChargedMove` (power, energy cost, buffs + chance + target), `TypeChart`.
- Loader validates on load: unknown move references, missing fields or bad numbers throw a descriptive error naming the offending entry.

### 3.2 Stats
- CP = max(10, ⌊(baseAtk+ivAtk) · √(baseDef+ivDef) · √(baseSta+ivSta) · CPM² / 10⌋).
- HP = max(10, ⌊(baseSta+ivSta) · CPM⌋).
- Level search: half-levels 1–50 (51 when best-buddy allowed); select the highest level with CP ≤ cap (default 1500).
- Shadow: attack ×6/5, defense ×5/6 (as PvPoke).
- CPM table sourced from game data if present, otherwise vendored constants with source noted.

### 3.3 IV ranking
- Stat product = effAtk · effDef · HP at the best level under the cap.
- Rank all 4096 IV combinations for a species with a configurable IV floor (0 wild, 1 good friend, 2 great, 3 ultra, 4 best, 5 weather boost, 10 raid/research, 12 lucky).
- API returns rank, stat product, % of rank-1, level, CP.
- Order, floors and level bounds follow PvPoke's `Pokemon.generateIVCombinations` exactly (see §10).

## 4. Battle engine

### 4.1 Core contract
A turn is two pure functions (revised after reading PvPoke's `Battle.step`, which decides actions after cooldowns tick and asks for the shield choice mid-resolution):
- `beginTurn(state): BattleState` — ticks cooldowns.
- `canAct(state, side): boolean` — whether a side may choose an action this turn.
- `resolveTurn(state, actions: [Action | null, Action | null], decideShield: ShieldDecider): { state: BattleState; events: BattleEvent[] }`.
- Fully deterministic: PvPoke's simulate mode has no randomness (chance buffs use a deterministic meter, ties resolve in side order), so no RNG is carried. Does not mutate the input state.
- Simultaneous resolution per 0.5s turn, via PvPoke's action queue + priority model.

### 4.2 State
Per side: team (array; length 1 in this sub-project), active index, per-Pokémon HP, energy (0–100), atk/def buff stages (−4..+4), fast-move cooldown progress, shields remaining, switch timer (unused for now). Global: turn number, RNG state, battle-over flag.

### 4.3 Mechanics (matched to PvPoke semantics)
- Fast moves take 1–5 turns, grant energy, deal damage per PvPoke's timing model.
- Charged move allowed when energy ≥ cost; energy capped at 100.
- Fast move in progress still lands when the opponent throws a charged move (per PvPoke).
- Simultaneous charged moves: CMP — higher raw attack stat (excluding shadow/buffs, as PvPoke) resolves first and, when attacks differ, a Pokémon KO'd by the first charged move does not fire. Equal attack: both resolve in side order.
- Damage = ⌊0.5 · Power · (Atk·atkMult)/(Def·defMult) · STAB · Eff · 1.3⌋ + 1; STAB 1.2; per-type effectiveness 1.6 / 0.625 / 0.390625 multiplied across defender types; charged moves assume perfect charge; shielded charged move deals 1.
- Buff stage multipliers: (4+n)/4 for n>0, 4/(4−n) for n<0; stages clamped to ±4.
- Chance-based buffs: PvPoke's deterministic "buff apply meter" — each charged move's meter starts at its chance (0 for exactly 50%), adds the chance per use, and the buff applies when the meter crosses a whole number. 100% buffs always apply. Debuffs still apply when the move is shielded.
- Damage constants use PvPoke's float32-exact values (e.g. PvP bonus 1.2999999523162842, super effective 1.6000000238418579) and its multiplication order, so per-hit damage matches bit-for-bit.
- Each side keeps a per-move "last computed damage" cache that PvPoke's decision logic reads; it is part of battle state.
- Exact timing details are confirmed by reading PvPoke's source; where this spec and PvPoke disagree, PvPoke wins and the spec is updated.

### 4.4 Events
Every resolved action emits typed events (fast move used, damage, energy gained, charged move used, shield used, buff applied, faint, battle end) with turn number and side. Used later for timelines and coaching.

## 5. Decision policies

### 5.1 Interface
```ts
interface Policy {
  // Called whenever the side's cooldown is 0 in a live battle (as PvPoke calls decideAction); on the turn after a
  // charged move the action is discarded but lastDamageUpdates still apply (see §10).
  chooseAction(state: BattleState, me: Side): { action: Action; lastDamageUpdates?: LastDamageUpdate[] };
  chooseShield(state: BattleState, me: Side, incomingMoveIndex: number, damage: number): boolean;
}
```
Future agents, search-based coaches, and human input implement the same interface.

### 5.2 PvPokeLikePolicy (default)
Re-implementation of PvPoke's `ActionLogic` in our own TypeScript with references to the original. Expected behaviours (to be verified against source, list corrected where it differs):
- Search for the fastest KO sequence of charged moves given energy and opponent shields.
- Bait shields with the cheaper move while the opponent has shields (toggle).
- Optimise charged-move timing to avoid giving free fast-move turns.
- Avoid self-debuffing moves when counterproductive.
- Shield when the incoming hit would KO or is worth a shield per PvPoke's heuristic.
- Options: shields per side (0/1/2), bait on/off.

### 5.3 Test policies
`FastOnlyPolicy`, `GreedyCheapestPolicy` — isolate engine mechanics from decision logic in tests.

## 6. Simulation and scoring
- `runMatchup(a: Combatant, b: Combatant, options): MatchupResult` loops `step` until a faint or turn limit, returning winner, HP/energy remaining, turns, battle rating per side, and the full event log.
- `step(state, policies): { state, events }` (src/sim/step.ts) is one turn of that loop; `runBattle(state, options)` runs the same loop from any live state, so a battle can start mid-way.
- Battle rating = 500 · (damage dealt / opponent max HP) + 500 · (HP remaining / own max HP). >500 is a win.
- Turn limit guards against infinite loops; hitting it is reported as an error, not a draw.

## 7. Validation

### 7.1 Oracle
- `scripts/gen-oracle.ts` (dev-only) runs PvPoke's simulator from a pinned checkout in Node and emits golden fixtures: top ~100 Great League meta × top ~100 at 0-0, 1-1, 2-2 shields (~15k matchups), recording winner, rating, HP remaining.
- PvPoke code is never shipped or imported by `src/`.
- Secondary check: matchups/counters listed in the vendored rankings file.

### 7.2 Acceptance criteria
- Stats, CP, level, per-hit damage: exact match on all tested cases.
- Matchup winner agreement ≥ 98% across the oracle set.
- Median absolute battle rating difference ≤ 25.
- A mismatch report lists the worst disagreements with both event logs side by side.

### 7.3 Unit tests
Hand-computed damage cases, CMP tie, energy cap at 100, buff clamp at ±4, shield = 1 damage, level search at the cap boundary, IV rank against known published ranks, loader rejects malformed data.

## 8. Tooling and layout
- TypeScript strict, Vitest, Node ≥ 20, npm.
- `npm run sim -- <speciesA> <speciesB> --shields 1 1 [--ivs ...]` prints the result and a turn timeline.

```
gbl-lab/
  data/                  vendored gamemaster + rankings, ATTRIBUTION.md
  src/data/              loader + types
  src/stats/             CP / level / IV rank
  src/engine/            state, step(), damage, buffs
  src/policy/            PvPokeLikePolicy + test policies
  src/sim/               runMatchup(), battle rating
  scripts/               update-data, gen-oracle, sim CLI
  tests/                 unit tests + oracle fixtures
  docs/decisions/        ADRs
  docs/superpowers/specs/
  README.md
```

## 9. Error handling
- Data load: fail fast with entry-specific messages.
- Invalid input to stats (unknown species, IV out of 0–15, cap unreachable): typed errors.
- Engine: illegal actions (charged move without energy, unknown move) throw rather than silently downgrade; policies are responsible for legal actions.
- Turn-limit exceeded: error with the last events attached.
- Battle setup: shields outside integers 0–2 or start energy outside integers 0–100 throw `BattleSetupError` (no clamping); resolving or stepping a battle that is already over throws `IllegalActionError`; equipping the same charged move twice throws `GameDataError`.

## 10. Findings from reading PvPoke (commit a23fb293300077028a65da534c73bd6367b7ef9d)
- Fast moves queue on the turn chosen and land once `(turn − queuedTurn)·500 ≥ cooldown − 500`; a fast move "floating" when a charged move resolves lands on the following turn. After any charged move both cooldowns reset to 500 and no new actions are taken the next turn.
- Chance buffs: deterministic meter (see 4.3).
- Shields in simulate mode: shield by default whenever shields remain; `ActionLogic.wouldShield` overrides only for self-buffing bait moves (e.g. Power-Up Punch) and when the defender's best move lowers its own defense. Lives in `PvPokeLikePolicy.chooseShield`.
- CPM table is a constant in `Pokemon.js` (109 entries, half-levels 1–55), not in gamemaster.json; vendored with source noted.
- Ranking simulations use each species' `defaultIVs.cp1500` (level, atk, def, hp), not rank-1 IVs; the oracle and meta runs use the same.
- Shadow Pokémon are separate gamemaster entries (`*_shadow`, tag `shadow`).
- PvPoke runs headless in a Node `vm` with a small jQuery stub (spike verified: Medicham vs Azumarill 1-1 → 324/675).
- Out of scope for this sub-project: form-changing Pokémon (Aegislash, Cramorant, Mimikyu, Morpeko) and mega Pokémon. They are excluded from the oracle acceptance set and the engine rejects them with a typed error. They are added in a follow-up because Mimikyu and Morpeko are in the meta. Mimikyu and Morpeko were added by `2026-10-15-form-changes-design.md`. Aegislash and Cramorant remain unsupported.
- Ditto's TRANSFORM and Magearna's STRUGGLE sit in the species `fastMoves` list with `energyGain` 0, so PvPoke (GameMaster.js:831) classes them "charged". Species move lists are therefore validated by existence only in the loader; engine-level kind checks happen in `buildCombatant`.
- Sandbox (scripted) mode action lookup (Battle.js:740-760): PvPoke scans every scripted action and keeps the **last** one matching the side and turn; entries whose move index is outside the moveset are skipped, and if the last match is unaffordable the side falls back to a fast move (an earlier affordable entry does not rescue it). The shield flag comes from that same entry. `ScriptedPolicy` mirrors this.
- Sandbox mode never applies chance-based buffs: `setSandboxMode(true)` sets `buffChanceModifier = -1` (Battle.js:1986-1991) and the deterministic meter is skipped in sandbox (Battle.js:1401), so the roll can never pass (Battle.js:1390, 1412). 100% buffs still apply. Scripted oracle cases therefore exclude Pokémon with chance-buff charged moves; the meter is covered by the default-policy oracle instead.
- Engine oracle (Task 9): the harness generalises the spike (`scripts/oracle/pvpokeHarness.cjs`); fast-only uses `Pokemon.farmEnergy = true`, scripted uses `setSandboxMode(true)` + `setActions`. Fixture `tests/fixtures/engine-oracle.json`: 820 fast-only round-robin pairs over the top 40 supported meta species and 400 seeded random scripted cases, all matching ratings and HP exactly.
- Move metadata (Task 10): in simulate mode `Pokemon.resetMoves` runs only at `Battle.start` (Battle.js:238-245, Pokemon.js:1939), with native buffs. After it every active charged move's `dpe` is plain start-of-battle `damage / energy` (Pokemon.js:842-846), overwriting `initializeMove`'s buff-adjusted DPE, which is used only inside the ordering clauses (Pokemon.js:780-811). Nothing recomputes `dpe` during the battle, so `PokeView.dpeOf` returns start damage / energy, not the buff-adjusted value.
- The Zap Cannon Registeel clause (Pokemon.js:778-790) permanently rewrites that Pokémon's Focus Blast to `buffs [0,0]`, `buffTarget "self"`, `selfDebuffing true` (with `buffApplyChance` left undefined). The port returns a rewritten copy in `PokeView.chargedMoves`/`activeChargedMoves` (chance `NaN` so every comparison is false, as with `undefined`); `Combatant.chargedMoves` stays untouched, which is safe for the engine because `[0,0]` changes no stages.
- The Obstruct clause after the best-move loop (Pokemon.js:869-872) is reachable: e.g. Obstagoon Cross Chop/Obstruct vs Azumarill, where Cross Chop overtakes Obstruct inside the loop and the clause restores Obstruct.
- `ActionLogic.wouldShield` (ActionLogic.js:1154-1262) applies the move's `buffs` pair to the attacker when `buffs[0] > 0`, otherwise to the defender, whatever `buffTarget` says (Superpower's self `[-1,-1]` lowers the defender in the estimate; Obstruct's `[0,1]` raises the defender's defense). Its per-move "affordable" check `attacker.energy + move.energy >= move.energy` is always true. It writes `move.damage` (ActionLogic.js:1159); `wouldShield` returns that value as `damage` so Task 11 can mirror the write if the oracle needs it.
- Decision oracle (Task 10): harness probes `moveMeta`, `shieldTrace` (wraps `Battle.useMove` and `ActionLogic.wouldShield` during a default simulation) and `shieldAt` (runs PvPoke's own `Battle.useMove` from a hand-built state). `npm run gen-decision-oracle` writes `tests/fixtures/move-meta-oracle.json` (820 meta pairs, both sides) and `tests/fixtures/shield-oracle.json` (11,831 shield decisions over 780 pairs × 7 shield/bait setups); the port matches all of them.
- decideAction (Task 11) writes `move.damage` on move objects: ActionLogic.js:320 (own charged moves) and 336 (opponent's), and through `wouldShield`'s 1159 at 411, 884, 988 (own) and 969 (opponent's best move). The value is the damage at current buffs, and it **persists**. Later decisions and Battle.useMove's shield logic read it, so it matters whenever buffs changed after a move's last use. PvPoke also runs decideAction for both sides in index order: side 1 sees side 0's writes from the same turn. It runs decideAction on the turn after a charged move too, then discards the action (Battle.js:330-337), and those writes still land. Protocol rule 3 is applied: `Policy.chooseAction` returns `{ action, lastDamageUpdates }`. `runMatchup` consults each side whose cooldown is 0 in order and applies the updates with `withLastDamage` before the next side decides. It uses the action only when `canAct` holds. Without this, 5 of 9,360 top-40 default-mode matchups diverge, for example Tinkaton vs Shadow Snorlax 2-2 (787 vs 719). With it, all 9,360 and all 48,060 top-90 matchups match exactly.
- decideAction's DP (ActionLogic.js:439-803) quirks reproduced by the port:
  - `BattleState` has no `hp` or `shields` fields, so every dominance test on `DPQueue[i].hp` and `.shields` (518, 639, 687, 736, 782) is false and every state is inserted.
  - Farm-down states read the nonexistent `currState.opponentShields` (515, 528). They have 0 opponent HP, so they are never expanded.
  - The empty-queue branches at 632, 680, 729 and 775 are unreachable, because the farm-down state is always inserted first; 632 would use a stale hoisted `newEnergy`.
  - The attack-buff cap in the DP is a hard-coded ±4.
  - `changeTTKChance` is forced to 0 (560), so every state has chance 1. The DP stops at its first knockout state, and `stateList` holds at most one entry. The `turnsToKO` comparison (817) is therefore unreachable, and `needsBoost` is never set.
- decideAction reads `move.dpe` as start-of-battle damage / energy (`PokeView.dpeOf`) but reads `move.damage` from the live value (`SideState.lastDamage` plus the writes above). The dpe-ratio check at 881 uses `damage / energy`, not `dpe`. The Melmetal-vs-Cresselia special case (502-506) compares `speciesName`, so it never fires for shadow forms.
- CLI (Task 13): `PvPokeLikePolicy` holds no per-side state, so the CLI passes one instance for both sides and its `trace` interleaves both sides' decisions in turn order (each line is prefixed `turn N side S`). `--trace` is rejected with `greedy`/`fast`, which record nothing. The `--ivs` flag in §8 is not implemented; combatants always use the species' `defaultIVs.cp1500`.
- IV ranking (final review; `src/stats/ivRank.ts`, PvPoke Pokemon.js:466-608):
  - Iteration is hp, then def, then atk, each from 15 down to the floor. The stat product is computed as `hp * atk * def`, and the sort is stable with ties at 0. Float rounding of the product decides near-ties, so both the order and the multiplication order matter. For example, PvPoke's Medicham #1 is 5/15/15, while `atk*def*hp` in atk-def-hp order gives 5/15/14.
  - The ranking HP is `floor(cpm * (baseHp + hpIv))`, without the battle rule's minimum of 10 and without Shedinja's fixed 10. `IvRankEntry` reports these ranking stats.
  - Default floor, applied in PvPoke's order with later rules winning: 0; 1 for `legendary`/`ultrabeast` without `wildlegendary`; 6 for a shadow `legendary`/`ultrabeast` (even if `wildlegendary`); 10 for `untradeable`; 2 if the equipped charged moves include RETURN. The Return rule depends on the equipped moves, not the species, so `rankIvs` takes `chargedMoveIds`. PvPoke's `initialize()` equips the first two charged moves of the alphabetically sorted pool, and that pool includes RETURN for `shadoweligible` species whose `level25CP` is at or under the cap. So, for example, Ivysaur ranks with floor 2 by default in PvPoke.
  - Explicit floor: PvPoke's `ivFloor` argument is applied only when truthy, and untradeable and Return still override it. In `rankIvs`, an explicit `ivFloor` (including 0) is used as given. This is a deliberate API divergence; the default path (no `ivFloor`) is PvPoke's.
  - Level bounds: the search starts at the species' gamemaster `levelFloor` (39 species, e.g. Giratina Origin 15, Tapu Fini 20, Shadow Heatran 8; default 1) and runs up to the level cap. Levels below `levelFloor` are never used. When the cap is 500 or less (Little Cup), PvPoke ignores `levelFloor` and starts at level 1. Species with no combination under the cap get an empty list from PvPoke, for example Darkrai, Shadow Darkrai, Volcarona, Keldeo, Zygarde Complete, Eternatus and Mega Mewtwo X/Y at 1500. `rankIvs` throws `StatsError` for them instead (§9).
  - PvPoke's `megaLevel == 4` (`supermega`) level cap of 52 is not modelled. It made no difference in the sweep below.
  - Verification: the `ivCombinations` harness probe was run over all 1,751 gamemaster species at caps 500, 1500 and 2500, with PvPoke's default equipped moves passed through. The full order and levels match for 1751/1751 at each cap. `tests/fixtures/iv-rank-oracle.json` (`npm run gen-iv-oracle`) locks in 25 cases covering every rule.
- State shape and 3v3 (final review, deliberately deferred): `BattleState` has one `Combatant` and one `SideState` per side. It has no team array, active index or switch timer, which falls short of §4.2. This sub-project only needs 1v1, and none of the 1v1 parity work depends on the missing fields. When switching arrives, the following must change:
  - `combatants`/`sides` become per-side teams with an active index and per-member HP, energy, buffs, buff meters and lastDamage.
  - A switch timer and a switch `Action` are added, with PvPoke's switch and faint-replacement timing.
  - `createBattle` takes teams.
  - `Policy` gains a switch decision.
  - `src/policy/pvpoke/view.ts` must stop assuming `Pokemon.resetMoves` runs only at battle start. In PvPoke's emulate (team) mode, `Battle.setNewPokemon` (Battle.js:111-113) also runs it for both Pokémon whenever one enters, so move ordering, `dpe` and the Registeel clause must be recomputed per entry and keyed by the active member.
  - `battleRating` must be generalised for team results.
