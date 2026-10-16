import { useState } from 'preact/hooks';
import { ratingBand } from '../../../src/companion';
import type { Cell } from '../../../src/matrix/cell';
import { BAND_CLASS, ShieldTable } from './ShieldTable';

export interface TeamRowProps {
  readonly name: string;
  /** null when the opponent can't be simulated or none is picked yet. */
  readonly rating: number | null;
  readonly cell: Cell | null;
  readonly counts: string;
  readonly reason: string | null;
  readonly onField: boolean;
  readonly fainted: boolean;
  readonly onSwitchIn: () => void;
}

/** One of my Pokémon against the current opponent. */
export function TeamRow({ name, rating, cell, counts, reason, onField, fainted, onSwitchIn }: TeamRowProps) {
  const [open, setOpen] = useState(false);
  return (
    <li class={fainted ? 'me fainted' : 'me'}>
      <div class="row">
        <span class="name">{name}{onField ? ' (in)' : ''}{fainted ? ' (fainted)' : ''}</span>
        <span class="btns">
          {rating !== null && <span class={`rating ${BAND_CLASS[ratingBand(rating)]}`}>{rating}</span>}
          {!onField && !fainted && <button type="button" class="btn" aria-label={`Switch in ${name}`} onClick={onSwitchIn}>Switch in</button>}
          {cell && (
            <button type="button" class="btn icon" aria-label={`Shield table for ${name}`} aria-expanded={open} onClick={() => setOpen(!open)}>⋯</button>
          )}
        </span>
      </div>
      <p class="small">{counts}</p>
      {reason && <p class="small">{reason}</p>}
      {open && cell && <ShieldTable cell={cell} />}
    </li>
  );
}
