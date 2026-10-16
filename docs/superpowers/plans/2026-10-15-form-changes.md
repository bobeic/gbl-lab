# Form Changes (Mimikyu, Morpeko) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Support Mimikyu (Disguise) and Morpeko (Hunger Switch) in the battle engine, matching PvPoke exactly except for one listed correction (Morpeko switches form on every charged move).

**Architecture:** Game data gains a typed `formChange` rule per species, plus a corrections table that both the loader and the PvPoke oracle harness apply. A `Combatant` precomputes every form it can reach, and each side's battle state tracks its active `formId`. The engine and the policy read a side's combatant through `activeCombatant(state, side)`, so types and charged moves follow the form. `resolveTurn` applies the Disguise and the two form-change triggers in PvPoke's order, and the policy ports PvPoke's "break the disguise" rule. Verification is exact parity against PvPoke's own simulator, with the corrections applied.

**Tech Stack:** TypeScript 5.6 (strict, `noUncheckedIndexedAccess`), Vitest 2.1, tsx, Node ≥ 20. PvPoke's JavaScript runs headless in a Node `vm` as the oracle (`scripts/oracle/pvpokeHarness.cjs`, checkout in `.cache/pvpoke`).

**Spec:** `docs/superpowers/specs/2026-10-15-form-changes-design.md` (read with `docs/superpowers/specs/2026-10-15-battle-engine-design.md` §10 and `docs/known-game-differences.md`).

## Global Constraints

- Work on branch `feat/tvanmook/form-changes/20261015`. Never commit to `main`. Commit prefixes: `feat:`, `fix:`, `test:`, `docs:`, `chore:`.
- The repo's local git config already sets author `bobeic <toby_van_mook@hotmail.com>` and the gh credential helper. Don't change git config.
- Never touch `.env*` or secrets files.
- No new dependencies.
- TypeScript strict with `noUncheckedIndexedAccess`. `npm run typecheck` must pass at the end of every task.
- Every function that can fail throws a typed error from `src/errors.ts` (`GameDataError`, `UnsupportedPokemonError`, `IllegalActionError`, `PolicyStateError`, …). No silent fallbacks.
- Code that mirrors PvPoke cites `PvPoke File.js:line` in a comment, as the existing code does.
- PvPoke semantics win (ADR 0002). The only deliberate deviation is in `src/data/corrections.ts` (ADR 0003, written in Task 6).
- Never weaken a test to make it pass, and never edit a fixture's expected values by hand. If an oracle comparison fails, use superpowers:systematic-debugging on the engine. Fixtures are only regenerated from PvPoke via the npm scripts.
- Docstrings on public functions: one sentence on what the function does. Comments only on non-obvious logic.
- `npm test` (full suite, ~159 tests before this work) must pass before a task is marked done.

## Review Focus

1. **Both sides throw charged moves on the same turn against a disguised Mimikyu.** The Disguise must block the opponent's move that actually hits Mimikyu, and Mimikyu's own move must land normally. Test in Task 3.
2. **Mimikyu on 1 HP takes a disguised hit.** Like a shield, the Disguise deals 1 damage, so Mimikyu faints. Test in Task 3.
3. **Busted Mimikyu already at −4 Defense.** The bust's −1 is clamped at the stage limit and doesn't go below it. Test in Task 3.
4. **Asking for a battle-only form directly** (`morpeko_hangry`, `mimikyu_busted`, e.g. from the CLI). Expect a clear `GameDataError` that names the form to use. Test in Task 2.
5. **Policy reading Morpeko's moves after an Aura Wheel swap.** The shield decider and the decision logic look moves up by slot and by id. After a switch they must see `AURA_WHEEL_DARK`, not a stale Electric move, and `pvpokeShield`'s damage-consistency check must not throw. Covered by the live PvPoke cases in Task 4 (Morpeko vs Azumarill, Medicham and Mimikyu).

---

### Task 1: Game data — form-change rules, `released`, corrections table

**Files:**
- Modify: `src/data/types.ts` (the `Species` interface, lines 63-80)
- Modify: `src/data/loader.ts` (helpers near lines 9-50; `parseSpecies` lines 111-160)
- Create: `src/data/corrections.ts`
- Modify: `src/data/index.ts`
- Modify: `src/engine/combatant.ts:42` (keep compiling; real support lands in Task 2)
- Test: `tests/loader.test.ts`

**Interfaces:**
- Produces:
  - `interface FormChange { trigger: string; effect: string | null; moveId: string | null; moveIds: readonly string[] | null; alternativeFormId: string | null; resetOnSwitch: boolean }` (all readonly), exported from `src/data/types.ts`
  - `Species.formChange: FormChange | null` (replaces `hasFormChange`)
  - `Species.released: boolean`
  - `interface FormChangeCorrection { speciesId: string; reason: string; formChange: Readonly<Record<string, unknown>> }`
  - `FORM_CHANGE_CORRECTIONS: readonly FormChangeCorrection[]`, exported from `src/data/corrections.ts` and re-exported from `src/data/index.ts`

- [ ] **Step 1: Write the failing tests**

In `tests/loader.test.ts`, replace the line `expect(gd.species.get('mimikyu')?.hasFormChange).toBe(true);` inside `it('loads the vendored gamemaster', …)` with:

```ts
    expect(gd.species.get('mimikyu')?.formChange).not.toBeNull();
```

Add these tests inside `describe('loadGameData', …)`:

```ts
  it('defaults formChange to null and released to true', () => {
    const medicham = loadGameData(minimal()).species.get('medicham');
    expect(medicham?.formChange).toBeNull();
    expect(medicham?.released).toBe(true);
  });

  it('parses a formChange block', () => {
    const raw = minimal();
    (raw.pokemon as Record<string, unknown>[])[0]!.formChange = {
      type: 'set', trigger: 'charged_move_damage', effect: 'protect', moveId: 'ANY', alternativeFormId: 'medicham', resetOnSwitch: false,
    };
    expect(loadGameData(raw).species.get('medicham')?.formChange).toEqual({
      trigger: 'charged_move_damage', effect: 'protect', moveId: 'ANY', moveIds: null, alternativeFormId: 'medicham', resetOnSwitch: false,
    });
  });

  it('rejects a malformed formChange or released flag', () => {
    const badTrigger = minimal();
    (badTrigger.pokemon as Record<string, unknown>[])[0]!.formChange = { trigger: 7 };
    expect(() => loadGameData(badTrigger)).toThrow(GameDataError);
    const badReleased = minimal();
    (badReleased.pokemon as Record<string, unknown>[])[0]!.released = 'yes';
    expect(() => loadGameData(badReleased)).toThrow(new GameDataError('medicham: released must be a boolean'));
  });

  it('reads Mimikyu and Morpeko form changes, with the Morpeko correction applied', () => {
    const gd = loadDefaultGameData();
    expect(gd.species.get('mimikyu')?.formChange).toEqual({
      trigger: 'charged_move_damage', effect: 'protect', moveId: 'ANY', moveIds: null, alternativeFormId: 'mimikyu_busted', resetOnSwitch: false,
    });
    expect(gd.species.get('mimikyu_busted')?.released).toBe(false);
    expect(gd.species.get('morpeko_full_belly')?.formChange?.alternativeFormId).toBe('morpeko_hangry');
    // PvPoke's gamemaster has no rule on morpeko_hangry; FORM_CHANGE_CORRECTIONS adds the switch back (ADR 0003).
    expect(gd.species.get('morpeko_hangry')?.formChange).toEqual({
      trigger: 'charged_move', effect: null, moveId: 'ANY', moveIds: null, alternativeFormId: 'morpeko_full_belly', resetOnSwitch: true,
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/loader.test.ts`
Expected: FAIL. `formChange` and `released` are `undefined`, and TypeScript reports that `formChange` does not exist on `Species`.

- [ ] **Step 3: Add the types**

In `src/data/types.ts`, add above `export interface Species`:

```ts
/** PvPoke's formChange block, kept close to the raw data so unsupported triggers can be named in errors. */
export interface FormChange {
  /** PvPoke trigger, e.g. 'charged_move', 'charged_move_damage', 'none', 'activate_charged', 'activate_shield'. */
  readonly trigger: string;
  /** Extra behaviour, e.g. 'protect' for Mimikyu's Disguise; null when absent. */
  readonly effect: string | null;
  /** 'ANY' or a single move id; null when absent. */
  readonly moveId: string | null;
  /** PvPoke `moveIDs` (Cramorant); null when absent. */
  readonly moveIds: readonly string[] | null;
  /** The form this rule switches to, 'variable' (Cramorant), or null. */
  readonly alternativeFormId: string | null;
  readonly resetOnSwitch: boolean;
}
```

In `Species`, replace `readonly hasFormChange: boolean;` with:

```ts
  readonly formChange: FormChange | null;
  /** PvPoke `released`; false for battle-only forms such as mimikyu_busted. */
  readonly released: boolean;
```

- [ ] **Step 4: Add the corrections table**

Create `src/data/corrections.ts`:

