import type { GameData } from '../data/types';
import { GameDataError } from '../errors';
import { simulateCell } from './cell';
import type { MatrixFile } from './matrixData';
import { metaCombatant, type Meta } from './meta';

/** A pair whose two sides' ratings in the mirrored scenario don't add up to 1000. */
export interface MirrorMismatch {
  readonly a: string;
  readonly b: string;
  readonly shields: readonly [number, number];
  /** a's rating vs b at shields [sa, sb]. */
  readonly ab: number;
  /** b's rating vs a at the mirrored shields [sb, sa]. */
  readonly ba: number;
}

/** Simulate every ordered pair of the meta (self-pairs included) into a MatrixFile. */
export function buildMatrixFile(gd: GameData, meta: Meta, upstream: string, onRow?: (done: number, total: number) => void): MatrixFile {
  if (!/^[0-9a-f]{40}$/.test(upstream)) throw new GameDataError(`data/UPSTREAM must be a 40-character commit SHA, got "${upstream}"`);
  const combatants = meta.entries.map((e) => metaCombatant(gd, e));
  const ratings = combatants.map((a, i) => {
    const row = combatants.map((b) => simulateCell(gd, a, b));
    onRow?.(i + 1, combatants.length);
    return row;
  });
  return {
    upstream,
    generatedWith: { metaSize: meta.entries.length, policy: 'pvpoke', startEnergy: [0, 0] },
    meta: meta.entries,
    excluded: meta.excluded,
    ratings,
  };
}

/** List mirrored cells whose ratings differ from summing to 1000 by more than `tolerance` (ratings are floored, so 1 is normal). */
export function mirrorMismatches(file: MatrixFile, tolerance = 1): MirrorMismatch[] {
  const out: MirrorMismatch[] = [];
  const n = file.meta.length;
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      for (let sa = 0; sa < 3; sa++) {
        for (let sb = 0; sb < 3; sb++) {
          // A self-pair's (sa, sb) and (sb, sa) are the same comparison; check it once.
          if (i === j && sa > sb) continue;
          const ab = file.ratings[i]![j]![sa]![sb]!;
          const ba = file.ratings[j]![i]![sb]![sa]!;
          if (Math.abs(ab + ba - 1000) > tolerance) {
            out.push({ a: file.meta[i]!.speciesId, b: file.meta[j]!.speciesId, shields: [sa, sb], ab, ba });
          }
        }
      }
    }
  }
  return out;
}
