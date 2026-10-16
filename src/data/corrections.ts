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