```ts
/**
 * Every place gbl-lab knowingly overrides PvPoke's game data to match the real game (ADR 0003,
 * docs/known-game-differences.md). The loader applies these, and the oracle harness patches PvPoke's
 * gamemaster with the same objects, so the engine and its oracle model the same game.
 */
export interface FormChangeCorrection {
  readonly speciesId: string;
  readonly reason: string;
  /** Replacement formChange block, in PvPoke's raw gamemaster shape. */
  readonly formChange: Readonly<Record<string, unknown>>;
}

export const FORM_CHANGE_CORRECTIONS: readonly FormChangeCorrection[] = [
  {
    speciesId: 'morpeko_hangry',
    reason: 'In the game Morpeko switches form on every charged move; PvPoke leaves it in Hangry (known-game-differences M1).',
    formChange: { type: 'set', trigger: 'charged_move', moveId: 'ANY', alternativeFormId: 'morpeko_full_belly', resetOnSwitch: true },
  },
];
```

Append to `src/data/index.ts`:

```ts
export { FORM_CHANGE_CORRECTIONS, type FormChangeCorrection } from './corrections';
```

- [ ] **Step 5: Parse the new fields**

In `src/data/loader.ts`, add `import { FORM_CHANGE_CORRECTIONS } from './corrections';` and add `FormChange` to the existing type import from `./types`. Add these helpers after `strArray`:

```ts
function bool(obj: Raw, key: string, ctx: string): boolean {
  const v = obj[key];
  if (typeof v !== 'boolean') throw new GameDataError(`${ctx}: ${key} must be a boolean`);
  return v;
}

function optStr(obj: Raw, key: string, ctx: string): string | null {
  const v = obj[key];
  if (v === undefined) return null;
  if (typeof v !== 'string') throw new GameDataError(`${ctx}: ${key} must be a string`);
  return v;
}

function parseFormChange(raw: unknown, id: string): FormChange {
  const ctx = `${id} formChange`;
  if (!isRecord(raw)) throw new GameDataError(`${ctx}: expected an object`);
  return {
    trigger: str(raw, 'trigger', ctx),
    effect: optStr(raw, 'effect', ctx),
    moveId: optStr(raw, 'moveId', ctx),
    moveIds: raw.moveIDs === undefined ? null : strArray(raw, 'moveIDs', ctx, true),
    alternativeFormId: optStr(raw, 'alternativeFormId', ctx),
    resetOnSwitch: raw.resetOnSwitch === undefined ? false : bool(raw, 'resetOnSwitch', ctx),
  };
}
```

In `parseSpecies`, before the `return`, add:

```ts
  // A correction replaces PvPoke's block outright (src/data/corrections.ts). A correction for a species that
  // isn't in this data has nothing to correct; tests on the vendored gamemaster pin that each one applies.
  const correction = FORM_CHANGE_CORRECTIONS.find((c) => c.speciesId === id);
  const rawFormChange = correction ? correction.formChange : p.formChange;
```

In the returned object, replace `hasFormChange: p.formChange !== undefined,` with:

```ts
    formChange: rawFormChange === undefined ? null : parseFormChange(rawFormChange, id),
    released: p.released === undefined ? true : bool(p, 'released', id),
```

- [ ] **Step 6: Keep the engine compiling**

In `src/engine/combatant.ts:42`, change `if (species.hasFormChange)` to `if (species.formChange)`. Task 2 replaces this line.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run tests/loader.test.ts && npm run typecheck`
Expected: PASS, and no type errors.

- [ ] **Step 8: Run the full suite and commit**

Run: `npm test`
Expected: all tests pass. Mimikyu and Morpeko are still rejected, so the oracle fixtures are unchanged.

```bash
git add src/data tests/loader.test.ts src/engine/combatant.ts
git commit -m "feat: load PvPoke form-change rules and released flag; add corrections table with the Morpeko switch"
```

---

### Task 2: Combatant forms

**Files:**
- Modify: `src/engine/combatant.ts` (imports; `Combatant` interface lines 16-26; `assertSupported` lines 41-48; `buildCombatant` lines 71-110; `moveDamage` lines 120-131)
- Test: `tests/combatant.test.ts`

**Interfaces:**
- Consumes: `FormChange` and `Species.formChange`/`Species.released` from Task 1.
- Produces:
  - `interface Form { id: string; types: readonly PokemonType[]; chargedMoves: readonly ChargedMove[]; nativeStatBuffs: StatPair; formChange: FormChange | null }` (all readonly), exported from `src/engine/combatant.ts`
  - `Combatant.types: readonly PokemonType[]`, `Combatant.startFormId: string`, `Combatant.forms: ReadonlyMap<string, Form>`
  - `formOf(c: Combatant, formId: string): Form`, which throws `GameDataError` for an unknown form
  - `withForm(c: Combatant, formId: string): Combatant`, which returns `c` itself for `c.startFormId`
  - `moveDamage` now reads `attacker.types` and `defender.types`, not `species.types`

- [ ] **Step 1: Write the failing tests**

In `tests/combatant.test.ts`, add `withForm` to the import from `../src/engine/combatant`. In `it('rejects unknown species, form changers and megas', …)`, replace the Mimikyu expectation (the `buildCombatant(gd, { speciesId: 'mimikyu', … })` line and its `.toThrow(UnsupportedPokemonError)`) with:

```ts
    expect(() => buildCombatant(gd, { speciesId: 'aegislash_shield', fastMoveId: 'AEGISLASH_CHARGE_PSYCHO_CUT', chargedMoveIds: ['SHADOW_BALL'] }))
      .toThrow(UnsupportedPokemonError);
