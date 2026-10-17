# Cramorant (Gulp Missile) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The engine simulates Cramorant exactly as PvPoke does, so it can go on the companion roster, be simulated as an opponent, and appear in the matrix.

**Architecture:** Reuse the form machinery built for Mimikyu and Morpeko. `buildForms` learns to branch (`variable` → gulping and gorging). Each prey form carries its Gulp Missile move. `resolveTurn` resolves `variable` by HP and splices a Gulp Missile action into the current turn after an unshielded hit. The PvPoke policy gets the four Cramorant branches it currently skips.

**Tech Stack:** TypeScript, Vitest, the PvPoke oracle harness (`scripts/oracle/`).

**Spec:** `docs/superpowers/specs/2026-10-17-cramorant-design.md` (read it with this plan: the PvPoke file:line references live there).

## Global Constraints

- Parity target: PvPoke at `data/UPSTREAM` (`a23fb293300077028a65da534c73bd6367b7ef9d`), simulate mode. No ADR 0003 corrections.
- Port PvPoke's `moveID` typos as written (ActionLogic.js:368, :1255), each with a comment citing file:line.
- Oracle parity is required for the ranking moveset (Peck / Dive / Fly) only. Surf movesets get unit tests.
- Every new branch in engine or policy code carries a `// PvPoke File.js:line` comment, as the surrounding code does.
- Aegislash stays unsupported. It becomes the "unsupported" example in tests that used Cramorant.

## Review Focus

1. **Gulp Missile when the triggering hit KOs Cramorant.** It still fires (`ignoresFaint`) and damages the attacker. Pinned in Task 1.
2. **Cramorant mirror.** `usePriority` is on, and a Gulp Missile is never countered by another Gulp Missile, because Gulp Missile is `instant`. Pinned in Task 1.
3. **Same-turn charged moves.** If both sides throw on the same turn, the Gulp Missile resolves between the two throws, because it is spliced right after the move that hit. Pinned in Task 1.
4. **Companion shield advice against a Cramorant opponent.** `shieldAdvice` looks at the first charged event from side 1. That event is never a Gulp Missile, because prey has to be caught by a throw first. Pinned in Task 4.
5. **Dive while already holding prey.** The form doesn't change and there is no `formChange` event. Pinned in Task 1.

---

### Task 1: Engine — forms, Gulp Missile, percentMaxHP, mirror priority

**Files:**
- Modify: `src/engine/combatant.ts` (`Form`, `isSupportedRule`, `buildForms`, `moveDamage`)
- Modify: `src/engine/state.ts` (`QueuedAction`, `createBattle` `usePriority`)
- Modify: `src/engine/turn.ts` (`resolveTurn` charged branch and action loop)
- Test: `tests/formChange.test.ts` (new `describe('Cramorant')`), `tests/combatant.test.ts`
- Modify (unsupported example → Aegislash): `tests/combatant.test.ts:118-121`, `tests/matrixMeta.test.ts:27-40`, `tests/teamMatrix.test.ts:64`, `tests/companionOpponent.test.ts:21-28`, `tests/app/BattleScreen.test.tsx` ("cannot simulate" test), `tests/app/TeamScreen.test.tsx:39-53`

**Interfaces:**
- Produces:
  - `Form.gulpMissile: ChargedMove | null`. This is the move the form fires when hit: `GULP_MISSILE_ARROKUDA` on `cramorant_gulping`, `GULP_MISSILE_PIKACHU` on `cramorant_gorging`, `null` elsewhere.
  - `QueuedAction.extraMove?: ChargedMove`. When set, the charged action uses this move instead of `chargedMoves[chargedIndex]` (with `chargedIndex: -1`), like PvPoke's string `action.value` from `extraChargedMovePool`.
  - `moveDamage` returns `Math.floor((move.power / 100) * defender.stats.hp) + 1` for `damageMethod === 'percentMaxHP'`.
  - Charged events for Gulp Missile: `{ kind: 'charged', side: <cramorant>, moveId: 'GULP_MISSILE_…', damage, shielded: false }`.

