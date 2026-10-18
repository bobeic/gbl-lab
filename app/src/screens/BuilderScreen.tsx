import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { recommendTeams, type AppData, type SavedApp, type SimResult, type TeamScore } from '../../../src/companion';
import type { RosterEntry } from '../../../src/matrix/teamMatrix';
import { PokemonIcon } from '../components/PokemonIcon';
import { entryName, errorText, speciesName } from '../names';

export type Simulate = (
  roster: readonly RosterEntry[], onProgress: (done: number, total: number) => void,
) => Promise<SimResult & { readonly metaIds: readonly string[] }>;

export interface BuilderScreenProps {
  readonly app: AppData;
  readonly roster: readonly RosterEntry[];
  readonly team: SavedApp['team'];
  readonly simulate: Simulate;
  readonly onUseTeam: (team: readonly [number, number, number]) => void;
}

type Sim =
  | { status: 'running'; done: number; total: number }
  | { status: 'error'; message: string }
  | { status: 'done'; result: Awaited<ReturnType<Simulate>> };

const ROLES = ['Lead', 'Safe switch', 'Closer'] as const;
const ROLE_SHIELDS = ['1-1', '1-1', '0-0'] as const;
const SHOWN_THREATS = 8;

function Details({ app, roster, team, sel, metaIds, onUseTeam }: {
  readonly app: AppData; readonly roster: readonly RosterEntry[]; readonly team: SavedApp['team'];
  readonly sel: TeamScore; readonly metaIds: readonly string[]; readonly onUseTeam: BuilderScreenProps['onUseTeam'];
}) {
  const current = team !== null && team.every((t, i) => t === sel.order[i]);
  const threats = sel.threats.slice(0, SHOWN_THREATS);
  return (
    <section class="screen" aria-label="Selected team">
      <div class="roles">
        {sel.order.map((i, role) => (
          <div key={i} class="me">
            <span class="label">{ROLES[role]}</span>
            <span class="name"><PokemonIcon speciesId={roster[i]!.speciesId} />{entryName(app, roster[i]!)}</span>
            <span class="small">wins {sel.roleWins[role]} of {metaIds.length} at {ROLE_SHIELDS[role]}</span>
          </div>
        ))}
      </div>
      <div class="scale">
        <span class="label">Coverage {Math.round(sel.coverage)}</span>
        <span class="small">{sel.covered} of {metaIds.length} meta opponents beaten by someone in their role</span>
        <span class="label">Consistency {Math.round(sel.consistency)}</span>
        <span class="small">{Math.round(sel.consistency)}% of those wins still hold at 0-0 and 2-2 shields</span>
        <span class="label">Safety {Math.round(sel.safety)}</span>
        <span class="small">{sel.safeCounters} hard counters to the safe switch · {sel.topUncovered} of the top 10 uncovered</span>
      </div>
      <h3 class="label">Threats</h3>
      {threats.length === 0 ? <p class="small">None</p> : (
        <ul class="threats" aria-label="Threats">
          {threats.map((o) => <li key={o}><PokemonIcon speciesId={metaIds[o]!} />{speciesName(app, metaIds[o]!)}</li>)}
        </ul>
      )}
      <button type="button" class="btn primary" disabled={current} onClick={() => onUseTeam(sel.order)}>
        {current ? 'Your current team' : 'Use this team'}
      </button>
    </section>
  );
}

/** Recommend the best teams of three from the roster, simulated off the main thread by `simulate`. */
export function BuilderScreen({ app, roster, team, simulate, onUseTeam }: BuilderScreenProps) {
  const [sim, setSim] = useState<Sim>({ status: 'running', done: 0, total: roster.length });
  const [pins, setPins] = useState<readonly number[]>([]);
  const [selected, setSelected] = useState(0);
  const latest = useRef(roster);

  useEffect(() => {
    latest.current = roster;
    setSim({ status: 'running', done: 0, total: roster.length });
    setPins([]);
    setSelected(0);
    const live = () => latest.current === roster;
    simulate(roster, (done, total) => live() && setSim({ status: 'running', done, total }))
      .then((result) => live() && setSim({ status: 'done', result }))
      .catch((err: unknown) => live() && setSim({ status: 'error', message: errorText(err) }));
  }, [roster]);

  const candidates = sim.status === 'done' ? sim.result.candidates : [];
  const teams = useMemo(() => recommendTeams(candidates, pins), [candidates, pins]);
  const setPinsAndReset = (next: readonly number[]) => { setPins(next); setSelected(0); };
  const name = (i: number) => entryName(app, roster[i]!);

  let body;
  if (sim.status === 'running') body = <p class="small">Simulating {sim.done} of {sim.total}…</p>;
  else if (sim.status === 'error') body = <p class="error" role="alert">{sim.message}</p>;
  else if (candidates.length < 3) body = <p class="small">Add at least 3 Pokémon you can simulate on the Team tab to get recommendations.</p>;
  else if (teams.length === 0) body = <p class="small">No team fits your pins.</p>;
  else {
    const sel = teams[selected] ?? teams[0]!;
    body = (
      <>
        <ol class="results" aria-label="Best teams">
          {teams.map((t, rank) => (
            <li key={t.order.join()}>
              <button type="button" class={t === sel ? 'result team on' : 'result team'} aria-pressed={t === sel} onClick={() => setSelected(rank)}>
                <span class="count">{rank + 1}</span>
                <span class="members">
                  {t.order.map((i, role) => <span key={i}>{role > 0 && ' → '}<PokemonIcon speciesId={roster[i]!.speciesId} />{name(i)}</span>)}
                </span>
                <span class="rating">{Math.round(t.score)}</span>
              </button>
            </li>
          ))}
        </ol>
        <Details app={app} roster={roster} team={team} sel={sel} metaIds={sim.result.metaIds} onUseTeam={onUseTeam} />
      </>
    );
  }

  return (
    <div class="builder">
      <section class="screen bar-top">
        <p class="small">Your collection (from Team tab): {roster.length} Pokémon</p>
        <div class="chips">
          {pins.map((i) => (
            <span key={i} class="chip">
              <PokemonIcon speciesId={roster[i]!.speciesId} />{name(i)}
              <button type="button" class="btn icon" aria-label={`Unpin ${name(i)}`} onClick={() => setPinsAndReset(pins.filter((p) => p !== i))}>✕</button>
            </span>
          ))}
          {/* Only simulated entries can be pinned: a skipped one would make every team impossible. */}
          <select class="field" aria-label="Pin a Pokémon" value="" disabled={pins.length >= 3}
            onChange={(e) => { const v = e.currentTarget.value; if (v !== '') setPinsAndReset([...pins, Number(v)]); }}>
            <option value="">Pin a Pokémon…</option>
            {candidates.filter((c) => !pins.includes(c.index)).map((c) => <option key={c.index} value={String(c.index)}>{name(c.index)}</option>)}
          </select>
        </div>
        {sim.status === 'done' && sim.result.skipped.length > 0 && (
          <p class="note">Skipped (can't simulate): {sim.result.skipped.map((s) => s.name).join(', ')}</p>
        )}
      </section>
      {body}
    </div>
  );
}