```

Add a new `describe` block:

```ts
describe('form-changing Pokémon', () => {
  const morpekoSpec = { speciesId: 'morpeko_full_belly', fastMoveId: 'THUNDER_SHOCK', chargedMoveIds: ['AURA_WHEEL_ELECTRIC', 'PSYCHIC_FANGS'] };
  const mimikyuSpec = { speciesId: 'mimikyu', fastMoveId: 'SHADOW_CLAW', chargedMoveIds: ['SHADOW_SNEAK', 'PLAY_ROUGH'] };

  it('builds Morpeko with both forms and Aura Wheel swapped in the same slot', () => {
    const c = buildCombatant(gd, morpekoSpec);
    expect(c.startFormId).toBe('morpeko_full_belly');
    expect([...c.forms.keys()]).toEqual(['morpeko_full_belly', 'morpeko_hangry']);
    expect(c.forms.get('morpeko_hangry')?.chargedMoves.map((m) => m.id)).toEqual(['AURA_WHEEL_DARK', 'PSYCHIC_FANGS']);
    expect(c.forms.get('morpeko_hangry')?.formChange?.alternativeFormId).toBe('morpeko_full_belly');
    expect(withForm(c, 'morpeko_hangry').chargedMoves[0]?.id).toBe('AURA_WHEEL_DARK');
    expect(withForm(c, 'morpeko_hangry').stats).toEqual(c.stats);
    expect(withForm(c, 'morpeko_full_belly')).toBe(c);
  });

  it('builds Mimikyu with its busted form, which carries -1 Defense and no further change', () => {
    const c = buildCombatant(gd, mimikyuSpec);
    expect([...c.forms.keys()]).toEqual(['mimikyu', 'mimikyu_busted']);
    expect(c.forms.get('mimikyu')?.formChange?.effect).toBe('protect');
    expect(c.forms.get('mimikyu_busted')?.nativeStatBuffs).toEqual([0, -1]);
    expect(c.forms.get('mimikyu_busted')?.formChange?.trigger).toBe('none');
  });

  it('gives an ordinary Pokémon a single form with its species types', () => {
    const c = buildCombatant(gd, { speciesId: 'medicham', fastMoveId: 'COUNTER', chargedMoveIds: ['ICE_PUNCH'] });
    expect([...c.forms.keys()]).toEqual(['medicham']);
    expect(c.types).toEqual(['fighting', 'psychic']);
  });

  it('fails loudly for a form the combatant does not have', () => {
    const c = buildCombatant(gd, mimikyuSpec);
    expect(() => withForm(c, 'morpeko_hangry')).toThrow(new GameDataError('mimikyu has no form morpeko_hangry'));
  });

  it('rejects battle-only forms, naming the form to use', () => {
    expect(() => buildCombatant(gd, { ...morpekoSpec, speciesId: 'morpeko_hangry', chargedMoveIds: ['AURA_WHEEL_DARK'] }))
      .toThrow(new GameDataError('morpeko_hangry is a battle-only form; use morpeko_full_belly'));
    expect(() => buildCombatant(gd, { ...mimikyuSpec, speciesId: 'mimikyu_busted' }))
      .toThrow(new GameDataError('mimikyu_busted is a battle-only form; use mimikyu'));
  });

  it('still rejects Cramorant, naming its rule', () => {
    expect(() => buildCombatant(gd, { speciesId: 'cramorant', fastMoveId: 'PECK', chargedMoveIds: ['SURF'] }))
      .toThrow(new UnsupportedPokemonError('cramorant: form change (charged_move -> variable) is not modelled yet'));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/combatant.test.ts`
Expected: FAIL. `withForm` is not exported, and Mimikyu and Morpeko throw `UnsupportedPokemonError`.

- [ ] **Step 3: Implement forms in `src/engine/combatant.ts`**

Change the type import to:

```ts
import type { ChargedMove, FastMove, FormChange, GameData, Move, PokemonType, Species, StatPair } from '../data/types';
```

Add above `export interface Combatant`:

```ts
/** One in-battle form of a Pokémon (PvPoke activeFormId); every form shares the Combatant's stats. */
export interface Form {
  readonly id: string;
  readonly types: readonly PokemonType[];
  /** Charged moves in slot order, with this form's move swaps applied. */
  readonly chargedMoves: readonly ChargedMove[];
  /** Stat stages added when the Pokémon enters this form (PvPoke nativeStatBuffs). */
  readonly nativeStatBuffs: StatPair;
  /** The rule in force in this form; a form without its own keeps the previous one (PvPoke Pokemon.js:2482-2484). */
  readonly formChange: FormChange | null;
}
```

Add to `Combatant` after `species`:

```ts
  /** Types in the start form; during a battle read them through activeCombatant/withForm. */
  readonly types: readonly PokemonType[];
  readonly startFormId: string;
  /** Every form reachable from the start form, keyed by form id (a single entry for most Pokémon). */
  readonly forms: ReadonlyMap<string, Form>;
```

Delete the `species.hasFormChange` / `species.formChange` line from `assertSupported`. Add these after `assertSupported`:

```ts
/** Reject a battle-only form (e.g. morpeko_hangry), naming the released form that turns into it. */
function assertNotBattleOnly(gd: GameData, species: Species): void {
  if (species.released) return;
  for (const s of gd.species.values()) {
    if (s.released && s.formChange?.alternativeFormId === species.id) {
      throw new GameDataError(`${species.id} is a battle-only form; use ${s.id}`);
    }
  }
}

/** Moves replaced when entering a form, as PvPoke Pokemon.changeForm hard-codes them (Pokemon.js:2504-2511). */
const FORM_MOVE_SWAPS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  morpeko_full_belly: { AURA_WHEEL_DARK: 'AURA_WHEEL_ELECTRIC' },
  morpeko_hangry: { AURA_WHEEL_ELECTRIC: 'AURA_WHEEL_DARK' },
};

function swapMoves(gd: GameData, formId: string, moves: readonly ChargedMove[]): ChargedMove[] {
  const swaps = FORM_MOVE_SWAPS[formId] ?? {};
  return moves.map((m) => {
    const to = swaps[m.id];
    if (to === undefined) return m;
    const move = gd.moves.get(to);
    if (!move || move.kind !== 'charged') throw new GameDataError(`${formId}: swap target ${to} is not a charged move`);
    return move;
  });
}

/** Whether the engine models a rule: Morpeko's switch, Mimikyu's Disguise, or no further change. */
function isSupportedRule(rule: FormChange): boolean {
  if (rule.trigger === 'none') return true;
  if (rule.trigger === 'charged_move') return rule.moveId === 'ANY' && rule.moveIds === null && rule.alternativeFormId !== 'variable';
  return rule.trigger === 'charged_move_damage' && rule.effect === 'protect';
}

/** Follow alternativeFormId from the start form and build every reachable form, rejecting what is not modelled. */
function buildForms(gd: GameData, start: Species, startMoves: readonly ChargedMove[]): Map<string, Form> {
  const forms = new Map<string, Form>();
  let species = start;
  let moves: readonly ChargedMove[] = startMoves;
  let rule: FormChange | null = start.formChange;
  for (;;) {
    if (rule && !isSupportedRule(rule)) {
      throw new UnsupportedPokemonError(`${start.id}: form change (${rule.trigger} -> ${rule.alternativeFormId ?? 'none'}) is not modelled yet`);
    }
    // PvPoke recomputes stats for a form with different base stats (Pokemon.getFormStats); only Aegislash needs that.
    if (species.base.atk !== start.base.atk || species.base.def !== start.base.def || species.base.hp !== start.base.hp) {
      throw new UnsupportedPokemonError(`${start.id}: form ${species.id} has different base stats; not modelled yet`);
    }
    forms.set(species.id, { id: species.id, types: species.types, chargedMoves: moves, nativeStatBuffs: species.nativeStatBuffs, formChange: rule });
    const nextId = rule && rule.trigger !== 'none' ? rule.alternativeFormId : null;
    if (nextId === null || forms.has(nextId)) return forms;
    const next = gd.species.get(nextId);
    if (!next) throw new GameDataError(`${species.id}: form change target ${nextId} is not a known species`);
    species = next;
    moves = swapMoves(gd, nextId, moves);
    rule = next.formChange ?? rule;
  }
}
```

In `buildCombatant`, call `assertNotBattleOnly(gd, species);` immediately after the `if (!species) throw …` line. After `assertSupported(species, [fastMove, ...chargedMoves]);`, add `const forms = buildForms(gd, species, chargedMoves);`. Add to the returned object after `species,`:

```ts
    types: species.types,
    startFormId: species.id,
    forms,
```

Add after `buildCombatant`:

```ts
/** Return one of the combatant's forms, failing loudly if it has no such form. */
export function formOf(c: Combatant, formId: string): Form {
  const form = c.forms.get(formId);
  if (!form) throw new GameDataError(`${c.species.id} has no form ${formId}`);
  return form;
}

/** Return the combatant as it is in `formId`: that form's types and charged moves, everything else unchanged. */
export function withForm(c: Combatant, formId: string): Combatant {
  if (formId === c.startFormId) return c;
  const form = formOf(c, formId);
  return { ...c, types: form.types, chargedMoves: form.chargedMoves };
}
```

In `moveDamage`, replace `attacker.species.types` with `attacker.types` and `defender.species.types` with `defender.types`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/combatant.test.ts && npm run typecheck`
Expected: PASS. If `typecheck` reports object literals missing `types`/`startFormId`/`forms` in tests that build a `Combatant` by hand, build those combatants with `buildCombatant` instead, keeping each test's assertions unchanged.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all pass. `scripts/oracle/meta.ts` now accepts Mimikyu and Morpeko, but the fixtures are only regenerated in Task 5, so the acceptance tests still compare the existing fixture's cases.

- [ ] **Step 6: Commit**

```bash
git add src/engine/combatant.ts tests/combatant.test.ts
git commit -m "feat: build every reachable form for Mimikyu and Morpeko; reject battle-only forms and unmodelled triggers"
```

---

### Task 3: Battle state and turn — active form, Disguise, form changes

**Files:**
- Modify: `src/engine/state.ts` (imports; `SideState` lines 15-26; `initialMeter` line 78; `createBattle` lines 98-132)
- Modify: `src/engine/turn.ts` (imports; `BattleEvent` lines 12-16; `resolveTurn` lines 52-187)
- Modify: `src/policy/testPolicies.ts` (lines 23 and 61)
- Create: `tests/formChange.test.ts`

**Interfaces:**
- Consumes: `Form`, `formOf`, `withForm` and `Combatant.startFormId` from Task 2.
- Produces:
  - `SideState.formId: string` and `SideState.moveOrderBasis: readonly number[]`
  - `activeCombatant(state: BattleState, side: Side): Combatant` and `activeForm(state: BattleState, side: Side): Form`, from `src/engine/state.ts`
  - `initialMeter(chance: number | undefined): number | null`, now exported from `src/engine/state.ts`
  - New `BattleEvent` members: `{ kind: 'disguise'; turn: number; side: Side; blockedDamage: number; sourceMoveId: string }`, where `side` is the defender, and `{ kind: 'formChange'; turn: number; side: Side; from: string; to: string }`

- [ ] **Step 1: Write the failing tests**

Create `tests/formChange.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { loadDefaultGameData } from '../src/data/node';
import type { Move } from '../src/data/types';
import { buildCombatant, moveDamage, type CombatantSpec } from '../src/engine/combatant';
import { activeCombatant, createBattle, type BattleState, type Side, type SideState } from '../src/engine/state';
import { beginTurn, canAct, resolveTurn, type Action, type BattleEvent, type ShieldDecider } from '../src/engine/turn';

const gd = loadDefaultGameData();
const rules = { maxBuffStages: gd.maxBuffStages, buffDivisor: gd.buffDivisor };
const mimikyu: CombatantSpec = { speciesId: 'mimikyu', fastMoveId: 'SHADOW_CLAW', chargedMoveIds: ['SHADOW_SNEAK', 'PLAY_ROUGH'] };
const morpeko: CombatantSpec = { speciesId: 'morpeko_full_belly', fastMoveId: 'THUNDER_SHOCK', chargedMoveIds: ['AURA_WHEEL_ELECTRIC', 'PSYCHIC_FANGS'] };
const azu: CombatantSpec = { speciesId: 'azumarill', fastMoveId: 'BUBBLE', chargedMoveIds: ['ICE_BEAM', 'PLAY_ROUGH'] };
const med: CombatantSpec = { speciesId: 'medicham', fastMoveId: 'COUNTER', chargedMoveIds: ['ICE_PUNCH', 'PSYCHIC'] };

const never: ShieldDecider = () => false;
const always: ShieldDecider = () => true;
const charged = (index: number): Action => ({ type: 'charged', index });
const move = (id: string): Move => gd.moves.get(id)!;

function battle(a: CombatantSpec, b: CombatantSpec, shields: [number, number], startEnergy: [number, number]): BattleState {
  return createBattle([buildCombatant(gd, a), buildCombatant(gd, b)], { shields, startEnergy }, rules);
}

/** Overwrite fields of one side's state (for setting up a position directly). */
function patch(s: BattleState, side: Side, fields: Partial<SideState>): BattleState {
  const sides: [SideState, SideState] = [s.sides[0], s.sides[1]];
  sides[side] = { ...sides[side], ...fields };
  return { ...s, sides };
}

/** Resolve one turn with fixed actions for the sides that can act. */
function turn(s: BattleState, actions: [Action | null, Action | null], shield: ShieldDecider = never) {
  const pre = beginTurn(s);
  const allowed = ([0, 1] as const).map((side) => (canAct(pre, side) ? actions[side] : null)) as [Action | null, Action | null];
  return resolveTurn(pre, allowed, shield);
}

const notFast = (events: readonly BattleEvent[]) => events.filter((e) => e.kind !== 'fast');

describe("Mimikyu's Disguise", () => {
  it('holds the first unshielded charged move to 1 damage, then busts with -1 Defense', () => {
    const s = battle(azu, mimikyu, [0, 0], [60, 0]);
    const blocked = moveDamage(activeCombatant(s, 0), 0, activeCombatant(s, 1), 0, move('PLAY_ROUGH'), rules.buffDivisor);
    const r = turn(s, [charged(1), null]);
    expect(r.state.sides[1].hp).toBe(s.sides[1].hp - 1);
    expect(notFast(r.events)).toEqual([
      { kind: 'charged', turn: 1, side: 0, moveId: 'PLAY_ROUGH', damage: 1, shielded: false },
      { kind: 'disguise', turn: 1, side: 1, blockedDamage: blocked, sourceMoveId: 'PLAY_ROUGH' },
      { kind: 'formChange', turn: 1, side: 1, from: 'mimikyu', to: 'mimikyu_busted' },
    ]);
    expect(r.state.sides[1].formId).toBe('mimikyu_busted');
    expect(r.state.sides[1].buffs).toEqual([0, -1]);
  });

  it('stays disguised when the hit is shielded', () => {
    const r = turn(battle(azu, mimikyu, [0, 1], [60, 0]), [charged(1), null], always);
    expect(r.state.sides[1].formId).toBe('mimikyu');
    expect(r.state.sides[1].shields).toBe(0);
    expect(r.state.sides[1].buffs).toEqual([0, 0]);
    expect(r.events.some((e) => e.kind === 'disguise' || e.kind === 'formChange')).toBe(false);
  });

  it('is not broken by fast moves', () => {
    let s = battle(azu, mimikyu, [0, 0], [0, 0]);
    for (let i = 0; i < 9; i++) s = turn(s, [{ type: 'fast' }, null]).state;
    expect(s.sides[1].hp).toBeLessThan(s.combatants[1].stats.hp);
    expect(s.sides[1].formId).toBe('mimikyu');
  });

  it('blocks only once: the next charged move hits busted Mimikyu in full', () => {
    let s = turn(battle(azu, mimikyu, [0, 0], [60, 0]), [charged(1), null]).state;
    s = turn(s, [null, null]).state; // no actions on the turn after a charged move
    s = patch(s, 0, { energy: 60 });
    const full = moveDamage(activeCombatant(s, 0), 0, activeCombatant(s, 1), -1, move('PLAY_ROUGH'), rules.buffDivisor);
    const r = turn(s, [charged(1), null]);
    expect(notFast(r.events)).toEqual([{ kind: 'charged', turn: 3, side: 0, moveId: 'PLAY_ROUGH', damage: full, shielded: false }]);
  });

  it('still deals 1 damage, so a Mimikyu on 1 HP faints', () => {
    const r = turn(patch(battle(azu, mimikyu, [0, 0], [60, 0]), 1, { hp: 1 }), [charged(1), null]);
    expect(r.state.sides[1].hp).toBe(0);
    expect(r.state.over).toBe(true);
    expect(r.events.at(-1)).toEqual({ kind: 'faint', turn: 1, side: 1 });
  });

  it('clamps the bust Defense drop at the stage limit', () => {
    const r = turn(patch(battle(azu, mimikyu, [0, 0], [60, 0]), 1, { buffs: [0, -rules.maxBuffStages] }), [charged(1), null]);
    expect(r.state.sides[1].buffs).toEqual([0, -rules.maxBuffStages]);
  });

  it("blocks the opponent's move when both throw on the same turn, and Mimikyu's own move lands in full", () => {
    const s = battle(azu, mimikyu, [0, 0], [60, 50]);
    const sneak = moveDamage(activeCombatant(s, 1), 0, activeCombatant(s, 0), 0, move('SHADOW_SNEAK'), rules.buffDivisor);
    const r = turn(s, [charged(1), charged(0)]);
    const disguises = r.events.filter((e) => e.kind === 'disguise');
    expect(disguises).toHaveLength(1);
    expect(disguises[0]).toMatchObject({ side: 1, sourceMoveId: 'PLAY_ROUGH' });
    expect(r.state.sides[0].hp).toBe(s.sides[0].hp - sneak);
    expect(r.state.sides[1].formId).toBe('mimikyu_busted');
  });
});

describe("Morpeko's Hunger Switch", () => {
  /** Throw each charged slot in turn from full energy and HP, recording the move used and the form afterwards. */
  function throwSequence(slots: number[], shield: ShieldDecider = never, shields: [number, number] = [0, 0]) {
    let s = battle(morpeko, azu, shields, [0, 0]);
    const used: string[] = [];
    const forms: string[] = [];
    const states: BattleState[] = [];
    for (const index of slots) {
      s = patch(patch(s, 0, { energy: 100 }), 1, { hp: s.combatants[1].stats.hp });
      const r = turn(s, [charged(index), null], shield);
      used.push(...r.events.flatMap((e) => (e.kind === 'charged' ? [e.moveId] : [])));
      s = turn(r.state, [null, null]).state;
      forms.push(s.sides[0].formId);
      states.push(s);
    }
    return { used, forms, states };
  }

  it('switches form after every charged move, with Aura Wheel following the form', () => {
    const { used, forms } = throwSequence([0, 0, 1, 0]);
    expect(used).toEqual(['AURA_WHEEL_ELECTRIC', 'AURA_WHEEL_DARK', 'PSYCHIC_FANGS', 'AURA_WHEEL_DARK']);
    expect(forms).toEqual(['morpeko_hangry', 'morpeko_full_belly', 'morpeko_hangry', 'morpeko_full_belly']);
  });

  it('logs each switch as a formChange event after the move and its buff', () => {
    const r = turn(battle(morpeko, azu, [0, 0], [45, 0]), [charged(0), null]);
    expect(notFast(r.events).map((e) => e.kind)).toEqual(['charged', 'buff', 'formChange']);
    expect(r.events.find((e) => e.kind === 'formChange')).toEqual({ kind: 'formChange', turn: 1, side: 0, from: 'morpeko_full_belly', to: 'morpeko_hangry' });
  });

  it('switches even when the charged move is shielded', () => {
    const { forms } = throwSequence([0], always, [0, 2]);
    expect(forms).toEqual(['morpeko_hangry']);
  });

  it("stacks Aura Wheel's +1 Attack across switches", () => {
    const { states } = throwSequence([0, 0]);
    expect(states[1]!.sides[0].buffs).toEqual([2, 0]);
  });

  it("deals damage with the active form's Aura Wheel type", () => {
    const { states } = throwSequence([0]);
    const s = patch(states[0]!, 0, { energy: 100 });
    const dark = moveDamage(activeCombatant(s, 0), s.sides[0].buffs[0], activeCombatant(s, 1), 0, move('AURA_WHEEL_DARK'), rules.buffDivisor);
    const electric = moveDamage(activeCombatant(s, 0), s.sides[0].buffs[0], activeCombatant(s, 1), 0, move('AURA_WHEEL_ELECTRIC'), rules.buffDivisor);
    expect(dark).not.toBe(electric);
    const r = turn(s, [charged(0), null]);
    expect(r.events.find((e) => e.kind === 'charged')).toMatchObject({ moveId: 'AURA_WHEEL_DARK', damage: dark });
  });

  it('recomputes its remembered move damage and move-order basis on each switch (PvPoke resetMoves)', () => {
    const { states } = throwSequence([0]);
    const s = states[0]!;
    const me = activeCombatant(s, 0);
    const opp = activeCombatant(s, 1);
    const expected = me.chargedMoves.map((m) => moveDamage(me, s.sides[0].buffs[0], opp, s.sides[1].buffs[1], m, rules.buffDivisor));
    expect(s.sides[0].lastDamage.charged).toEqual(expected);
    expect(s.sides[0].moveOrderBasis).toEqual(expected);
  });
});

it('leaves ordinary Pokémon in their single form', () => {
  const r = turn(battle(med, azu, [0, 0], [40, 0]), [charged(0), null]);
  expect(r.state.sides[0].formId).toBe('medicham');
  expect(r.events.some((e) => e.kind === 'formChange')).toBe(false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/formChange.test.ts`
Expected: FAIL. `activeCombatant` is not exported, `formId` is undefined, and no `disguise`/`formChange` events are produced.

- [ ] **Step 3: Add form state in `src/engine/state.ts`**

Change the combatant import to `import { formOf, moveDamage, withForm, type Combatant, type Form } from './combatant';`.

Add to `SideState`:

```ts
  /** Active form (PvPoke activeFormId); starts at the combatant's startFormId. */
  readonly formId: string;
  /** Per-slot charged damage when PvPoke's resetMoves last ran (battle start or a form change); the policy orders moves from it. */
  readonly moveOrderBasis: readonly number[];
```

Export `initialMeter` (change `function initialMeter` to `export function initialMeter`, and give it the docstring `/** PvPoke's starting buffApplyMeter for a charged move's buff chance; null when the buff is certain or absent. */`).

Add after `other`:

```ts
/** The side's combatant in its active form: types and charged moves follow form changes. */
export function activeCombatant(state: BattleState, side: Side): Combatant {
  return withForm(state.combatants[side], state.sides[side].formId);
}

/** The side's active form, including the form-change rule in force. */
export function activeForm(state: BattleState, side: Side): Form {
  return formOf(state.combatants[side], state.sides[side].formId);
}
```

These reference `BattleState`, which is declared later in the file. That's fine in TypeScript.

In `createBattle`'s `side` function, compute the charged damage once and add the two fields:

```ts
    const charged = me.chargedMoves.map(dmg);
    return {
      hp: me.stats.hp,
      energy: setup.startEnergy?.[i] ?? 0,
      cooldownMs: 0,
      shields: setup.shields[i],
      buffs: buffs[i]!,
      faintSource: 'none',
      buffMeters: me.chargedMoves.map((m) => initialMeter(m.buffs?.chance)),
      lastDamage: { fast: dmg(me.fastMove), charged },
      formId: me.startFormId,
      moveOrderBasis: charged,
    };
```

- [ ] **Step 4: Apply the Disguise and form changes in `src/engine/turn.ts`**

Change the imports:

```ts
import type { FormChange, Move, MoveBuffs, StatPair } from '../data/types';
import { GameDataError, IllegalActionError } from '../errors';
import { formOf, moveDamage, withForm, type Combatant } from './combatant';
import { MAX_ENERGY, TURN_MS } from './constants';
import { clampStage } from './damage';
import { SIDES, initialMeter, other, type BattleState, type QueuedAction, type Side, type SideState } from './state';
```

Add two members to `BattleEvent`:

```ts
  | { readonly kind: 'disguise'; readonly turn: number; readonly side: Side; readonly blockedDamage: number; readonly sourceMoveId: string }
  | { readonly kind: 'formChange'; readonly turn: number; readonly side: Side; readonly from: string; readonly to: string }
```

Add above `resolveTurn`:

```ts
/** Whether a rule is Mimikyu's Disguise: it takes an unshielded charged move like a shield. */
function isDisguise(rule: FormChange | null): boolean {
  return rule?.trigger === 'charged_move_damage' && rule.effect === 'protect';
}
```

In `resolveTurn`, immediately after the `const cooldowns …` line, add:

```ts
  const active = (side: Side): Combatant => withForm(combatants[side], sides[side].formId);

  // PvPoke Pokemon.changeForm and resetMoves (Pokemon.js:2471-2526, 711-750, 880-900): new types and moves,
  // native stat stages added, buff meters reset, and the changing side's move damage recomputed at current stages.
  const changeForm = (side: Side, to: string): void => {
    const from = sides[side].formId;
    if (from === to) return;
    const form = formOf(combatants[side], to);
    const buffs = addStages(sides[side].buffs, form.nativeStatBuffs, rules.maxBuffStages);
    sides[side] = { ...sides[side], formId: to, buffs, buffMeters: form.chargedMoves.map((m) => initialMeter(m.buffs?.chance)) };
    const me = active(side);
    const opp = active(other(side));
    const dmg = (m: Move): number => moveDamage(me, sides[side].buffs[0], opp, sides[other(side)].buffs[1], m, rules.buffDivisor);
    const charged = me.chargedMoves.map(dmg);
    sides[side] = { ...sides[side], lastDamage: { fast: dmg(me.fastMove), charged }, moveOrderBasis: charged };
    events.push({ kind: 'formChange', turn: state.turn, side, from, to });
  };
```

`events` must be declared before `changeForm`, and it already is (`const events: BattleEvent[] = [];` comes before `queue`). Place `active` and `changeForm` after both `sides` and `events`.

In the action-queueing loop, change `const move = combatants[side].chargedMoves[action.index];` to `const move = active(side).chargedMoves[action.index];`.

In the `for (const act of turnActions)` loop, change the two lines at the top to:

```ts
    const attacker = active(me);
    const defender = active(op);
```

In the charged branch, replace everything from the line `const hp = Math.max(0, sides[op].hp - damage);` through `chargedUsed++;` with:

```ts
      // PvPoke Battle.js:1273-1300: Mimikyu's Disguise takes an unshielded, non-instant charged move like a shield
      const disguised = !shielded && !move.tags.includes('instant') && isDisguise(formOf(combatants[op], sides[op].formId).formChange);
      const blockedDamage = damage;
      if (disguised) damage = 1;
      const hp = Math.max(0, sides[op].hp - damage);
      sides[op] = { ...sides[op], hp, faintSource: hp <= 0 ? 'charged' : sides[op].faintSource };
      events.push({ kind: 'charged', turn: state.turn, side: me, moveId: move.id, damage, shielded });
      if (disguised) events.push({ kind: 'disguise', turn: state.turn, side: op, blockedDamage, sourceMoveId: move.id });
      chargedUsed++;
```

At the end of the charged branch, after the closing brace of `if (buffs) { … }` and still inside `else if (act.type === 'charged') { … }`, add:

```ts
      // PvPoke Battle.js:1547-1580: the attacker changes form after using any charged move (Morpeko)
      const attackerRule = formOf(combatants[me], sides[me].formId).formChange;
      if (attackerRule?.trigger === 'charged_move' && attackerRule.alternativeFormId !== null) {
        changeForm(me, attackerRule.alternativeFormId);
      }
      // PvPoke Battle.js:1621-1633: the defender changes form after an unshielded, non-instant charged move (Mimikyu's bust)
      const defenderRule = formOf(combatants[op], sides[op].formId).formChange;
      if (defenderRule?.trigger === 'charged_move_damage' && defenderRule.alternativeFormId !== null
        && !shielded && !move.tags.includes('instant')) {
        changeForm(op, defenderRule.alternativeFormId);
      }
```

- [ ] **Step 5: Make the test policies form-aware**

In `src/policy/testPolicies.ts`, change the import to `import { activeCombatant, other } from '../engine/state';` (keep the `type BattleState, Side` import). Replace `state.combatants[me].chargedMoves` with `activeCombatant(state, me).chargedMoves` on lines 23 and 61, and `state.combatants[side].chargedMoves` with `activeCombatant(state, side).chargedMoves` on line 47.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/formChange.test.ts && npm run typecheck`
Expected: PASS. If `typecheck` flags hand-built `SideState` literals in other tests, build those states with `createBattle` and override fields by spreading (`{ ...st.sides[0], hp: 10 }`), which keeps `formId`/`moveOrderBasis`. Don't change any assertion.

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: all pass. Results for ordinary Pokémon are unchanged, because `withForm` returns the same combatant for the start form.

- [ ] **Step 8: Commit**

```bash
git add src/engine/state.ts src/engine/turn.ts src/policy/testPolicies.ts tests/formChange.test.ts
git commit -m "feat: track active form in battle state; apply Mimikyu's Disguise and Morpeko's switch in PvPoke order"
```

---

### Task 4: Decision logic — form-aware views and the "break the disguise" rule

**Files:**
- Create: `scripts/oracle/load.ts`
- Modify: `scripts/oracle/pvpokeHarness.cjs` (`createPvpoke`, lines 12-15)
- Modify: `scripts/oracle/harness.d.ts` (last line)
- Modify: `scripts/gen-oracle.ts`, `scripts/gen-decision-oracle.ts`, `scripts/gen-iv-oracle.ts`, `scripts/compare-oracle.ts` (harness loading only)
- Modify: `src/policy/pvpoke/view.ts`
- Modify: `src/policy/pvpoke/moveMeta.ts` (`orderChargedMoves`, lines 56-75)
- Modify: `src/policy/pvpoke/decide.ts:322`
- Test: `tests/pvpokeDecide.test.ts`, `tests/pvpokeMoveMeta.test.ts`

**Interfaces:**
- Consumes: `activeCombatant`, `activeForm`, `SideState.moveOrderBasis` (Task 3); `FORM_CHANGE_CORRECTIONS` (Task 1).
- Produces:
  - `loadPvpoke(variant?: 'corrected' | 'unmodified'): PvpokeHarness`, from `scripts/oracle/load.ts`
  - `interface PvpokeOptions { formChangeCorrections?: readonly { speciesId: string; formChange: Readonly<Record<string, unknown>> }[] }`, and `createPvpoke(srcDir, options?)`
  - `PokeView.form: Form`
  - `orderChargedMoves(c: Combatant, basis: readonly number[], buffDivisor: number)`, where the second parameter is now the per-slot damage basis rather than a `SideState`

- [ ] **Step 1: Let the harness apply corrections, and centralise loading**

In `scripts/oracle/pvpokeHarness.cjs`, change the signature to `function createPvpoke(srcDir, options) {` and add right after the `const gamemaster = …` line:

```js
  // gbl-lab's corrections (src/data/corrections.ts, ADR 0003) so the oracle models the same game as the engine.
  for (const c of (options && options.formChangeCorrections) || []) {
    const entry = gamemaster.pokemon.find((p) => p.speciesId === c.speciesId);
    if (!entry) throw new Error(`correction for unknown species ${c.speciesId}`);
    entry.formChange = JSON.parse(JSON.stringify(c.formChange));
  }
```

In `scripts/oracle/harness.d.ts`, replace the last line with:

```ts
export interface PvpokeOptions {
  formChangeCorrections?: readonly { speciesId: string; formChange: Readonly<Record<string, unknown>> }[];
}
export function createPvpoke(srcDir: string, options?: PvpokeOptions): PvpokeHarness;
```

Create `scripts/oracle/load.ts`:

```ts
import { createRequire } from 'node:module';
import { FORM_CHANGE_CORRECTIONS } from '../../src/data/corrections';
import type { PvpokeHarness, PvpokeOptions } from './harness';

const require = createRequire(import.meta.url);
const { createPvpoke } = require('./pvpokeHarness.cjs') as { createPvpoke: (dir: string, options?: PvpokeOptions) => PvpokeHarness };

/** Load PvPoke's simulator, with gbl-lab's corrections applied (the engine's oracle) or unmodified. */
export function loadPvpoke(variant: 'corrected' | 'unmodified' = 'corrected'): PvpokeHarness {
  return createPvpoke('.cache/pvpoke/src', variant === 'corrected' ? { formChangeCorrections: FORM_CHANGE_CORRECTIONS } : {});
}
```

In `scripts/gen-oracle.ts`, `scripts/gen-decision-oracle.ts`, `scripts/gen-iv-oracle.ts` and `tests/pvpokeDecide.test.ts`:
- delete the `createRequire` import, the `const require = …` line and the `const { createPvpoke } = require(…)` line;
- replace `createPvpoke('.cache/pvpoke/src')` with `loadPvpoke()`;
- add `import { loadPvpoke } from './oracle/load';` (from `'../scripts/oracle/load'` in the test).

Remove `PvpokeHarness` from a file's type imports only if it's no longer used there.

In `scripts/compare-oracle.ts`, do the same inside the `if (process.argv[1] …)` block: replace its `require`/`createPvpoke` lines with `const pvpoke = loadPvpoke();`, add the import, and drop `createRequire` if it's no longer used.

Run: `npm test && npm run typecheck`
Expected: all pass. The corrected harness differs from the unmodified one only for Morpeko, which no existing case uses.

- [ ] **Step 2: Write the failing tests**

In `tests/pvpokeDecide.test.ts`, add to `CASES` before the closing `];`:

```ts
  // Form changes (form-changes spec §4-§6): Mimikyu's Disguise, the opponent's "break the disguise" rule, Morpeko's switch.
  [{ speciesId: 'mimikyu', moveset: ['SHADOW_CLAW', 'SHADOW_SNEAK', 'PLAY_ROUGH'] }, { speciesId: 'azumarill', moveset: ['BUBBLE', 'ICE_BEAM', 'PLAY_ROUGH'] }, [0, 0]],
  [{ speciesId: 'azumarill', moveset: ['BUBBLE', 'ICE_BEAM', 'PLAY_ROUGH'] }, { speciesId: 'mimikyu', moveset: ['SHADOW_CLAW', 'SHADOW_SNEAK', 'PLAY_ROUGH'] }, [2, 0]],
  [{ speciesId: 'mimikyu', moveset: ['SHADOW_CLAW', 'SHADOW_SNEAK', 'PLAY_ROUGH'] }, { speciesId: 'medicham', moveset: ['COUNTER', 'ICE_PUNCH', 'PSYCHIC'] }, [1, 1]],
  [{ speciesId: 'morpeko_full_belly', moveset: ['THUNDER_SHOCK', 'AURA_WHEEL_ELECTRIC', 'PSYCHIC_FANGS'] }, { speciesId: 'azumarill', moveset: ['BUBBLE', 'ICE_BEAM', 'PLAY_ROUGH'] }, [0, 0]],
  [{ speciesId: 'morpeko_full_belly', moveset: ['THUNDER_SHOCK', 'AURA_WHEEL_ELECTRIC', 'PSYCHIC_FANGS'] }, { speciesId: 'medicham', moveset: ['COUNTER', 'ICE_PUNCH', 'PSYCHIC'] }, [1, 1]],
  [{ speciesId: 'morpeko_full_belly', moveset: ['THUNDER_SHOCK', 'AURA_WHEEL_ELECTRIC', 'PSYCHIC_FANGS'] }, { speciesId: 'mimikyu', moveset: ['SHADOW_CLAW', 'SHADOW_SNEAK', 'PLAY_ROUGH'] }, [1, 1]],
```

Add these imports at the top of the test file:

```ts
import { createBattle, type BattleState, type Side, type SideState } from '../src/engine/state';
import { decide } from '../src/policy/pvpoke/decide';
```

Add a new `describe` block at the end of the file:

```ts
describe("PvPoke ActionLogic.js:236-252: break the opponent's disguise", () => {
  const rules = { maxBuffStages: gd.maxBuffStages, buffDivisor: gd.buffDivisor };
  const azu = { speciesId: 'azumarill', fastMoveId: 'BUBBLE', chargedMoveIds: ['ICE_BEAM', 'PLAY_ROUGH'] };
  const mim = { speciesId: 'mimikyu', fastMoveId: 'SHADOW_CLAW', chargedMoveIds: ['SHADOW_SNEAK', 'PLAY_ROUGH'] };
  const start = (mimikyuShields: number): BattleState =>
    createBattle([buildCombatant(gd, azu), buildCombatant(gd, mim)], { shields: [1, mimikyuShields], startEnergy: [55, 0] }, rules);
  const patch = (s: BattleState, side: Side, fields: Partial<SideState>): BattleState => {
    const sides: [SideState, SideState] = [s.sides[0], s.sides[1]];
    sides[side] = { ...sides[side], ...fields };
    return { ...s, sides };
  };
  const breaks = (s: BattleState): boolean => {
    const trace: string[] = [];
    decide(s, 0, trace);
    return trace.some((line) => line.includes("to break opponent's ability as soon as possible"));
  };

  it('throws the fastest charged move at a disguised Mimikyu with no shields', () => {
    const trace: string[] = [];
    const decision = decide(start(0), 0, trace);
    expect(trace).toContain("turn 1 side 0: uses Ice Beam to break opponent's ability as soon as possible.");
    expect(decision.action).toEqual({ type: 'charged', index: 0 });
  });

  it('does not fire while Mimikyu has a shield, or once it is busted', () => {
    expect(breaks(start(1))).toBe(false);
    expect(breaks(patch(start(0), 1, { formId: 'mimikyu_busted' }))).toBe(false);
  });
});
```

In `tests/pvpokeMoveMeta.test.ts`, change `orderChargedMoves(me, st.sides[0], st.rules.buffDivisor)` to `orderChargedMoves(me, st.sides[0].moveOrderBasis, st.rules.buffDivisor)`. Make the same change at any other `orderChargedMoves(` call in that file (`grep -n "orderChargedMoves(" tests/pvpokeMoveMeta.test.ts`).

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/pvpokeDecide.test.ts tests/pvpokeMoveMeta.test.ts`
Expected: FAIL. The break-the-disguise trace line is missing, `orderChargedMoves` gets a type error on the new second argument, and some form-change matchups disagree with PvPoke on charged turns or ratings.

- [ ] **Step 4: Order moves from the basis**

In `src/policy/pvpoke/moveMeta.ts`, change the doc comment's last line and the signature of `orderChargedMoves`:

```ts
/**
 * Order a side's charged moves and pick its best and fastest move, as PvPoke Pokemon.resetMoves does.
 * `basis` is the per-slot damage when resetMoves last ran: at Battle.start and at each form change (SideState.moveOrderBasis).
 */
export function orderChargedMoves(
  c: Combatant, basis: readonly number[], buffDivisor: number,
): { active: ChargedMove[]; best: ChargedMove | null; fastest: ChargedMove | null } {
```

In its body, change `const damage = s.lastDamage.charged[i];` to `const damage = basis[i];`. Remove the `SideState` import if it's now unused.

- [ ] **Step 5: Make the views form-aware**

In `src/policy/pvpoke/view.ts`:
- Change the imports to `import type { Combatant, Form } from '../../engine/combatant';` and `import { activeCombatant, activeForm, other, type BattleState, type Side, type SideState } from '../../engine/state';`. `createBattle` is no longer used.
- Add to `PokeView` after `s`:

```ts
  /** The side's active form, including its form-change rule (PvPoke activeFormId / formChange). */
  readonly form: Form;
```

- Replace `buildView`'s signature and first lines with:

```ts
/** Build one side's view from its active form and its move-order basis. */
function buildView(state: BattleState, side: Side): PokeView {
  const c = activeCombatant(state, side);
  const s = state.sides[side];
  const order = orderChargedMoves(c, s.moveOrderBasis, state.rules.buffDivisor);
```

- Replace the `dpeOf` comment and body with:

```ts
  // PvPoke Pokemon.js:842-846 overwrites every active move's dpe with damage / energy whenever resetMoves runs:
  // at Battle.start and at each form change. Nothing else recomputes it in simulate mode.
  const dpeOf = (move: ChargedMove): number => {
    const damage = s.moveOrderBasis[indexOf(move)];
    if (damage === undefined) throw new PolicyStateError(`${c.species.id}: no move-order damage for ${move.id}`);
    return damage / move.energy;
  };
```

- Delete the now-unused `startDamage` line, and add `form: activeForm(state, side),` to the returned object after `s,`.
- Replace the body of `views` with:

```ts
  return { poke: buildView(state, me), opponent: buildView(state, other(me)) };
```

Update its docstring to `/** Build the PvPoke-shaped views for both sides of a battle, in their active forms. */`.

- [ ] **Step 6: Port the rule**

In `src/policy/pvpoke/decide.ts`, replace the line `// PvPoke ActionLogic.js:236-252 skipped: Mimikyu-style "protect" form change (form changes unsupported).` with:

```ts
  // PvPoke ActionLogic.js:236-252: if the opponent is Mimikyu or has a similar mechanic, throw the fastest charged move ASAP
  if (opponent.form.formChange?.effect === 'protect' && opponent.s.shields === 0) {
    const fastest = poke.fastestChargedMove;
    if (fastest && poke.s.energy >= fastest.energy && !fastest.selfDebuffing) {
      log(() => ` uses ${fastest.name} to break opponent's ability as soon as possible.`);
      return done({ type: 'charged', index: poke.indexOf(fastest) });
    }
  }
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run tests/pvpokeDecide.test.ts tests/pvpokeMoveMeta.test.ts && npm run typecheck`
Expected: PASS, including all six new live PvPoke cases (charged-move turns and ratings identical).

If a live case fails, don't change the case. Use superpowers:systematic-debugging, and compare our event log with `pvpoke.simulate(...).events` turn by turn. The usual suspects are:
- the order of form changes within the turn (spec §4.3)
- the `lastDamage` recompute in `changeForm`
- whether a decision was made before or after the switch

- [ ] **Step 8: Run the full suite and commit**

Run: `npm test`
Expected: all pass.

```bash
git add scripts/oracle src/policy/pvpoke scripts/gen-oracle.ts scripts/gen-decision-oracle.ts scripts/gen-iv-oracle.ts scripts/compare-oracle.ts tests/pvpokeDecide.test.ts tests/pvpokeMoveMeta.test.ts
git commit -m "feat: form-aware PvPoke views and the break-the-disguise rule; oracle harness applies gbl-lab corrections"
```

---

### Task 5: Oracle fixtures — regenerate, add form-change cases, lock parity

**Files:**
- Modify: `scripts/gen-oracle.ts`
- Modify: `scripts/compare-oracle.ts`
- Modify: `scripts/oracle/meta.ts:18` (comment only)
- Modify: `tests/oracle.acceptance.test.ts`
- Create: `tests/formChange.oracle.test.ts`
- Regenerate: `tests/fixtures/engine-oracle.json`, `tests/fixtures/oracle-gl.json`, `tests/fixtures/move-meta-oracle.json`, `tests/fixtures/shield-oracle.json`
- Create (generated): `tests/fixtures/form-change-oracle.json`
- Regenerate: `reports/oracle-report.md`

**Interfaces:**
- Consumes: `loadPvpoke` (Task 4); the full engine (Tasks 1-4).
- Produces:
  - `compareCases(cases: readonly OracleCase[]): OracleSummary` and `type OracleCase = { a: OracleMon; b: OracleMon; shields: [number, number]; ratings: [number, number] }`, exported from `scripts/compare-oracle.ts`
  - Fixture `tests/fixtures/form-change-oracle.json`: `{ upstream: string; corrected: OracleCase[]; unmodified: OracleCase[] }`

- [ ] **Step 1: Write the failing tests**

Create `tests/formChange.oracle.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compareCases, type OracleCase } from '../scripts/compare-oracle';

describe('form changes match the PvPoke oracle (form-changes spec §6.1)', () => {
  const fixture = JSON.parse(readFileSync('tests/fixtures/form-change-oracle.json', 'utf8')) as {
    upstream: string; corrected: OracleCase[]; unmodified: OracleCase[];
  };

  it('covers Mimikyu and Morpeko against the top 100 at all nine shield pairings', () => {
    expect(fixture.corrected.length).toBe(2 * 100 * 9);
    expect(fixture.unmodified.length).toBe(99 * 9);
  });

  it('was generated from the vendored PvPoke commit', () => {
    expect(fixture.upstream).toBe(readFileSync('data/UPSTREAM', 'utf8').trim());
  });

  it('matches corrected PvPoke exactly in every case', () => {
    const summary = compareCases(fixture.corrected);
    expect(summary.exactMatches).toBe(summary.total);
  });

  it('matches unmodified PvPoke exactly for Mimikyu, so the corrections touch only Morpeko', () => {
    const summary = compareCases(fixture.unmodified);
    expect(summary.exactMatches).toBe(summary.total);
  });
});
```

In `tests/oracle.acceptance.test.ts`, add inside the `describe`:

```ts
  it('includes the form changers Mimikyu and Morpeko in the top-100 set', () => {
    const ids = new Set((fixture.cases as { a: { speciesId: string } }[]).map((c) => c.a.speciesId));
    expect(ids.has('mimikyu')).toBe(true);
    expect(ids.has('morpeko_full_belly')).toBe(true);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/formChange.oracle.test.ts tests/oracle.acceptance.test.ts`
Expected: FAIL. `form-change-oracle.json` doesn't exist, `compareCases` isn't exported, and the old fixture doesn't contain Mimikyu or Morpeko.

- [ ] **Step 3: Generalise the comparison**

In `scripts/compare-oracle.ts`, rename `interface Case` to `export interface OracleCase` (update its uses). Split `compareOracle` into:

```ts
/** Run oracle cases through our engine and summarise agreement with PvPoke's recorded ratings. */
export function compareCases(cases: readonly OracleCase[]): OracleSummary {
  const gd = loadDefaultGameData();
  const diffs: OracleDiff[] = cases.map((c) => {
    const r = runOurs(gd, c.a, c.b, c.shields);
    return {
      a: c.a, b: c.b, shields: c.shields, ours: r.ratings, theirs: c.ratings,
      diff: Math.abs(r.ratings[0] - c.ratings[0]), winnerAgrees: sign(r.ratings) === sign(c.ratings),
    };
  });
  const sorted = diffs.map((d) => d.diff).sort((x, y) => x - y);
  return {
    total: diffs.length,
    winnerAgreement: diffs.filter((d) => d.winnerAgrees).length / diffs.length,
    medianAbsRatingDiff: sorted[Math.floor(sorted.length / 2)] ?? 0,
    exactMatches: diffs.filter((d) => d.ours[0] === d.theirs[0] && d.ours[1] === d.theirs[1]).length,
    worst: [...diffs].sort((x, y) => Number(x.winnerAgrees) - Number(y.winnerAgrees) || y.diff - x.diff).slice(0, 20),
  };
}

/** Run every default-policy oracle case through our engine and summarise agreement with PvPoke. */
export function compareOracle(): OracleSummary {
  const { cases } = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { cases: OracleCase[] };
  return compareCases(cases);
}
```

This is the existing body, moved into `compareCases`. Delete the old `compareOracle` body.

- [ ] **Step 4: Generate the form-change fixture**

In `scripts/gen-oracle.ts`:
- Import `type PvpokeHarness` from `./oracle/harness` if it isn't already.
- Change `record` to take the harness:

```ts
/** Run one request through a PvPoke harness and keep the request with its outcome. */
function record(harness: PvpokeHarness, req: PvpokeRequest): OracleCase {
  const res = harness.simulate(req);
  return { ...req, ratings: res.ratings, hp: res.hp };
}
```

- Change every existing call `record({ … })` to `record(pvpoke, { … })`.
- Append to the end of the file:

```ts
/** One form changer against every top-100 opponent at all nine shield pairings (form-changes spec §6.1). */
function formChangeCases(harness: PvpokeHarness, meta: OracleMon[], speciesId: string, opponents: OracleMon[]): OracleCase[] {
  const mon = meta.find((m) => m.speciesId === speciesId);
  if (!mon) throw new Error(`${speciesId} is not in the top-100 meta`);
  const cases: OracleCase[] = [];
  for (const opp of opponents) {
    for (const s0 of [0, 1, 2]) {
      for (const s1 of [0, 1, 2]) cases.push(record(harness, { a: mon, b: opp, shields: [s0, s1], mode: 'default' }));
    }
  }
  return cases;
}

const top100 = metaSpecies(gd, 100);
const unmodified = loadPvpoke('unmodified');
const formChange = {
  upstream,
  corrected: [
    ...formChangeCases(pvpoke, top100, 'mimikyu', top100),
    ...formChangeCases(pvpoke, top100, 'morpeko_full_belly', top100),
  ],
  // Unmodified PvPoke must agree for Mimikyu (excluding Morpeko opponents): the corrections touch only Morpeko.
  unmodified: formChangeCases(unmodified, top100, 'mimikyu', top100.filter((m) => m.speciesId !== 'morpeko_full_belly')),
};
writeFileSync('tests/fixtures/form-change-oracle.json', JSON.stringify(formChange));
console.log(`form-change-oracle.json: ${formChange.corrected.length} corrected + ${formChange.unmodified.length} unmodified cases`);
```

In `scripts/oracle/meta.ts`, update the comment on line 18 to `// Unsupported (Aegislash, Cramorant, megas, etc.) - excluded from the oracle set by design (engine spec §10).`

- [ ] **Step 5: Regenerate every fixture from PvPoke**

Run: `npm run gen-oracle && npm run gen-decision-oracle`
Expected output includes `oracle-gl.json: 15150 cases` and `form-change-oracle.json: 1800 corrected + 891 unmodified cases`. Mimikyu and Morpeko are no longer logged as excluded.

Run: `git diff --stat tests/fixtures`
Expected: `engine-oracle.json`, `oracle-gl.json`, `move-meta-oracle.json` and `shield-oracle.json` changed, because the meta sets now include Mimikyu (and Morpeko in the top 100), and `form-change-oracle.json` is new.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/formChange.oracle.test.ts tests/oracle.acceptance.test.ts tests/engineOracle.test.ts tests/pvpokeMoveMeta.test.ts tests/pvpokeShield.test.ts`
Expected: PASS, with every exact-parity assertion holding.

If any comparison fails, don't touch the fixtures or the assertions. Run `npm run compare-oracle`, read `reports/oracle-report.md` (the worst cases, with both event logs side by side), and use superpowers:systematic-debugging on the engine or the policy. Fix in Task 3 or 4 code, then rerun.

- [ ] **Step 7: Full suite, report, commit**

Run: `npm test && npm run typecheck && npm run compare-oracle`
Expected: all pass. The report header shows `Cases: 15150` and `Exact matches (both ratings identical): 15150`.

```bash
git add scripts tests reports
git commit -m "test: regenerate PvPoke oracles with Mimikyu and Morpeko; add form-change oracle (corrected and unmodified)"
```

---

### Task 6: CLI trace, documentation, final verification

**Files:**
- Modify: `scripts/sim.ts` (`formatTimeline`, lines 16-26)
- Test: `tests/simCli.test.ts`
- Create: `docs/decisions/0003-correct-pvpoke-where-wrong.md`
- Modify: `README.md` (`Oracle results` and `Known exclusions` sections)
- Modify: `docs/superpowers/specs/2026-10-15-battle-engine-design.md` (§10, the "Out of scope for this sub-project: form-changing Pokémon…" bullet)
- Modify: `docs/superpowers/specs/2026-10-15-form-changes-design.md` (Status line)
- Modify: `docs/known-game-differences.md` (only if the port found new differences)

**Interfaces:**
- Consumes: the `disguise` and `formChange` events (Task 3).

- [ ] **Step 1: Write the failing CLI test**

Add to `tests/simCli.test.ts`, with the needed imports at the top (`formatTimeline` from `../scripts/sim`, `loadDefaultGameData` from `../src/data/node`, `buildCombatant` from `../src/engine/combatant`, `PvPokeLikePolicy` from `../src/policy/pvpoke`, `runMatchup` from `../src/sim/runMatchup`). Skip any that are already imported.

```ts
it('prints disguise and form-change events in the timeline', () => {
  const gd = loadDefaultGameData();
  const azu = buildCombatant(gd, { speciesId: 'azumarill', fastMoveId: 'BUBBLE', chargedMoveIds: ['ICE_BEAM', 'PLAY_ROUGH'] });
  const mim = buildCombatant(gd, { speciesId: 'mimikyu', fastMoveId: 'SHADOW_CLAW', chargedMoveIds: ['SHADOW_SNEAK', 'PLAY_ROUGH'] });
  const result = runMatchup(gd, azu, mim, { shields: [0, 0], policies: [new PvPokeLikePolicy(), new PvPokeLikePolicy()] });
  const names = new Map([...gd.moves.values()].map((m) => [m.id, m.name]));
  const out = formatTimeline(result, ['Azumarill', 'Mimikyu'], names);
  expect(out).toMatch(/Mimikyu disguise blocked \d+/);
  expect(out).toContain('Mimikyu changes form: mimikyu -> mimikyu_busted');
});
```

Run: `npx vitest run tests/simCli.test.ts`
Expected: FAIL. Neither line is printed yet.

- [ ] **Step 2: Print the events**

In `scripts/sim.ts`, inside `formatTimeline`'s event loop, add after the `charged` line:

```ts
    if (e.kind === 'disguise') lines.push(`${t} ${who} disguise blocked ${e.blockedDamage}`);
    if (e.kind === 'formChange') lines.push(`${t} ${who} changes form: ${e.from} -> ${e.to}`);
```

Run: `npx vitest run tests/simCli.test.ts`
Expected: PASS.

If the regex fails because `who` is formatted differently (e.g. padded), read the existing `charged` line's format in `formatTimeline` and change the test to match that format. The test must still require both events to appear.

- [ ] **Step 3: Write ADR 0003**

Create `docs/decisions/0003-correct-pvpoke-where-wrong.md`:

```markdown
# 0003 — Correct PvPoke where it is wrong about the real game

Status: accepted (2026-10-15)

Context: ADR 0002 makes PvPoke's semantics the default, and exact parity with PvPoke is the engine's main correctness check. The user wants the engine to model the game as it is actually played. While adding Morpeko, we found that PvPoke switches it to Hangry once and never back, whereas the game switches it on every charged move.

Decision: PvPoke stays the default. A deviation is allowed only when PvPoke contradicts the real game, backed by sources. Every data deviation is listed in `src/data/corrections.ts` with its reason. The loader applies the list, and the oracle harness patches PvPoke's gamemaster with the same objects (`scripts/oracle/load.ts`), so exact-parity testing continues against a corrected PvPoke. A check against unmodified PvPoke confirms that each correction touches only its own species. Differences we know about but haven't fixed, mostly in decision logic, are tracked in `docs/known-game-differences.md`.

Consequences: Results involving corrected species no longer match pvpoke.com. The README says so. Today the only corrected species is Morpeko. Decision-logic differences (e.g. stale damage estimates) are not corrected under this ADR; they are left to a future decision policy that's allowed to beat PvPoke.
```

- [ ] **Step 4: Update the README, engine spec and spec status**

In `README.md`:
- Under `## Known exclusions`, replace the bullet `- Form-changing Pokémon (Aegislash, Cramorant, Mimikyu, Morpeko) are not supported; the engine rejects them with a typed error.` with:

```markdown
- Mimikyu (Disguise) and Morpeko (Hunger Switch) are supported. Morpeko switches form on every charged move, as in the game. PvPoke leaves it in Hangry, so Morpeko results differ from pvpoke.com (ADR 0003).
- Aegislash, Cramorant and other form changers are not supported; the engine rejects them with a typed error.
- Known differences from the real game, fixed and open, are listed in `docs/known-game-differences.md`.
```

- In `### Oracle results`, update the numbers from the `npm run compare-oracle` output of Task 5, and add the line `- Form changes (tests/fixtures/form-change-oracle.json): 1,800 Mimikyu/Morpeko cases against corrected PvPoke and 891 Mimikyu cases against unmodified PvPoke, all exact.`

In `docs/superpowers/specs/2026-10-15-battle-engine-design.md` §10, append to the bullet that begins `- Out of scope for this sub-project: form-changing Pokémon`:

```markdown
 Mimikyu and Morpeko were added by `2026-10-15-form-changes-design.md`. Aegislash and Cramorant remain unsupported.
```

In `docs/superpowers/specs/2026-10-15-form-changes-design.md`, change `Status: Draft, awaiting review` to `Status: Implemented (2026-10-15)`.

In `docs/known-game-differences.md`, confirm that M1 reads "fixed". If debugging in Tasks 4-5 uncovered any other place where PvPoke and the game disagree, add it as a new row with status `open`.

- [ ] **Step 5: Final verification**

Run: `npm test && npm run typecheck && npm run compare-oracle`
Expected: every test passes (the original ~159 plus the new ones), there are no type errors, and the oracle report shows all cases exact.

Run: `npm run sim -- mimikyu azumarill --shields 0 0 --trace | head -40`
Expected: the timeline shows a `disguise blocked` line followed by `changes form: mimikyu -> mimikyu_busted`. If the CLI's argument syntax differs, check `scripts/sim.ts` `parseArgs` and adjust the command, not the code.

- [ ] **Step 6: Commit**

```bash
git add scripts/sim.ts tests/simCli.test.ts docs README.md
git commit -m "docs: ADR 0003, README and spec updates for form changes; print disguise and form-change events in the CLI"
```

Then use superpowers:finishing-a-development-branch.
