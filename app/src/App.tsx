import { useEffect, useReducer, useState } from 'preact/hooks';
import { loadAppData, loadSaved, save, type AppData, type KeyValueStore } from '../../src/companion';
import { appReducer } from './appState';
import { workerSimulate } from './builderClient';
import { RatingExplainer } from './components/RatingExplainer';
import { BattleScreen } from './screens/BattleScreen';
import { BuilderScreen, type Simulate } from './screens/BuilderScreen';
import { TeamScreen } from './screens/TeamScreen';
import { browserStore } from './storage';

type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; app: AppData };
type View = 'battle' | 'team' | 'builder' | 'explainer';

async function fetchAppData(): Promise<unknown> {
  const res = await fetch(`${import.meta.env.BASE_URL}app-data.json`);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching app-data.json`);
  return res.json();
}

export interface AppProps {
  /** Injectable for tests; defaults to fetching the bundled data file. */
  readonly fetchData?: () => Promise<unknown>;
  /** Injectable for tests; defaults to localStorage when available. */
  readonly store?: KeyValueStore | null;
  /** Injectable for tests (jsdom has no Worker); defaults to the Builder's web worker. */
  readonly simulate?: Simulate;
}

/** Load the game data and saved state, then show the battle or team view. */
export function App({ fetchData = fetchAppData, store = browserStore(), simulate = workerSimulate }: AppProps) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [saved, dispatch] = useReducer(appReducer, store, loadSaved);
  const [view, setView] = useState<View>('battle');

  useEffect(() => {
    let live = true;
    fetchData()
      .then((file) => live && setLoad({ status: 'ready', app: loadAppData(file) }))
      .catch((err: unknown) => live && setLoad({ status: 'error', message: err instanceof Error ? err.message : String(err) }));
    return () => { live = false; };
    // Load once on mount; a new fetchData identity on re-render must not refetch.
  }, []);

  useEffect(() => { save(store, saved); }, [store, saved]);

  if (load.status === 'loading') return <main class="shell"><p class="small">Loading…</p></main>;
  if (load.status === 'error') {
    return (
      <main class="shell">
        <section class="screen">
          <h2>Couldn't load game data</h2>
          <p class="small">{load.message}</p>
        </section>
      </main>
    );
  }

  return (
    <main class="shell">
      <nav class="nav">
        <button type="button" class={view === 'battle' ? 'tab on' : 'tab'} onClick={() => setView('battle')}>Battle</button>
        <button type="button" class={view === 'team' ? 'tab on' : 'tab'} onClick={() => setView('team')}>Team</button>
        <button type="button" class={view === 'builder' ? 'tab on' : 'tab'} onClick={() => setView('builder')}>Builder</button>
        <button type="button" class="link" onClick={() => setView('explainer')}>What the number means</button>
      </nav>
      {view === 'battle' && (
        <BattleScreen
          app={load.app}
          roster={saved.roster}
          team={saved.team}
          battle={saved.battle}
          dispatch={(action) => dispatch({ type: 'battle', action })}
          onGoToTeam={() => setView('team')}
        />
      )}
      {view === 'team' && (
        <TeamScreen app={load.app} roster={saved.roster} team={saved.team} onChange={(roster, team) => dispatch({ type: 'setTeam', roster, team })} />
      )}
      {view === 'builder' && (
        <BuilderScreen
          app={load.app}
          roster={saved.roster}
          team={saved.team}
          simulate={simulate}
          priorities={saved.priorities}
          onPrioritiesChange={(priorities) => dispatch({ type: 'setPriorities', priorities })}
          onUseTeam={(team) => dispatch({ type: 'setTeam', roster: saved.roster, team })}
        />
      )}
      {view === 'explainer' && <RatingExplainer onClose={() => setView('battle')} />}
    </main>
  );
}
