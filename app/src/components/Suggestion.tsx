import type { MoveShieldAdvice, StaySwitch } from '../../../src/companion';

export interface SuggestionProps {
  readonly stay: StaySwitch;
  readonly shield: readonly MoveShieldAdvice[];
  readonly nameOf: (slot: number) => string;
  readonly moveName: (moveId: string) => string;
  readonly onSwitched: (slot: number) => void;
  readonly onStayed: () => void;
  readonly onShielded: () => void;
}

const VERDICT: Readonly<Record<MoveShieldAdvice['kind'], string>> = { shield: 'Shield it', 'let-through': 'Let it through', close: 'Close call' };

/** Stay or switch, plus what to do with each charged move they might throw next, with one-tap confirmation. */
export function Suggestion({ stay, shield, nameOf, moveName, onSwitched, onStayed, onShielded }: SuggestionProps) {
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
      {shield.length > 0 && (
        <div>
          <div>{stay.kind === 'switch' ? `After switching to ${nameOf(stay.to)}, if they throw:` : 'If they throw:'}</div>
          {shield.map((a) => (
            <div key={a.moveId}>
              <div class="row">
                <span>{moveName(a.moveId)}{a.expectedFirst && <span class="small"> (likely first)</span>}</span>
                <strong>{VERDICT[a.kind]}</strong>
              </div>
              <div class="small">If you shield: {a.shieldRating} · If you don't: {a.noShieldRating}</div>
            </div>
          ))}
          <div class="btns">
            <button type="button" class={shield.some((a) => a.kind === 'shield') ? 'btn primary' : 'btn'} onClick={onShielded}>Shielded</button>
          </div>
        </div>
      )}
    </section>
  );
}
