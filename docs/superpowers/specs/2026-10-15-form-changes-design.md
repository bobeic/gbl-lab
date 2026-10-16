# Form Changes (Mimikyu, Morpeko) — Design Spec

Date: 2026-10-15
Status: Draft, awaiting review
Builds on: `2026-10-15-battle-engine-design.md` (the battle engine spec, "engine spec" below)

## 1. Context and intent

### What the user wants (stated)
- Support Mimikyu and Morpeko in the battle engine before starting meta rankings. Both are in the Great League meta (PvPoke rank #7 and #54), so rankings and team advice without them have holes.
- Model how the Pokémon actually behave in the game. Where PvPoke is wrong about the game, fix it on our side.
- Morpeko switches form on **every** charged move, as in the game.
- Mimikyu and its opponents use the same decision logic as every other Pokémon. No special "don't shield while disguised" rule: shielding to keep the disguise (and avoid its Defense drop) is a defensible choice.
- Leave out form changers that are too hard for now.

### Assumptions (agreed)
- Aegislash and Cramorant stay unsupported and keep throwing `UnsupportedPokemonError`.
- Battles remain 1v1. Switching behaviour (`resetOnSwitch`) is stored but not used until 3v3.

### Success criteria
- Mimikyu and Morpeko are accepted by `buildCombatant` and included in the oracle acceptance set.
- Every matchup involving them matches the oracle exactly at all shield settings (§6).
- No regressions: all existing tests pass; matchups not involving Morpeko still match unmodified PvPoke exactly.

## 2. In-game mechanics being modelled

Sources: PvPoke source (commit recorded in engine spec §10), Bulbapedia "Morpeko (GO)", Pokémon GO Hub "Mimikyu PvP Battle Mechanic Explained", PoGoMate "PvP gimmicks", Doctor PokeGoGo "Mimikyu".

### 2.1 Mimikyu — Disguise
- Mimikyu starts in its disguised form (`mimikyu`).
- The first charged move that hits it **unshielded** deals exactly 1 damage instead of its normal damage.
- It then becomes `mimikyu_busted`: same types and base stats, plus a −1 Defense stat stage added to its current stages (clamped like any buff).
- A shielded charged move leaves the disguise intact. Fast moves never interact with the disguise.
- Disguise breaks at most once per battle (`mimikyu_busted` has trigger `none`).
- Busted persists through a switch (`resetOnSwitch: false`) — relevant only for 3v3 later.

### 2.2 Morpeko — Hunger Switch
- Morpeko starts in Full Belly (`morpeko_full_belly`).
- After using **any** charged move (shielded or not), it switches form: Full Belly → Hangry → Full Belly → …
- Aura Wheel's type follows the form: `AURA_WHEEL_ELECTRIC` in Full Belly, `AURA_WHEEL_DARK` in Hangry, in the same move slot.
- Both forms have identical types (Electric/Dark) and base stats.
- Aura Wheel's +1 Attack (100%) comes from the move itself, not the form change. It is already modelled as a self-buff.
- Switching out resets to Full Belly (`resetOnSwitch: true`) — relevant only for 3v3 later.

### 2.3 Deliberate difference from PvPoke
PvPoke switches Morpeko to Hangry once and leaves it there: `morpeko_hangry` has no `formChange`, `changeForm` keeps the Full Belly rule whose target is already active, and the `toggle` type is never read. We correct this (ADR 0003, §3.2). This is the only deviation; Mimikyu matches PvPoke exactly.

## 3. Data and Pokémon setup

### 3.1 Loader (`src/data`)
- Replace `Species.hasFormChange: boolean` with `Species.formChange: FormChange | null`, a typed copy of PvPoke's block:
  `{ trigger: string; effect: string | null; alternativeFormId: string | null; resetOnSwitch: boolean }`. `trigger` keeps PvPoke's raw value so unsupported triggers can be named in errors.
- Add `Species.released: boolean` (PvPoke's `released`).

### 3.2 Corrections (`src/data/corrections.ts`, new)
- An explicit list of every known divergence between PvPoke's game data and the real game. Initial content: one entry giving `morpeko_hangry` the form change `{ trigger: 'charged_move', effect: null, alternativeFormId: 'morpeko_full_belly', resetOnSwitch: true }`.
- Applied by the loader after parsing.
- Exported in a form the oracle harness can apply to PvPoke's raw gamemaster (patching `formChange` on the named species), so engine and oracle use one source.
- ADR `docs/decisions/0003-correct-pvpoke-where-wrong.md`: PvPoke semantics remain the default (ADR 0002); a divergence is allowed only when PvPoke contradicts the real game, must be listed in `corrections.ts` (or, if not data, documented in the ADR), and must be patched identically in the oracle.

### 3.3 Combatant (`src/engine/combatant.ts`)
- New types:
  ```ts
  interface Form {
    readonly id: string;
    readonly types: readonly PokemonType[];
    readonly chargedMoves: readonly ChargedMove[]; // slot order, form-specific swaps applied
    readonly nativeStatBuffs: StatPair;
    readonly formChange: FormChange | null;
  }
  ```
  `Combatant` gains `types` (the start form's types; `moveDamage` reads `Combatant.types` instead of `species.types`), `startFormId: string` and `forms: ReadonlyMap<string, Form>`. Stats, IVs, level, CP and fast move stay on `Combatant` and are shared by all forms.
- `withForm(c, formId): Combatant` returns the combatant as it is in that form (types and charged moves from the form, everything else unchanged; the same object for the start form). The state helper `activeCombatant(state, side)` applies it to the side's `formId`; the engine and policy read combatants through it.
- `forms` holds every form reachable from the species by following `alternativeFormId`.
- Form-specific move swaps come from an explicit table mirroring PvPoke `Pokemon.changeForm` (Pokemon.js:2504-2511): entering `morpeko_full_belly` maps `AURA_WHEEL_DARK → AURA_WHEEL_ELECTRIC`; entering `morpeko_hangry` maps `AURA_WHEEL_ELECTRIC → AURA_WHEEL_DARK`. Moves not in the table are unchanged.
- `PvPoke formChange` replacement rule (Pokemon.js:2482-2484): a form with `formChange: null` inherits the previous form's rule. After corrections no reachable form for Mimikyu or Morpeko has a null rule, so `Form.formChange` is stored resolved and non-null for supported species.
- `assertSupported` accepts a species only if every reachable form:
  - has trigger `charged_move` (with `moveId` `ANY`), `charged_move_damage` with effect `protect`, or `none`; and
  - has the same base stats as the start form.
  Anything else throws `UnsupportedPokemonError` naming the species and trigger (covers Aegislash, Cramorant, `variable`, `activate_*`).
- Requesting a non-released alternative form directly (e.g. `morpeko_hangry`, `mimikyu_busted`) throws `GameDataError`: "`<id>` is a battle-only form; use `<start form>`". The start form is found by scanning for a released species whose form chain reaches it.

## 4. Battle state and turn logic

### 4.1 State (`src/engine/state.ts`)
- `SideState` gains:
  - `formId: string` — starts at `startFormId`.
  - `moveOrderBasis: readonly number[]` — per-slot charged-move damage as PvPoke's `resetMoves` last computed it: at battle start, then at each form change (used by the policy, §5).
- `lastDamage` stays per slot. On a form change PvPoke's `resetMoves` re-runs `initializeMove` (Pokemon.js:880-900) for the changing Pokémon's fast and charged moves, recomputing `move.damage` against the opponent with current forms and stages, so the changing side's `lastDamage` is recomputed in full (§4.4). The opponent's `lastDamage` is not touched: after Mimikyu busts, the opponent's cached damage still reflects the pre-bust Defense until it next uses each move, as in PvPoke.
- Helper `activeForm(state, side): Form`.
- Initial buff stages add the start form's `nativeStatBuffs`, as today.

### 4.2 Damage
- `moveDamage` uses the attacker's active-form types for STAB and the defender's active-form types for effectiveness. Stats come from `Combatant`.
- A charged action with slot `i` means slot `i` of the attacker's active form.

### 4.3 Charged move resolution order (PvPoke Battle.js)
1. Compute damage with current forms and stages.
2. Ask the defender's shield decider (unchanged).
3. **Disguise** (Battle.js:1273-1300): if not shielded, the move is not tagged `instant`, and the defender's active form has trigger `charged_move_damage` + effect `protect`: record the would-be damage and set damage to 1.
4. Apply damage; emit `charged`, then `disguise` if step 3 applied (so a trace reads "hit for 1, disguise blocked N").
5. Apply the move's buffs (unchanged).
6. **Attacker form change** (Battle.js:1547-1580): if the attacker's active rule is `charged_move`, switch to its `alternativeFormId`.
7. **Defender form change** (Battle.js:1621-1633): if the defender's active rule is `charged_move_damage`, the move was not shielded and not `instant`, switch to its `alternativeFormId`.

### 4.4 Changing form (mirrors PvPoke `changeForm` → `resetMoves`)
- Set `formId`; types and charged moves now come from the new form.
- Add the new form's `nativeStatBuffs` to current buff stages, clamped (Pokemon.js:2496-2501).
- Recompute the changing side's `lastDamage` (fast and every charged slot) with current forms and stages (PvPoke `initializeMove`).
- Reset chance-based buff meters for the new form's charged moves (Pokemon.js:735-746).
- Set `moveOrderBasis` to the recomputed `lastDamage.charged`.
- Emit `formChange`.

### 4.5 Events
- `{ kind: 'formChange'; turn; side; from: string; to: string }`
- `{ kind: 'disguise'; turn; side /* defender */; blockedDamage: number; sourceMoveId: string }`
- The CLI `--trace` prints both.

### 4.6 Unchanged
Fast moves, energy, the action queue, CMP, cooldowns, battle end.

## 5. Decision logic (`src/policy/pvpoke`)
- `PokeView` reads the active form's types and charged moves; `c.chargedMoves` usages move to the view's form-aware list.
- `orderChargedMoves` (fastest, best, DPE) runs from `moveOrderBasis` instead of a rebuilt battle-start state, so it reflects the most recent `resetMoves` (battle start or form change) as PvPoke does.
- Port `ActionLogic.js:236-252`: if the opponent's active rule has effect `protect` and the opponent has 0 shields, and `poke.energy >= fastestChargedMove.energy` and that move is not self-debuffing, throw it.
- Shield logic unchanged. The Aegislash/Cramorant branches stay skipped.
- Decision logic otherwise follows PvPoke exactly, including its stale damage estimates after stat changes (e.g. the opponent's cached damage after Mimikyu busts). Decision-quality differences from real play are recorded in `docs/known-game-differences.md` (D1–D7) for a later sub-project, not fixed here.

## 6. Validation

### 6.1 Oracle
- The harness applies `corrections.ts` to PvPoke's gamemaster before running battles. No other PvPoke code or data is patched.
- `metaSpecies` now accepts Mimikyu and Morpeko, so the top-100 set includes them and drops the two lowest-ranked species currently in it. Regenerate the main fixture; acceptance is the bar the engine already meets (tests/oracle exact-parity lock): every matchup's battle rating identical at 0, 1 and 2 shields.
- New targeted fixture: Mimikyu and Morpeko each vs the top 100 at all nine shield combinations (0–2 × 0–2), plus Mimikyu vs Morpeko. Exact match required.
- Mimikyu check against **unmodified** PvPoke: the targeted Mimikyu matchups excluding Morpeko must match the uncorrected harness too, proving the corrections touch only Morpeko.

### 6.2 Unit tests
- Loader: `formChange` and `released` parsed for both species; the Morpeko correction applied.
- `buildCombatant`: forms and Aura Wheel slots for Morpeko; Mimikyu's two forms; battle-only forms rejected; Aegislash and Cramorant rejected naming their trigger.
- Turn: disguise holds a charged hit to 1 and busts with −1 Defense; shielded hit keeps the disguise; fast moves don't break it; disguise only once; Morpeko switches on every charged move including shielded ones; Aura Wheel type and STAB follow the form; +1 Attack stacks across switches; event order.
- Policy: the ported "break the disguise" rule fires and does not fire in the right cases; move order is recomputed after a form change.

## 7. Documentation
- ADR 0003 (§3.2).
- `docs/known-game-differences.md` (added with this spec): the running list of every place we think we differ from the real game, fixed or open. Keep it current: mark M1 fixed when this lands, and add any new differences found during the port.
- README: remove Mimikyu and Morpeko from the unsupported list; note the Morpeko correction vs pvpoke.com; link `docs/known-game-differences.md`.
- Engine spec: update the out-of-scope note in §7/§10 to point here.

## 8. Error handling
- Unsupported triggers or differing form stats: `UnsupportedPokemonError` with species and trigger.
- Battle-only form requested directly: `GameDataError` naming the start form.
- A form chain that references a missing species, or a move swap whose target move is missing: `GameDataError` at load or build time. No silent fallback.

## 9. Out of scope
Aegislash, Cramorant, other `activate_*` / `variable` triggers, megas, 3v3 switching and `resetOnSwitch` behaviour.
