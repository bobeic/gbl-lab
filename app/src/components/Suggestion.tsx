import type { ShieldAdvice, StaySwitch } from '../../../src/companion';

export interface SuggestionProps {
  readonly stay: StaySwitch;
  readonly shield: ShieldAdvice;
  readonly nameOf: (slot: number) => string;
  readonly moveName: (moveId: string) => string;
  readonly onSwitched: (slot: number) => void;
  readonly onStayed: () => void;
}

function shieldLine(a: ShieldAdvice, moveName: (id: string) => string): string | null {
  switch (a.kind) {
    case 'none': return null;
    case 'close': return 'Shield call is close';
    case 'shield': return `Shield their first ${moveName(a.moveId)}`;
    case 'let-through': return `Let their first ${moveName(a.moveId)} through`;
  }
}

/** Stay or switch, plus what to do with their first charged move, with one-tap confirmation. */
export function Suggestion({ stay, shield, nameOf, moveName, onSwitched, onStayed }: SuggestionProps) {
  const line = shieldLine(shield, moveName);
  return (
    <section class="hint" aria-label="Suggestion">
      {stay.kind === 'switch' && (
        <>
          <div class="name">Losing ({stay.fromRating}). Switch to {nameOf(stay.to)} ({stay.toRating})</div>
          <div class="btns">
            <button type="button" class="btn primary" onClick={() => onSwitched(stay.to)}>Switched to {nameOf(stay.to)}</button>
            <button type="button" class="btn" onClick={onStayed}>Stayed in</button>
          </div>
        </>
      )}
      {stay.kind === 'stay' && <div class="name">Stay in with {nameOf(stay.slot)} ({stay.rating})</div>}
      {line && (
        <div>
          <div>{line}</div>
          {shield.kind !== 'none' && <div class="small">If you shield: {shield.shieldRating} · If you don't: {shield.noShieldRating}</div>}
        </div>
      )}
    </section>
  );
}
