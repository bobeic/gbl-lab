import { useMemo, useRef, useState } from 'preact/hooks';
import {
  formatCounts, movesetInfo, opponentCard, rankSlots, ratingAt, searchSpecies, shieldAdvice, staySwitch, teamCells, typeReason,
  type AppData, type BattleAction, type BattleSnapshot, type BattleState, type OpponentCard as Card, type SavedApp,
} from '../../../src/companion';
import type { Combatant } from '../../../src/engine/combatant';
import type { Cell } from '../../../src/matrix/cell';
import { buildRosterCombatant, type RosterEntry } from '../../../src/matrix/teamMatrix';
import { LogBar } from '../components/LogBar';
import { OpponentCard } from '../components/OpponentCard';
import { Suggestion } from '../components/Suggestion';
import { TeamRow } from '../components/TeamRow';
import { entryName, errorText, moveName } from '../names';

export interface BattleScreenProps {
  readonly app: AppData;
  readonly roster: readonly RosterEntry[];
  readonly team: SavedApp['team'];
  readonly battle: BattleState;
  readonly dispatch: (action: BattleAction) => void;
  readonly onGoToTeam: () => void;
}

interface Member {
  readonly slot: number;
  readonly name: string;
  readonly combatant: Combatant;
  readonly counts: string;
}

type TeamBuild = { ok: true; members: readonly Member[] } | { ok: false; error: string } | null;

function buildTeam(app: AppData, roster: readonly RosterEntry[], team: SavedApp['team']): TeamBuild {
  if (!team) return null;
  try {
    return {
      ok: true,
      members: team.map((index, slot) => {
        const entry = roster[index]!;
        const { charged } = movesetInfo(app.gd, entry.fastMoveId, entry.chargedMoveIds);
        return {
          slot,
          name: entryName(app, entry),
          combatant: buildRosterCombatant(app.gd, entry, index),
          counts: charged.map((c) => `${c.name} ${formatCounts(c.counts)}`).join(' · '),
        };
      }),
    };
  } catch (err) {
    return { ok: false, error: errorText(err) };
  }
}

const pips = (n: number): string => '●'.repeat(n) + '○'.repeat(2 - n);

