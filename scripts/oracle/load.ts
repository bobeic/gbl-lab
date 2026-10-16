import { createRequire } from 'node:module';
import { FORM_CHANGE_CORRECTIONS } from '../../src/data/corrections';
import type { PvpokeHarness, PvpokeOptions } from './harness';

const require = createRequire(import.meta.url);
const { createPvpoke } = require('./pvpokeHarness.cjs') as { createPvpoke: (dir: string, options?: PvpokeOptions) => PvpokeHarness };

/** Load PvPoke's simulator, with gbl-lab's corrections applied (the engine's oracle) or unmodified. */
export function loadPvpoke(variant: 'corrected' | 'unmodified' = 'corrected'): PvpokeHarness {
  return createPvpoke('.cache/pvpoke/src', variant === 'corrected' ? { formChangeCorrections: FORM_CHANGE_CORRECTIONS } : {});
}
