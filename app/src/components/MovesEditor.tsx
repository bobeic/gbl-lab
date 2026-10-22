import { useState } from 'preact/hooks';
import type { AppData, MoveOverrides } from '../../../src/companion';
import { moveName } from '../names';

type Moveset = MoveOverrides[string];

/** Set the moveset you actually see on this opponent; PvPoke's stays listed so you can go back to it. */
export function MovesEditor({ app, speciesId, seen, onChange }: {
  readonly app: AppData;
  readonly speciesId: string;
  /** Your moveset for this species, or undefined when using PvPoke's. */
  readonly seen: Moveset | undefined;
  readonly onChange: (moveset: Moveset | null) => void;
}) {
  const pvpoke = app.byId.get(speciesId)?.moveset;
  const species = app.gd.species.get(speciesId);
  const [draft, setDraft] = useState<string[] | null>(null);
  if (!pvpoke || !species) return null;
  const names = (ms: readonly string[]) => ms.map((m) => moveName(app, m)).join(' · ');

  if (!draft) {
    return (
      <div class="row small">
        <span>{seen ? <>Your moves · PvPoke: {names(pvpoke)}</> : 'PvPoke moves'}</span>
        <span>
          <button type="button" class="link" onClick={() => setDraft([...(seen ?? pvpoke), ''].slice(0, 3))}>Change moves</button>
          {seen && <> · <button type="button" class="link" onClick={() => onChange(null)}>Use PvPoke's</button></>}
        </span>
      </div>
    );
  }

  const set = (i: number, id: string) => setDraft(draft.map((m, j) => (j === i ? id : m)));
  const select = (i: number, label: string, ids: readonly string[], optional = false) => (
    <select class="field" aria-label={label} value={draft[i] ?? ''} onChange={(e) => set(i, e.currentTarget.value)}>
      {optional && <option value="">None</option>}
      {ids.map((id) => <option key={id} value={id}>{moveName(app, id)}</option>)}
    </select>
  );
  const save = () => {
    const [fast, ...charged] = draft.filter((m) => m !== '');
    const moveset: Moveset = [fast!, ...new Set(charged)];
    // Saving PvPoke's own moveset just clears the override.
    onChange(moveset.join() === pvpoke.join() ? null : moveset);
    setDraft(null);
  };
  return (
    <div class="chips">
      {select(0, 'Fast move', species.fastMoveIds)}
      {select(1, 'Charged move 1', species.chargedMoveIds)}
      {select(2, 'Charged move 2', species.chargedMoveIds, true)}
      <button type="button" class="btn primary" onClick={save}>Save</button>
      <button type="button" class="btn" onClick={() => setDraft(null)}>Cancel</button>
    </div>
  );
}