/** The mid-battle screen: opponent card, my team ranked against it, suggestions and the one-tap log. */
export function BattleScreen({ app, roster, team, battle, dispatch, onGoToTeam }: BattleScreenProps) {
  const [query, setQuery] = useState('');
  const [dismissedAt, setDismissedAt] = useState<BattleSnapshot | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const now = battle.now;

  const built = useMemo(() => buildTeam(app, roster, team), [app, roster, team]);
  const members = built?.ok ? built.members : null;
  // Per-opponent caches, so moving between tabs or logging shields never re-simulates.
  const cards = useMemo(() => new Map<string, Card>(), [app]);
  const cellCache = useMemo(() => new Map<string, Cell[]>(), [members]);

  const currentId = now.current === null ? null : now.opponents[now.current]?.speciesId ?? null;
  let card: Card | null = null;
  if (currentId !== null) {
    card = cards.get(currentId) ?? opponentCard(app, currentId);
    cards.set(currentId, card);
  }
  const opp = card?.combatant ?? null;

  let cells: Cell[] | null = null;
  if (members && opp && card) {
    cells = cellCache.get(card.speciesId) ?? teamCells(app.gd, members.map((m) => m.combatant), opp);
    cellCache.set(card.speciesId, cells);
  }
  const ratings = cells ? cells.map((c) => ratingAt(c, now.myShields, now.theirShields)) : null;

  const onFieldMember = now.onField === null ? null : members?.[now.onField] ?? null;
  const shield = useMemo(
    () => (onFieldMember && opp ? shieldAdvice(app.gd, onFieldMember.combatant, opp, [now.myShields, now.theirShields]) : null),
    [app, onFieldMember, opp, now.myShields, now.theirShields],
  );
  const stay = ratings ? staySwitch(ratings, now.onField, now.fainted) : null;
  const theirsFainted = now.current !== null && (now.opponents[now.current]?.fainted ?? false);
  const showSuggestion = stay !== null && shield !== null && stay.kind !== 'none' && !theirsFainted && dismissedAt !== now;

  const order = members
    ? [...(ratings ? rankSlots(ratings, now.fainted) : members.map((m) => m.slot).filter((s) => !now.fainted[s])),
      ...members.map((m) => m.slot).filter((s) => now.fainted[s])]
    : [];
  const whoIsIn = members && now.awaitingWhoIsIn
    ? (ratings ? rankSlots(ratings, now.fainted) : members.map((m) => m.slot).filter((s) => !now.fainted[s]))
    : [];

  const focusSearch = () => searchRef.current?.focus();
  const results = searchSpecies(app.ranked, query);
  const theirName = card?.name ?? '—';

  return (
    <>
      <div class="bar">
        <span aria-label="My Pokémon on the field">You: {onFieldMember?.name ?? '—'}</span>
        <span class="pips" aria-label="My shields">{pips(now.myShields)}</span>
        <span>Them: {theirName}</span>
        <span class="pips" aria-label="Their shields">{pips(now.theirShields)}</span>
      </div>

      <section class="screen">
        <input
          ref={searchRef}
          class="search"
          type="search"
          placeholder="Search opponent…"
          aria-label="Search opponent"
          autoComplete="off"
          value={query}
          onInput={(e) => setQuery(e.currentTarget.value)}
        />
        {results.length > 0 && (
          <div class="results">
            {results.map((r) => (
              <button key={r.speciesId} type="button" class="result" onClick={() => { dispatch({ type: 'addOpponent', speciesId: r.speciesId }); setQuery(''); }}>
                {r.name}
              </button>
            ))}
          </div>
        )}
        {now.notice && <p class="error" role="status">{now.notice}</p>}
        {now.opponents.length > 0 && (
          <div class="chips">
            {now.opponents.map((o, i) => (
              <button
                key={o.speciesId}
                type="button"
                class={`chip${i === now.current ? ' on' : ''}${o.fainted ? ' fainted' : ''}`}
                aria-pressed={i === now.current}
                onClick={() => dispatch({ type: 'selectOpponent', index: i })}
              >
                {app.byId.get(o.speciesId)?.name ?? o.speciesId}
              </button>
            ))}
          </div>
        )}
        {card && <OpponentCard card={card} />}

        {whoIsIn.length > 0 && members && (
          <section class="hint" aria-label="Who's in?">
            <div class="name">Who's in?</div>
            <div class="btns">
              {whoIsIn.map((slot) => (
                <button key={slot} type="button" class="btn primary" onClick={() => dispatch({ type: 'switchIn', slot })}>
                  {members[slot]!.name}{ratings ? ` (${ratings[slot]})` : ''}
                </button>
              ))}
            </div>
          </section>
        )}

        {showSuggestion && stay && shield && members && (
          <Suggestion
            stay={stay}
            shield={shield}
            nameOf={(slot) => members[slot]!.name}
            moveName={(id) => moveName(app, id)}
            onSwitched={(slot) => dispatch({ type: 'switchIn', slot })}
            onStayed={() => setDismissedAt(now)}
          />
        )}

        <p class="note">Ratings assume a fresh 1v1 at the current shields. HP and energy aren't tracked.</p>

        {built === null && (
          <div class="row">
            <span>Set up your team first</span>
            <button type="button" class="btn" onClick={onGoToTeam}>Set up team</button>
          </div>
        )}
        {built?.ok === false && <p class="error" role="alert">{built.error}</p>}
        {card && !opp && <p class="name">Can't simulate {card.name}</p>}
        {members && (
          <>
            <div class="label">
              {card && opp ? `Your team vs ${card.name}, ${now.myShields}-${now.theirShields} shields` : 'Your team'}
            </div>
            <ul class="results" aria-label="Your team">
              {order.map((slot) => {
                const m = members[slot]!;
                const rating = ratings?.[slot] ?? null;
                return (
                  <TeamRow
                    key={slot}
                    name={m.name}
                    rating={rating}
                    cell={cells?.[slot] ?? null}
                    counts={m.counts}
                    reason={opp && rating !== null ? typeReason(m.combatant, opp, rating) : null}
                    onField={slot === now.onField}
                    fainted={now.fainted[slot] ?? false}
                    onSwitchIn={() => dispatch({ type: 'switchIn', slot })}
                  />
                );
              })}
            </ul>
          </>
        )}
      </section>

      <LogBar dispatch={dispatch} canUndo={battle.past.length > 0} onTheySwitched={focusSearch} />
    </>
  );
}
