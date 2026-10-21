import { useState } from 'preact/hooks';
import { defaultRosterEntry, formatEntry, searchSpecies, type AppData, type FormatState } from '../../../src/companion';
import { buildRosterCombatant, parseRoster, type RosterEntry } from '../../../src/matrix/teamMatrix';
import { PokemonIcon } from '../components/PokemonIcon';
import { entryName, errorText, moveName } from '../names';

type Team = FormatState['team'];

export interface TeamScreenProps {
  readonly app: AppData;
  /** The whole shared collection, as saved; only the format's ranked Pokémon are shown. */
  readonly roster: readonly RosterEntry[];
  readonly team: Team;
  readonly onChange: (roster: readonly RosterEntry[], team: Team) => void;
}

/** Pick a Pokémon to add it with its ranking moveset and default IVs. */
function AddPokemon({ app, onSave }: { readonly app: AppData; readonly onSave: (entry: RosterEntry) => string | null }) {
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const results = searchSpecies(app.ranked, query);
  const pick = (speciesId: string) => {
    const message = onSave(defaultRosterEntry(app, speciesId));
    setError(message);
    if (message === null) setQuery('');
  };

  return (
    <div class="screen">
      <h2>Add a Pokémon</h2>
      <input class="search" type="search" placeholder="Search Pokémon…" aria-label="Search Pokémon" value={query} onInput={(e) => setQuery(e.currentTarget.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && results[0]) pick(results[0].speciesId); }} />
      {error && <p class="error" role="alert">{error}</p>}
      <div class="results">
        {results.map((r) => (
          <button key={r.speciesId} type="button" class="result" onClick={() => pick(r.speciesId)}><PokemonIcon speciesId={r.speciesId} />{r.name}</button>
        ))}
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
  const shown = roster.flatMap((e, i) => (app.byId.has(e.speciesId) ? [i] : []));
  const hidden = roster.length - shown.length;
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
          {hidden > 0 && <p class="small">{hidden} of your Pokémon {hidden === 1 ? "isn't" : "aren't"} in {app.format.title} and {hidden === 1 ? 'is' : 'are'} hidden.</p>}
          <ul class="results" aria-label="Your Pokémon">
            {shown.map((i) => {
              const e = formatEntry(app, roster[i]!);
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