- [ ] **Step 1: Rebase onto main.** PR #4 is merged. Run `git fetch && git rebase origin/main`, then `npm test`. Expected: all green, Cramorant still rejected.

- [ ] **Step 2: Write the failing tests** in `tests/formChange.test.ts`. Use the file's own `battle`, `patch` and `turn` helpers. Set up `cram = { speciesId: 'cramorant', fastMoveId: 'PECK', chargedMoveIds: ['DIVE', 'FLY'] }`, so Dive is slot 0.
  - `catches Arrokuda after Dive above half HP`: `battle(cram, azu, [0,0], [100,0])`, then `turn([charged(0), null])`. The side 0 `formId` is `'cramorant_gulping'`. The last non-fast event is `{ kind: 'formChange', side: 0, from: 'cramorant', to: 'cramorant_gulping' }`.
  - `catches Pikachu at exactly half HP or less`: patch side 0 `hp: Math.floor(stats.hp / 2)`. The form is `'cramorant_gorging'`.
  - `catches prey even when Dive is shielded`: shields `[0,1]`, decider `always`. The form is gulping.
  - `Fly does not change form`: `turn([charged(1), null])`. The form is `'cramorant'` and there is no formChange event.
  - `Dive while holding prey keeps the form`: patch `formId: 'cramorant_gulping'`, then throw Dive. The form is still gulping and there is no formChange event.
  - `an unshielded hit while gulping fires Arrokuda`:
    - Setup: `battle(cram, azu, [0,1], [0,100])`, patch side 0 `formId: 'cramorant_gulping'`, `turn([null, charged(0)], (_s, d) => d === 1)`.
    - Non-fast events are, in order:
      1. Azumarill's `ICE_BEAM` charged event.
      2. `{ kind:'charged', side:0, moveId:'GULP_MISSILE_ARROKUDA', damage: Math.floor(0.15 * azuHp) + 1, shielded:false }`.
      3. `{ kind:'buff', side:1, stages:[0,-1], sourceMoveId:'GULP_MISSILE_ARROKUDA' }`.
      4. `{ kind:'formChange', side:0, from:'cramorant_gulping', to:'cramorant' }`.
    - Azumarill still has 1 shield (instant moves can't be shielded). Cramorant's energy is unchanged.
  - `gorging fires Pikachu with -2 Attack`: the same setup with `cramorant_gorging`. The buff is `[-2,0]` and the form goes back to `'cramorant'`.
  - `a shielded hit or a fast move does not trigger it`: no `GULP_MISSILE_*` event, and the form stays gulping.
  - `fires even when the hit knocks Cramorant out`: patch side 0 `hp: 1`. The events include the Gulp Missile charged event, and Azumarill's HP drops by its damage. Side 0 has a `faint` event.
  - `resolves between two same-turn charged moves`:
    - Setup: side 0 is a gulping Cramorant with 100 energy, side 1 is Azumarill with 100 energy, both throw.
    - Assert the order of charged events matches turn priority, with Gulp Missile immediately after the move that hit Cramorant.
  - `a Cramorant mirror uses charged-move priority`: `battle(cram, cram, …).usePriority` is `true`.
  - `a Gulp Missile is not answered by the opponent's Gulp Missile`:
    - Setup: a mirror, both gulping, side 0 throws Fly unshielded.
    - Exactly one `GULP_MISSILE_*` event, from side 1.
  - `a Surf moveset catches prey with Surf`: `{ fastMoveId: 'WATER_GUN', chargedMoveIds: ['SURF', 'HYDRO_PUMP'] }`. Surf changes the form.

  In `tests/combatant.test.ts`, replace `still rejects Cramorant`:
  - `builds Cramorant with both prey forms`: the `forms` keys are `['cramorant', 'cramorant_gulping', 'cramorant_gorging']` (any order; compare sorted). `formOf(c, 'cramorant_gulping').gulpMissile?.id` is `'GULP_MISSILE_ARROKUDA'`, the gorging form gives `'GULP_MISSILE_PIKACHU'`, and the `cramorant` form gives `null`.
  - `still rejects Aegislash, naming its rule`: building `{ speciesId: 'aegislash_shield', fastMoveId: 'AEGISLASH_CHARGE_PSYCHO_CUT', chargedMoveIds: ['SHADOW_BALL', 'GYRO_BALL'] }` throws `UnsupportedPokemonError` matching `/aegislash_shield: form change \(activate_charged/`.

- [ ] **Step 3: Run them.** `npx vitest run tests/formChange.test.ts tests/combatant.test.ts`. Expected: the new tests FAIL, and Cramorant throws `UnsupportedPokemonError`.

- [ ] **Step 4: Implement.**
  - **`combatant.ts`:**
    - Add `const GULP_MISSILES: Readonly<Record<string, string>> = { cramorant_gulping: 'GULP_MISSILE_ARROKUDA', cramorant_gorging: 'GULP_MISSILE_PIKACHU' }`. It is hard-coded like PvPoke Battle.js:1583-1617, and sits next to `FORM_MOVE_SWAPS`.
    - Rewrite `isSupportedRule(rule, startId)`:
      - Keep the existing Morpeko and Mimikyu cases.
      - Add `trigger === 'charged_move' && alternativeFormId === 'variable' && moveIds !== null && startId === 'cramorant'`.
      - Add `trigger === 'charged_move' && moveId !== 'ANY' && moveId !== null && moveIds === null && alternativeFormId === 'cramorant'`.
    - Turn `buildForms` into a worklist. The `variable` target expands to `['cramorant_gulping', 'cramorant_gorging']`; each other rule has one target. Each next form's rule is `next.formChange ?? rule`, as now.
    - Set `gulpMissile` from `GULP_MISSILES`. If the gamemaster lacks that charged move, throw `GameDataError`.
    - Add the `percentMaxHP` branch at the top of `moveDamage` (cite DamageCalculator.js:71). `assertSupported` stays as is: Gulp Missile is never equipped.
  - **`state.ts`:**
    - `usePriority` becomes: attacks differ `|| (both species ids are 'cramorant')` (Battle.js:255-258).
    - Add `extraMove?: ChargedMove` to `QueuedAction`.
  - **`turn.ts`:**
    - Iterate `turnActions` by index, so a spliced action runs next.
    - In the charged branch, `const move = act.extraMove ?? attacker.chargedMoves[idx]!`. Skip the `lastDamage` and `buffMeters` writes when `idx < 0`.
    - Attacker form change: match the rule on `moveId === 'ANY' || moveId === move.id || moveIds?.includes(move.id)`. When the target is `'variable'` (species `cramorant`), use `sides[me].hp / combatants[me].stats.hp > 0.5 ? 'cramorant_gulping' : 'cramorant_gorging'` (Battle.js:1547-1575).
    - Then, before the existing defender form-change step: if `formOf(combatants[op], sides[op].formId).gulpMissile` is set and the move was unshielded and not `instant`, splice `{ type: 'charged', actor: op, turn: state.turn, chargedIndex: -1, priority: 0, extraMove }` at `i + 1` (Battle.js:1583-1617).

- [ ] **Step 5: Run them.** Expected: `npx vitest run tests/formChange.test.ts tests/combatant.test.ts` PASS.

- [ ] **Step 6: Swap the remaining "unsupported" examples to Aegislash.** Keep each test's intent.
  - `matrixMeta.test.ts:27-33` uses `row('aegislash_shield')`.
  - Rewrite `:35-40` with `const i = rankings.findIndex((r) => r.speciesId === 'aegislash_shield')`. Assert `buildMeta(gd, rankings, 3).excluded` is `[]`, and that `buildMeta(gd, rankings, i + 1).excluded` ids contain `'aegislash_shield'`.
  - `teamMatrix.test.ts:64` uses `fromRankings('aegislash_shield'), /aegislash/`.
  - `companionOpponent.test.ts` uses `opponentCard(app, 'aegislash_shield')`. Its fast id is `'AEGISLASH_CHARGE_PSYCHO_CUT'`.
  - `BattleScreen.test.tsx`: search `'aegis'`, click the button the search shows for it, and expect `"Can't simulate"` plus that name.
  - `TeamScreen.test.tsx:39-53`: the same, and the import JSON uses the Aegislash moveset above.

- [ ] **Step 7: First half of the regression evidence.** Run `npm test`. Expected:
  - Every current oracle fixture test passes **unchanged**: `engineOracle`, `oracle.acceptance`, `formChange.oracle`, `pvpokeShield`, `pvpokeMoveMeta`, `pvpokeDecide`.
  - Only these fail: `matrixMeta.test.ts` "still selects exactly the top-100 set…" and `matrixCommitted.test.ts` "holds the current 150-Pokémon meta" plus its sample. They fail because Cramorant now enters the meta. Task 3 and Task 4 regenerate those fixtures.
  - Paste the summary into the commit message body.

- [ ] **Step 8: Commit.** `git commit -m "feat(engine): Cramorant forms and Gulp Missile (PvPoke parity)"`

### Task 2: Policy — the four Cramorant branches

**Files:**
- Modify: `src/policy/pvpoke/decide.ts:442` (ActionLogic.js:365-386) and `:636` (ActionLogic.js:976)
- Modify: `src/policy/pvpoke/shield.ts:89` (ActionLogic.js:1244-1257) and `:147` (Battle.js:1127-1137). Keep the Aegislash parts of both comments as "skipped".
- Test: `tests/pvpokeDecide.test.ts`, `tests/pvpokeShield.test.ts`

**Interfaces:**
- Consumes:
  - `PokeView.form.id`: the prey form check is `form.id === 'cramorant_gulping' || form.id === 'cramorant_gorging'`.
  - `PokeView.c.species.id === 'cramorant'`: PvPoke `speciesId`, which is unchanged across forms.
  - `damageOf` and `dpeOf`, as PvPoke `move.damage` and `move.dpe`.

- [ ] **Step 1: Write the failing tests.**
  - **`pvpokeDecide.test.ts`:** follow the file's traced-decision pattern (`records PvPoke logDecision messages only when tracing`).
    - `Cramorant throws Dive as soon as it can to catch prey`: Cramorant (Peck/Dive/Fly) at Dive energy vs a full-HP Azumarill. The decision is `{ type: 'charged', index: <Dive slot> }`, and the trace contains `'to trigger form change as soon as possible'`.
    - `but not once it holds prey`: the same position with `formId: 'cramorant_gulping'`. The trace lacks that message.
    - `a Surf/Hydro Pump Cramorant compares Surf with itself (PvPoke ActionLogic.js:368 typo)`: Water Gun/Surf/Hydro Pump at Surf energy. The trace contains the message and the decision is Surf.
  - **`pvpokeShield.test.ts`**, against `wouldShieldViews` / `pvpokeShield`:
    - `a gulping Cramorant lets a weak move through`: defender gulping with `damage * 2.2 < hp`. `wouldShield.value` is `false`.
    - `a move from Cramorant under a third of HP is not shielded`: `wouldShield.value` is `false`.
    - `Cramorant's Dive is not shielded when it would KO anyway`: `wouldShield.value` is `false`.
    - In `pvpokeShield`, the Battle.js override defers to `shieldDecision.value` in the gulping case.
    - For each case, first assert the same position **without** the Cramorant condition shields. That proves the branch is what flips it.

- [ ] **Step 2: Run them.** Expected: `npx vitest run tests/pvpokeDecide.test.ts tests/pvpokeShield.test.ts` FAIL.

- [ ] **Step 3: Implement.** Port the four branches line for line from the PvPoke lines above, at the skip markers.
  - `nonGulpMove` is `poke.activeChargedMoves.find((m) => m.id !== 'DIVE')`, with a comment quoting the original `move.moveID != "SURF"` typo.
  - The :1255 branch checks only `move.id === 'DIVE'`, again with a typo comment.
  - The early return uses `poke.indexOf(gulpMove)`.

- [ ] **Step 4: Run them.** Expected: the two files PASS, and the `npm test` result is the same as Task 1 Step 7 (only the two meta-list tests fail).

- [ ] **Step 5: Commit.** `git commit -m "feat(policy): PvPoke Cramorant decision and shield branches"`

### Task 3: Oracle — regenerate fixtures, add Cramorant cases

**Files:**
- Modify: `scripts/gen-oracle.ts` (form-change block), `scripts/oracle/meta.ts:10` (comment: drop Cramorant)
- Modify: `tests/formChange.oracle.test.ts` (counts and title)
- Regenerate: `tests/fixtures/engine-oracle.json`, `oracle-gl.json`, `form-change-oracle.json`, `move-meta-oracle.json`, `shield-oracle.json`

- [ ] **Step 1: Add the Cramorant cases to the fixture builder.**
  - In `gen-oracle.ts`, add `...formChangeCases(pvpoke, top100, 'cramorant', top100)` to `corrected`. Cramorant is in `top100`, so this includes the mirror.
  - Add `...formChangeCases(unmodified, top100, 'cramorant', top100.filter((m) => m.speciesId !== 'morpeko_full_belly'))` to `unmodified`.
  - Update the test: `corrected.length` is `3 * 100 * 9`, `unmodified.length` is `2 * 99 * 9`, and the title names Cramorant.

- [ ] **Step 2: Regenerate.** `npm run gen-oracle && npm run gen-decision-oracle`. Expected: no `excluded cramorant` line on stderr, and fixture counts are printed.

- [ ] **Step 3: Second half of the regression evidence.**
  - Run `npx vitest run tests/engineOracle.test.ts tests/oracle.acceptance.test.ts tests/formChange.oracle.test.ts tests/pvpokeShield.test.ts tests/pvpokeMoveMeta.test.ts tests/pvpokeDecide.test.ts tests/matrixMeta.test.ts`. Expected: all PASS, with exact matches in every case.
  - **If any Cramorant case mismatches:** debug with `npm run sim` traces against the harness (superpowers:systematic-debugging). Don't loosen a test.

- [ ] **Step 4: Commit** the fixtures and script changes: `git commit -m "test(oracle): regenerate fixtures with Cramorant in the meta; Cramorant parity cases"`

### Task 4: Matrix, companion check, docs

**Files:**
- Regenerate: `data/matrix-1500.json`, `reports/matrix-report.md` (whatever `gen-matrix` writes)
- Modify: `README.md:31,74,77`, `docs/known-game-differences.md:12` (M2: Aegislash and other stat-changing or other-trigger form changers)
- Test: `tests/companionShield.test.ts`

- [ ] **Step 1: Write the failing test** (Review Focus 4) in `companionShield.test.ts`. `shieldAdvice(gd, <Azumarill>, <Cramorant Peck/Dive/Fly>, [1, 1])` returns one entry per Cramorant charged move. Its `moveId`s are a subset of `['DIVE', 'FLY']`, so no `GULP_MISSILE_*` appears.

- [ ] **Step 2: Run it.** Expected: `npx vitest run tests/companionShield.test.ts` PASS. Task 1 already makes it true, so this is a guard and no code changes. If it fails, fix `shieldAdvice` to skip `GULP_MISSILE_*` events when it looks for the first side-1 charged event.

- [ ] **Step 3: Regenerate the matrix.** `npm run gen-matrix`. Expected: `excluded` no longer lists `cramorant`. Then `npx vitest run tests/matrixCommitted.test.ts` PASS.

- [ ] **Step 4: Update the docs.**
  - **README:** the example of an opponent that can't be simulated becomes Aegislash. Remove Cramorant from the unsupported and meta-gap lists, and update any oracle case counts quoted there.
  - **`known-game-differences.md`:** reword M2, and add a row only if porting found a PvPoke-vs-game difference.

- [ ] **Step 5: Full verification.** Run `npm test && npm run typecheck && npm run build`. Expected: everything green. Then:
  - restart the dev server;
  - in the app, add Cramorant (Peck/Dive/Fly) on the Team tab, and pick Cramorant as an opponent on the Battle tab;
  - confirm ratings and shield advice show, not "Can't simulate".

- [ ] **Step 6: Commit.** `git commit -m "feat: Cramorant in the matrix and companion; docs"`
