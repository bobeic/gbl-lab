import { useState } from 'preact/hooks';
import { defaultRosterEntry, formatCounts, movesetInfo, searchSpecies, type AppData, type SavedApp } from '../../../src/companion';
import { buildRosterCombatant, parseRoster, type RosterEntry } from '../../../src/matrix/teamMatrix';
import { PokemonIcon } from '../components/PokemonIcon';
import { entryName, errorText, moveName, speciesName } from '../names';

type Team = SavedApp['team'];

export interface TeamScreenProps {
  readonly app: AppData;
  readonly roster: readonly RosterEntry[];
  readonly team: Team;
  readonly onChange: (roster: readonly RosterEntry[], team: Team) => void;
}

interface Draft {
  readonly speciesId: string;
  readonly fastMoveId: string;
  readonly charged1: string;
  readonly charged2: string;
  readonly atk: string;
  readonly def: string;
  readonly hp: string;
  readonly level: string;
  readonly label: string;
}

function draftFor(app: AppData, speciesId: string): Draft {
  const e = defaultRosterEntry(app, speciesId);
  return { speciesId, fastMoveId: e.fastMoveId, charged1: e.chargedMoveIds[0] ?? '', charged2: e.chargedMoveIds[1] ?? '', atk: '', def: '', hp: '', level: '', label: '' };
}

/** Turn the form into a roster entry; blank IVs and level mean "use the defaults". */
function entryFromDraft(d: Draft): RosterEntry {
  const ivText = [d.atk, d.def, d.hp].map((s) => s.trim());
  const filled = ivText.filter((s) => s !== '').length;
  if (filled !== 0 && filled !== 3) throw new Error('Enter all three IVs, or leave all three blank for the default IVs');
  const ivs = filled === 3 ? { atk: Number(ivText[0]), def: Number(ivText[1]), hp: Number(ivText[2]) } : undefined;
  const level = d.level.trim() === '' ? undefined : Number(d.level);
  const label = d.label.trim() === '' ? undefined : d.label.trim();
  return {
    speciesId: d.speciesId,
    fastMoveId: d.fastMoveId,
    chargedMoveIds: [d.charged1, d.charged2].filter((m) => m !== ''),
    ...(ivs && { ivs }),
    ...(level !== undefined && { level }),
    ...(label !== undefined && { label }),
  };
}

function MoveSelect({ app, label, ids, value, optional, onPick }: {
  readonly app: AppData; readonly label: string; readonly ids: readonly string[]; readonly value: string; readonly optional?: boolean; readonly onPick: (id: string) => void;
}) {
  return (
    <label class="small">
      {label}
      <select class="field" aria-label={label} value={value} onChange={(e) => onPick(e.currentTarget.value)}>
        {optional && <option value="">None</option>}
        {ids.map((id) => <option key={id} value={id}>{moveName(app, id)}</option>)}
      </select>
    </label>
  );
}

