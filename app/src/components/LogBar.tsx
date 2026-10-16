import { useState } from 'preact/hooks';
import type { BattleAction } from '../../../src/companion';

export interface LogBarProps {
  readonly dispatch: (action: BattleAction) => void;
  readonly canUndo: boolean;
  readonly onTheySwitched: () => void;
}

/** One-tap buttons that log what happened in the battle. */
export function LogBar({ dispatch, canUndo, onTheySwitched }: LogBarProps) {
  const [confirming, setConfirming] = useState(false);
  return (
    <section class="screen" aria-label="Log what happened">
      <div class="label">Log what happened</div>
      <div class="logbar">
        <button type="button" class="btn" onClick={() => dispatch({ type: 'iShielded' })}>I shielded</button>
        <button type="button" class="btn" onClick={() => dispatch({ type: 'theyShielded' })}>They shielded</button>
        <button type="button" class="btn" onClick={() => dispatch({ type: 'mineFainted' })}>Mine fainted</button>
        <button type="button" class="btn" onClick={() => { dispatch({ type: 'theirsFainted' }); onTheySwitched(); }}>Theirs fainted</button>
        <button type="button" class="btn" onClick={onTheySwitched}>They switched</button>
        <button type="button" class="btn" disabled={!canUndo} onClick={() => dispatch({ type: 'undo' })}>Undo</button>
      </div>
      {confirming ? (
        <div class="btns">
          <button type="button" class="btn primary" onClick={() => { setConfirming(false); dispatch({ type: 'newBattle' }); }}>Yes, new battle</button>
          <button type="button" class="btn" onClick={() => setConfirming(false)}>Cancel</button>
        </div>
      ) : (
        <button type="button" class="btn" onClick={() => setConfirming(true)}>New battle</button>
      )}
    </section>
  );
}
