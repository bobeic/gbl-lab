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
  const megaMoves = species.extraChargedMoveIds;
  /** Draft slots: fast, charged 1, charged 2, mega move ('' when empty). */
  const toDraft = (ms: Moveset) => {
    const charged = ms.slice(1).filter((m) => !megaMoves.includes(m));
    return [ms[0], charged[0] ?? '', charged[1] ?? '', ms.slice(1).find((m) => megaMoves.includes(m)) ?? ''];
  };

  if (!draft) {
    return (
      <div class="row small">
        <span>{seen ? <>Your moves · PvPoke: {names(pvpoke)}</> : 'PvPoke moves'}</span>
        <span>
          <button type="button" class="link" onClick={() => setDraft(toDraft(seen ?? pvpoke))}>Change moves</button>
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
    const [fast, c1, c2, mega] = draft;
    const moveset: Moveset = [fast!, ...new Set([c1!, c2!].filter((m) => m !== '')), ...(mega ? [mega] : [])];
    // Saving PvPoke's own moveset just clears the override.
    onChange(moveset.join() === pvpoke.join() ? null : moveset);
    setDraft(null);
  };
  return (
    <div class="chips">
      {select(0, 'Fast move', species.fastMoveIds)}
      {select(1, 'Charged move 1', species.chargedMoveIds)}
      {select(2, 'Charged move 2', species.chargedMoveIds, true)}
      {megaMoves.length > 0 && select(3, 'Mega move', megaMoves, true)}
      <button type="button" class="btn primary" onClick={save}>Save</button>
      <button type="button" class="btn" onClick={() => setDraft(null)}>Cancel</button>
    </div>
  );
}
