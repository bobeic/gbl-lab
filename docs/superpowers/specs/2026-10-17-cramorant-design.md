# Cramorant (Gulp Missile) — Design Spec

Date: 2026-10-17
Status: Approved
Builds on: `2026-10-15-battle-engine-design.md` (engine spec) and `2026-10-15-form-changes-design.md` (form-changes spec, whose form machinery this reuses)

## 1. Context and intent

### What the user wants (stated)
- Support Cramorant. It is PvPoke's #4 Great League Pokémon and on the user's own roster, but the engine rejects it, so it can't be added to the companion's roster, is "Can't simulate" as an opponent, and is missing from the matrix and the team builder.
- "Go off of what PvPoke says": match PvPoke's simulator exactly, as was done for Mimikyu and Morpeko.

### Decisions
- Parity target is PvPoke at the pinned commit (`data/UPSTREAM`), default simulate mode. No corrections under ADR 0003: we know of no place where PvPoke's Cramorant rules differ from the game. (Builder's call to add one to `docs/known-game-differences.md` if found while porting.)
- PvPoke's Cramorant decision logic is ported as written, including two `move.moveID` typos. At ActionLogic.js:1255 (`move.moveID == "SURF"`) the comparison is always false, so the rule only ever applies to Dive. At ActionLogic.js:368 (`move.moveId != "DIVE" && move.moveID != "SURF"`) the second half is always true, so `nonGulpMove` is the first active charged move that isn't Dive, which can be Surf itself (then `gulpMove` and `nonGulpMove` are the same move). ADR 0003 covers game rules, not decision quality, and ADR 0002 says decision logic follows PvPoke. Each typo gets a comment citing PvPoke file:line.
- Aegislash stays unsupported (its forms have different stats; separate work).

### Success criteria
- `buildCombatant` accepts Cramorant (`cramorant`, ranking moveset Peck / Dive / Fly, and any legal moveset).
- Cramorant (ranking moveset) matchups match PvPoke exactly at all nine shield combinations (§4).
- No regressions: every existing oracle fixture still matches exactly.
- The matrix includes Cramorant (no longer in `excluded`); the companion accepts it on the roster and simulates it as an opponent.

## 2. Mechanics being modelled (PvPoke source, pinned commit)

### 2.1 Forms
- `cramorant` (start, released). Its `formChange`: trigger `charged_move`, `moveIDs: ["DIVE","SURF"]`, `alternativeFormId: "variable"`.
- `cramorant_gulping` and `cramorant_gorging` (battle-only, `released: false`). Same types (flying/water), stats and moves as `cramorant`. Their `formChange`: trigger `charged_move`, `moveId: GULP_MISSILE_ARROKUDA` / `GULP_MISSILE_PIKACHU`, `alternativeFormId: "cramorant"`.

### 2.2 Catching prey (Battle.js:1547-1580)
After Cramorant uses Dive or Surf (shielded or not) in its `cramorant` form, it changes form. `variable` resolves by HP *after* the move resolved: `attacker.hp / attacker.stats.hp > 0.5` → `cramorant_gulping`, else `cramorant_gorging`. While gulping or gorging, Cramorant's active rule is that form's own (`changeForm` copies the new form's `formChange`, Pokemon.js:2482-2484), which only matches its Gulp Missile move. So Dive or Surf thrown with prey does **not** change the form. Only Gulp Missile reverts it to `cramorant`, and the next Dive/Surf resolves again.

### 2.3 Gulp Missile (Battle.js:1583-1617)
When Cramorant is the defender, is gulping or gorging, and is hit by a charged move that was **not shielded** and is **not tagged `instant`**, PvPoke inserts a Cramorant charged action into the current turn's action list right after the move being resolved (`turnActions.splice(actionIndex, 0, action)`), with `priority: defender.priority`:
- Gulping → `GULP_MISSILE_ARROKUDA`: water, `damageMethod: percentMaxHP`, power 15, energy 0, buffs `[0,-1]` on the opponent at chance 1 (−1 Defense). Tags `instant`, `ignoresFaint`.
- Gorging → `GULP_MISSILE_PIKACHU`: same, buffs `[-2,0]` on the opponent (−2 Attack).
- `instant`: can't be shielded (Battle.js:1075).
- `ignoresFaint`: fires even if the hit that triggered it knocked Cramorant out (Battle.js:472).
- Using it changes Cramorant back to `cramorant` via the gulping/gorging form's own `charged_move` rule (§2.2's code path, fixed `alternativeFormId`).

### 2.4 percentMaxHP damage (DamageCalculator.js:71, :107)
`damage = floor((power / 100) × defender.stats.hp) + 1`: a share of the **target's** max HP, ignoring stats, STAB, type effectiveness and buffs.

### 2.5 Charged-move priority (Battle.js:255-258)
`usePriority` is true when attack stats differ **or both sides are Cramorant**.