function AddPokemon({ app, onSave }: { readonly app: AppData; readonly onSave: (entry: RosterEntry) => string | null }) {
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  if (!draft) {
    return (
      <div class="screen">
        <h2>Add a Pokémon</h2>
        <input class="search" type="search" placeholder="Search Pokémon…" aria-label="Search Pokémon" value={query} onInput={(e) => setQuery(e.currentTarget.value)} />
        <div class="results">
          {searchSpecies(app.ranked, query).map((r) => (
            <button key={r.speciesId} type="button" class="result" onClick={() => { setDraft(draftFor(app, r.speciesId)); setQuery(''); setError(null); }}><PokemonIcon speciesId={r.speciesId} />{r.name}</button>
          ))}
        </div>
      </div>
    );
  }

  const species = app.gd.species.get(draft.speciesId);
  const fastIds = species?.fastMoveIds ?? [];
  const chargedIds = species?.chargedMoveIds ?? [];
  let counts: string | null = null;
  try {
    const info = movesetInfo(app.gd, draft.fastMoveId, [draft.charged1, draft.charged2].filter((m) => m !== ''));
    counts = info.charged.map((c) => `${c.name} ${formatCounts(c.counts)}`).join(' · ');
  } catch {
    counts = null;
  }
  const save = () => {
    try {
      const message = onSave(entryFromDraft(draft));
      setError(message);
      if (message === null) setDraft(null);
    } catch (err) {
      setError(errorText(err));
    }
  };
  return (
    <div class="screen">
      <h2>{speciesName(app, draft.speciesId)}</h2>
      <MoveSelect app={app} label="Fast move" ids={fastIds} value={draft.fastMoveId} onPick={(id) => set({ fastMoveId: id })} />
      <MoveSelect app={app} label="Charged move 1" ids={chargedIds} value={draft.charged1} onPick={(id) => set({ charged1: id })} />
      <MoveSelect app={app} label="Charged move 2" ids={chargedIds} value={draft.charged2} optional onPick={(id) => set({ charged2: id })} />
      {counts && <p class="small">{counts}</p>}
      <div class="ivs">
        {(['atk', 'def', 'hp'] as const).map((k) => (
          <label key={k} class="small">
            {k.toUpperCase()} IV
            <input class="field" type="number" inputMode="numeric" min={0} max={15} placeholder="default" value={draft[k]} onInput={(e) => set({ [k]: e.currentTarget.value })} />
          </label>
        ))}
        <label class="small">
          Level
          <input class="field" type="number" inputMode="decimal" min={1} max={50} step={0.5} placeholder="auto" value={draft.level} onInput={(e) => set({ level: e.currentTarget.value })} />
        </label>
      </div>
      <label class="small">
        Label (optional)
        <input class="field" type="text" value={draft.label} onInput={(e) => set({ label: e.currentTarget.value })} />
      </label>
      {error && <p class="error" role="alert">{error}</p>}
      <div class="btns">
        <button type="button" class="btn primary" onClick={save}>Save Pokémon</button>
        <button type="button" class="btn" onClick={() => { setDraft(null); setError(null); }}>Cancel</button>
      </div>
    </div>
  );
}

function ImportExport({ app, roster, onImport }: {
  readonly app: AppData; readonly roster: readonly RosterEntry[]; readonly onImport: (entries: RosterEntry[]) => void;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const json = JSON.stringify(roster, null, 2);

  const doImport = () => {
    try {
      const entries = parseRoster(JSON.parse(text));
      // Validate every entry before touching the roster, so a bad paste changes nothing.
      entries.forEach((e, i) => buildRosterCombatant(app.gd, e, i));
      onImport(entries);
      setText('');
      setError(null);
    } catch (err) {
      setError(errorText(err));
    }
  };
  const copy = (e: Event) => {
    const area = (e.currentTarget as HTMLElement).parentElement?.querySelector('textarea');
    const fallback = () => { area?.select(); };
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(json).then(() => setCopied(true), fallback);
    } else {
      fallback();
    }
  };

  return (
    <div class="screen">
      <h2>Import / export</h2>
      <textarea class="field" aria-label="Import roster JSON" placeholder='[{ "speciesId": "azumarill", "fastMoveId": "BUBBLE", "chargedMoveIds": ["ICE_BEAM", "PLAY_ROUGH"] }]' value={text} onInput={(e) => setText(e.currentTarget.value)} />
      {error && <p class="error" role="alert">{error}</p>}
      <button type="button" class="btn" onClick={doImport} disabled={text.trim() === ''}>Import</button>
      <div class="screen">
        <textarea class="field" aria-label="Roster JSON" readOnly value={json} />
        <button type="button" class="btn" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
    </div>
  );
}

