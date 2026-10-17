// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/preact';
import { useReducer } from 'preact/hooks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BattleScreen } from '../../app/src/screens/BattleScreen';
import { battleReducer, defaultRosterEntry, initialBattle, type BattleAction, type SavedApp } from '../../src/companion';
import type { RosterEntry } from '../../src/matrix/teamMatrix';
import { testAppData } from '../companionFixture';

afterEach(cleanup);
const app = testAppData();
const entries = (...ids: string[]): RosterEntry[] => ids.map((id) => defaultRosterEntry(app, id));

function Harness({ roster, team, spy }: { roster: readonly RosterEntry[]; team: SavedApp['team']; spy: (a: BattleAction) => void }) {
  const [battle, dispatch] = useReducer(battleReducer, undefined, initialBattle);
  const send = (a: BattleAction) => { spy(a); dispatch(a); };
  return <BattleScreen app={app} roster={roster} team={team} battle={battle} dispatch={send} onGoToTeam={() => {}} />;
}

function setup(roster = entries('araquanid', 'medicham', 'azumarill'), team: SavedApp['team'] = [0, 1, 2]) {
  const spy = vi.fn();
  render(<Harness roster={roster} team={team} spy={spy} />);
  return spy;
}

function pickOpponent(query: string, name: string) {
  fireEvent.input(screen.getByPlaceholderText('Search opponent…'), { target: { value: query } });
  fireEvent.click(screen.getByRole('button', { name }));
}

const teamRows = () => within(screen.getByRole('list', { name: 'Your team' })).getAllByRole('listitem');

describe('BattleScreen', () => {
  it('shows the opponent counts and ranks the team at 2-2', () => {
    setup();
    pickOpponent('mel', 'Melmetal');
    const card = screen.getByRole('region', { name: 'Opponent' });
    expect(card.textContent).toContain('4-4-4');
    expect(card.textContent).toContain('5-5-5');
    expect(card.textContent).toContain('9 energy / 2 turns');
    const rows = teamRows().map((r) => r.textContent ?? '');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatch(/Medicham.*663/);
    expect(rows[1]).toMatch(/Araquanid.*445/);
    expect(rows[2]).toMatch(/Azumarill.*294/);
    expect(screen.getByText(/Ratings assume a fresh 1v1 at the current shields/)).toBeTruthy();
  });

  it('suggests switching to Medicham and confirms the switch with one tap', () => {
    const spy = setup();
    pickOpponent('mel', 'Melmetal');
    const box = screen.getByRole('region', { name: 'Suggestion' });
    expect(box.textContent).toContain('Losing (445). Switch to Medicham (663)');
    fireEvent.click(within(box).getByRole('button', { name: 'Switched to Medicham' }));
    expect(spy).toHaveBeenLastCalledWith({ type: 'switchIn', slot: 1 });
    expect(screen.getByLabelText('My Pokémon on the field').textContent).toContain('Medicham');
  });

  it('logs the suggested shield with one tap', () => {
    const spy = setup();
    pickOpponent('mel', 'Melmetal');
    const box = screen.getByRole('region', { name: 'Suggestion' });
    fireEvent.click(within(box).getByRole('button', { name: 'Shielded' }));
    expect(spy).toHaveBeenLastCalledWith({ type: 'iShielded' });
    expect(screen.getByLabelText('My shields').textContent).toBe('●○');
  });

  it('dismisses the suggestion on Stayed in', () => {
    setup();
    pickOpponent('mel', 'Melmetal');
    fireEvent.click(screen.getByRole('button', { name: 'Stayed in' }));
    expect(screen.queryByRole('region', { name: 'Suggestion' })).toBeNull();
  });

  it('drops the suggestion once their Pokémon has fainted', () => {
    setup();
    pickOpponent('mel', 'Melmetal');
    fireEvent.click(screen.getByRole('button', { name: 'Theirs fainted' }));
    expect(screen.queryByRole('region', { name: 'Suggestion' })).toBeNull();
  });

  it('never takes my shields below 0', () => {
    setup();
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole('button', { name: 'I shielded' }));
    expect(screen.getByLabelText('My shields').textContent).toBe('○○');
  });

  it('asks who is in after a faint, and undo brings the Pokémon back', () => {
    setup();
    pickOpponent('mel', 'Melmetal');
    fireEvent.click(screen.getByRole('button', { name: 'Mine fainted' }));
    const prompt = screen.getByRole('region', { name: "Who's in?" });
    expect(within(prompt).getAllByRole('button')).toHaveLength(2);
    expect(within(prompt).getAllByRole('button')[0]!.textContent).toContain('Medicham');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.queryByRole('region', { name: "Who's in?" })).toBeNull();
    expect(screen.getByLabelText('My Pokémon on the field').textContent).toContain('Araquanid');
  });

  it('says it cannot simulate an unsupported opponent and makes no suggestion', () => {
    setup();
    pickOpponent('cramorant', 'Cramorant');
    expect(screen.getByText("Can't simulate Cramorant")).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Suggestion' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Opponent' }).textContent).toMatch(/\d-\d-\d/);
  });

  it('keeps duplicate species apart by slot', () => {
    const spy = setup(entries('azumarill', 'medicham', 'azumarill'), [0, 1, 2]);
    pickOpponent('mel', 'Melmetal');
    expect(teamRows().filter((r) => r.textContent?.includes('Azumarill'))).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Switch in Azumarill' }));
    expect(spy).toHaveBeenLastCalledWith({ type: 'switchIn', slot: 2 });
  });

  it('asks for a team first when none is set, but still shows opponent cards', () => {
    setup([], null);
    expect(screen.getByText('Set up your team first')).toBeTruthy();
    pickOpponent('mel', 'Melmetal');
    expect(screen.getByRole('region', { name: 'Opponent' }).textContent).toContain('4-4-4');
  });

  it('survives a saved opponent that is no longer in the rankings', () => {
    const battle = { ...initialBattle(), now: { ...initialBattle().now, opponents: [{ speciesId: 'gone_from_rankings', fainted: false }], current: 0 } };
    render(<BattleScreen app={app} roster={entries('araquanid', 'medicham', 'azumarill')} team={[0, 1, 2]} battle={battle} dispatch={() => {}} onGoToTeam={() => {}} />);
    expect(screen.getByRole('alert').textContent).toContain('gone_from_rankings');
    expect(screen.getByPlaceholderText('Search opponent…')).toBeTruthy();
  });

  it('confirms before starting a new battle', () => {
    const spy = setup();
    fireEvent.click(screen.getByRole('button', { name: 'New battle' }));
    expect(spy).not.toHaveBeenCalledWith({ type: 'newBattle' });
    fireEvent.click(screen.getByRole('button', { name: 'Yes, new battle' }));
    expect(spy).toHaveBeenLastCalledWith({ type: 'newBattle' });
  });
});