### 2.6 Decision logic
- ActionLogic.js:365-386: in its `cramorant` form, with energy for Dive/Surf, throw it right away to catch prey if the other move isn't meaningfully better (`opponent.hp > nonGulpMove.damage * 1.3 && nonGulpMove.dpe / gulpMove.dpe < 1.5`). Note the `moveID` typo at :368 (§1).
- ActionLogic.js:976: the "stack energy" branch also fires when the *opponent* is gulping or gorging (so the AI saves up rather than feeding Gulp Missile chip hits).
- Shield logic, both the policy (ActionLogic.js:1244-1257) and Battle.js's non-sandbox override (Battle.js:1127-1137):
  - don't shield as gulping/gorging Cramorant when `damage * 2.2 < defender.hp` (let weak moves through to trigger Gulp Missile);
  - don't shield Cramorant's moves when `damage / defender.hp < .33`;
  - ActionLogic.js:1255 (policy only): don't shield Cramorant's Dive (Surf, per the typo, never matches) when it would KO anyway.
  - These replace the two "skipped" comments in `src/policy/pvpoke/shield.ts` (lines 89 and 147). The other two skip markers, `src/policy/pvpoke/decide.ts:442` (ActionLogic.js:365-386) and `:636` (ActionLogic.js:976's Cramorant condition), are replaced by the first two bullets above.

## 3. Engine changes

### 3.1 Combatant (`src/engine/combatant.ts`)
- Accept `percentMaxHP` damage method only for moves tagged `instant` that a form rule can fire (Gulp Missile); any other `percentMaxHP` move stays unsupported. (Builder's call to generalise if simpler and still safe.)
- Accept trigger `charged_move` with `alternativeFormId: 'variable'` for `cramorant` only; build both reachable forms (`cramorant_gulping`, `cramorant_gorging`) into `forms`. Any other `variable` species stays `UnsupportedPokemonError`.
- Gulp Missile moves are not in any form's `chargedMoves`; the turn logic looks them up by id from the form rule's `moveId`, so `Combatant` needs access to them (e.g. a per-form `counterMove` resolved at build time). Builder's call on representation.

### 3.2 Damage (`src/engine/damage.ts` / `moveDamage`)
- `percentMaxHP`: `floor((power / 100) × defender.stats.hp) + 1`, mirroring PvPoke's operand order.

### 3.3 Turn (`src/engine/turn.ts`)
- §2.2: resolve `variable` by HP ratio after the attacking move (and its damage to the attacker, if any) is applied, then reuse the existing attacker form-change step.
- §2.3: after the attacker's charged move resolves — after the attacker form-change step and before the defender form-change step, matching PvPoke's order (Battle.js:1547, :1583, :1621), if the defender is gulping/gorging and the move was unshielded and not `instant`, enqueue a defender charged action for the counter move to run next in this turn. It costs 0 energy, can't be shielded, ignores faint, applies its buffs to the target, and triggers the form change back to `cramorant`.
- §2.5: `usePriority` also true for a Cramorant mirror.
- Events: Gulp Missile is an ordinary `charged` event (side = Cramorant, `moveId` = the Gulp Missile id, `shielded: false`). Form changes emit the existing `formChange` event.

### 3.4 Policy (`src/policy/pvpoke`)
Port §2.6, citing PvPoke file:line, including the typos.

## 4. Validation
- **Oracle parity for the ranking moveset only** (Peck / Dive / Fly; decided by the user). The matrix, companion and team builder all use the ranking moveset. The Surf trigger and the two typo ports are still ported as written so Surf movesets simulate, but they get unit tests only, no oracle cases: neither typo changes behaviour with Dive + Fly.
- **Cramorant oracle fixture** (extend `form-change-oracle.json` or add `cramorant-oracle.json`, builder's call): all generated with the existing harness (`scripts/oracle/`), exact rating match required.
  - The ranking moveset (Peck / Dive / Fly) vs the top 100 of the oracle meta at all nine shield combinations, plus a Cramorant mirror.
- **Regenerating the existing fixtures** (decided: regenerate them all). Cramorant is #4, so accepting it in `metaSpecies` reshuffles every fixture built from the meta list: `engine-oracle.json` (top-40 fast-only round robin and the seeded scripted cases), `move-meta-oracle.json` and `shield-oracle.json` (gen-decision-oracle.ts:10), the opponent lists in `form-change-oracle.json`, and `oracle-gl.json` (`tests/matrixMeta.test.ts:68-73` requires it to match `metaSpecies(gd, 100)`). The regression evidence is two-part: (1) before the meta change, the engine with Cramorant support still passes every **current** fixture unchanged; (2) after regenerating, every regenerated fixture matches exactly.
- **Unit tests:** form resolves by HP (gulping above half, gorging at or below); shielded Dive still catches prey; unshielded hit while gulping fires Arrokuda for 15% of the opponent's max HP + 1 with −1 Defense and reverts the form; gorging → Pikachu −2 Attack; shielded hit and `instant` moves don't trigger it; it fires even when the triggering hit KOs Cramorant; mirror uses priority; shield-logic branches fire at their thresholds.
- **Matrix:** rerun `npm run gen-matrix`; `excluded` loses Cramorant; `tests/matrixCommitted.test.ts` passes with the regenerated file.

## 5. Knock-on changes
- Companion: Cramorant can be added on the Team tab and is simulated as an opponent. No app code change expected beyond what the engine provides; verify in the app. `tests/app/TeamScreen.test.tsx:39-53` uses Cramorant as its unsupported example and must switch to another unsupported species (e.g. Aegislash).
- README: remove Cramorant from the unsupported lists and the "e.g. Cramorant" examples; update oracle numbers.
- `docs/known-game-differences.md`: add anything found.
- Shield and move advice in the companion work unchanged. Gulp Missile isn't a move the opponent "throws" by choice, so it doesn't appear in the per-move shield list.

## 6. Error handling
- A `variable` form change on a species other than Cramorant, or a gulp form whose counter move is missing from the gamemaster: `UnsupportedPokemonError` / `GameDataError` at build time, as for other form errors.

## 7. Out of scope
Aegislash, other `percentMaxHP` moves, megas, 3v3 switching (`resetOnSwitch`).