/** Roster and team setup: add Pokémon, pick the 3 for battle (lead first), import or export JSON. */
export function TeamScreen({ app, roster, team, onChange }: TeamScreenProps) {
  const [draftTeam, setDraftTeam] = useState<readonly number[]>([]);
  const picked: readonly number[] = team ?? draftTeam;

  const setPicked = (next: readonly number[], nextRoster: readonly RosterEntry[] = roster) => {
    if (next.length === 3) {
      setDraftTeam([]);
      onChange(nextRoster, [next[0]!, next[1]!, next[2]!]);
    } else {
      setDraftTeam(next);
      if (team !== null || nextRoster !== roster) onChange(nextRoster, null);
    }
  };
  const move = (pos: number, by: -1 | 1) => {
    const next = [...picked];
    [next[pos], next[pos + by]] = [next[pos + by]!, next[pos]!];
    setPicked(next);
  };
  const removeEntry = (index: number) => {
    const nextRoster = roster.filter((_, i) => i !== index);
    const remap = picked.filter((i) => i !== index).map((i) => (i > index ? i - 1 : i));
    if (picked.includes(index)) setPicked(remap, nextRoster);
    else if (team) onChange(nextRoster, [remap[0]!, remap[1]!, remap[2]!]);
    else { setDraftTeam(remap); onChange(nextRoster, null); }
  };
  const addEntry = (entry: RosterEntry): string | null => {
    try {
      buildRosterCombatant(app.gd, entry, roster.length);
    } catch (err) {
      return errorText(err);
    }
    onChange([...roster, entry], team);
    return null;
  };

  return (
    <div class="setup">
      <div class="col">
        <section class="screen">
          <h2>Your team</h2>
          {picked.length === 0 && <p class="small">Pick 3 Pokémon from your list below, lead first.</p>}
          <ol class="results" aria-label="Team order">
            {picked.map((i, pos) => {
              const name = entryName(app, roster[i]!);
              return (
                <li key={i} class="me row">
                  <span class="name"><PokemonIcon speciesId={roster[i]!.speciesId} />{pos === 0 ? `${name} (lead)` : name}</span>
                  <span class="btns">
                    <button type="button" class="btn icon" aria-label={`Move ${name} up`} disabled={pos === 0} onClick={() => move(pos, -1)}>↑</button>
                    <button type="button" class="btn icon" aria-label={`Move ${name} down`} disabled={pos === picked.length - 1} onClick={() => move(pos, 1)}>↓</button>
                    <button type="button" class="btn icon" aria-label={`Remove ${name} from team`} onClick={() => setPicked(picked.filter((p) => p !== i))}>✕</button>
                  </span>
                </li>
              );
            })}
          </ol>
          {picked.length > 0 && picked.length < 3 && <p class="small">Pick {3 - picked.length} more.</p>}
        </section>

        <section class="screen">
          <h2>Your Pokémon</h2>
          {roster.length === 0 && <p class="small">Nothing saved yet. Add a Pokémon or import a roster.</p>}
          <ul class="results" aria-label="Your Pokémon">
            {roster.map((e, i) => {
              const name = entryName(app, e);
              const inTeam = picked.includes(i);
              return (
                <li key={i} class="me">
                  <div class="row">
                    <span class="name"><PokemonIcon speciesId={e.speciesId} />{name}</span>
                    <span class="btns">
                      <button type="button" class="btn" disabled={inTeam || picked.length >= 3} aria-label={`Add ${name} to team`} onClick={() => setPicked([...picked, i])}>
                        {inTeam ? 'In team' : 'Add'}
                      </button>
                      <button type="button" class="btn icon" aria-label={`Delete ${name}`} onClick={() => removeEntry(i)}>🗑</button>
                    </span>
                  </div>
                  <p class="small">
                    {[e.fastMoveId, ...e.chargedMoveIds].map((m) => moveName(app, m)).join(' · ')}
                    {e.ivs ? ` · ${e.ivs.atk}/${e.ivs.def}/${e.ivs.hp}` : ' · default IVs'}
                  </p>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      <div class="col">
        <AddPokemon app={app} onSave={addEntry} />
        <ImportExport app={app} roster={roster} onImport={(entries) => onChange([...roster, ...entries], team)} />
      </div>
    </div>
  );
}
