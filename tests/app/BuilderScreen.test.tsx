// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BuilderScreen, type Simulate } from '../../app/src/screens/BuilderScreen';
import type { Candidate, Diag, SimResult } from '../../src/companion';
import type { RosterEntry } from '../../src/matrix/teamMatrix';
import { testAppData } from '../companionFixture';

afterEach(cleanup);
const app = testAppData();
const META = 12;
const metaIds = app.ranked.slice(0, META).map((r) => r.speciesId);
const entry = (speciesId: string): RosterEntry => ({ speciesId, fastMoveId: 'X', chargedMoveIds: ['Y'] });
const roster = ['medicham', 'azumarill', 'registeel', 'lanturn'].map(entry);

/** A candidate that beats the given meta opponents in every scenario; opponent 11 beats everyone. */
function cand(index: number, dex: number, beats: number[]): Candidate {
  const ratings = Array.from({ length: META }, (_, o): Diag => (o === META - 1 ? [100, 100, 100] : beats.includes(o) ? [600, 600, 600] : [400, 400, 400]));
  return { index, dex, ratings };
}
const four = [cand(0, 308, [0, 1, 2]), cand(1, 184, [3, 4]), cand(2, 379, [5, 6, 7]), cand(3, 171, [8])];

function fake(result: SimResult): Simulate {
  return async (r, onProgress) => {
    onProgress(r.length, r.length);
    return { ...result, metaIds };
  };
}

function setup(simulate: Simulate, r: readonly RosterEntry[] = roster, team: readonly [number, number, number] | null = null) {
  const onUseTeam = vi.fn();
  const view = render(<BuilderScreen app={app} roster={r} team={team} simulate={simulate} onUseTeam={onUseTeam} />);
  return { onUseTeam, view };
}

const rows = async () => within(await screen.findByRole('list', { name: 'Best teams' })).getAllByRole('listitem');

describe('BuilderScreen', () => {
  it("ranks teams and shows the selected team's roles, scores and threats", async () => {
    setup(fake({ candidates: four, skipped: [] }));
    expect((await rows()).length).toBe(4);
    const details = screen.getByRole('region', { name: 'Selected team' });
    for (const role of ['Lead', 'Safe switch', 'Closer']) expect(within(details).getByText(role)).toBeTruthy();
    expect(within(details).getByText(/^\d+ of 12 meta opponents beaten by someone in their role$/)).toBeTruthy();
    const threats = within(details).getByRole('list', { name: 'Threats' });
    expect(threats.textContent).toContain(app.ranked[META - 1]!.name);
  });

  it('use this team sends the order', async () => {
    const { onUseTeam } = setup(fake({ candidates: four, skipped: [] }));
    await rows();
    fireEvent.click(screen.getByRole('button', { name: 'Use this team' }));
    expect(onUseTeam).toHaveBeenCalledTimes(1);
    const order = onUseTeam.mock.calls[0]![0] as number[];
    expect([...order].sort()).toEqual([0, 1, 2]);
  });

  it('pinning filters the teams', async () => {
    setup(fake({ candidates: four, skipped: [] }));
    await rows();
    fireEvent.change(screen.getByLabelText('Pin a Pokémon'), { target: { value: '2' } });
    const pinned = await rows();
    expect(pinned.length).toBe(3);
    for (const row of pinned) expect(row.textContent).toContain('Registeel');
    expect(screen.getByRole('button', { name: 'Unpin Registeel' })).toBeTruthy();
  });

  it('says no team fits the pins', async () => {
    const shadow = [...roster.slice(0, 3), entry('medicham_shadow')];
    setup(fake({ candidates: [...four.slice(0, 3), cand(3, 308, [8])], skipped: [] }), shadow);
    await rows();
    fireEvent.change(screen.getByLabelText('Pin a Pokémon'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Pin a Pokémon'), { target: { value: '3' } });
    expect(await screen.findByText('No team fits your pins.')).toBeTruthy();
  });

  it('asks for at least 3 usable Pokémon', async () => {
    setup(fake({ candidates: four.slice(0, 2), skipped: [{ name: 'aegislash_shield', reason: 'unsupported' }] }));
    expect(await screen.findByText('Add at least 3 Pokémon you can simulate on the Team tab to get recommendations.')).toBeTruthy();
    expect(screen.getByText('Skipped (can\'t simulate): aegislash_shield')).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Best teams' })).toBeNull();
  });

  it('ignores a stale result after the roster changes', async () => {
    let resolveStale!: (r: Awaited<ReturnType<Simulate>>) => void;
    const simulate = vi.fn<Simulate>()
      .mockImplementationOnce(fake({ candidates: four, skipped: [] }))
      .mockImplementationOnce(() => new Promise((res) => { resolveStale = res; }))
      .mockImplementationOnce(fake({ candidates: four.slice(0, 3), skipped: [] }));
    const { view } = setup(simulate);
    await rows();
    fireEvent.change(screen.getByLabelText('Pin a Pokémon'), { target: { value: '3' } });
    expect(screen.getByRole('button', { name: 'Unpin Lanturn' })).toBeTruthy();

    const longer = [...roster, entry('swampert')];
    view.rerender(<BuilderScreen app={app} roster={longer} team={null} simulate={simulate} onUseTeam={vi.fn()} />);
    const shorter = roster.slice(0, 3);
    view.rerender(<BuilderScreen app={app} roster={shorter} team={null} simulate={simulate} onUseTeam={vi.fn()} />);
    expect((await rows()).length).toBe(1);

    resolveStale({ candidates: [...four, cand(4, 260, [9])], skipped: [], metaIds });
    await new Promise((r) => setTimeout(r, 0));
    expect((await rows()).length).toBe(1);
    expect(screen.queryByRole('button', { name: /^Unpin/ })).toBeNull();
  });

  it('never draws the old result or pins against a shorter roster', async () => {
    const simulate = vi.fn<Simulate>()
      .mockImplementationOnce(fake({ candidates: four, skipped: [] }))
      .mockImplementationOnce(() => new Promise(() => {}));
    const { view } = setup(simulate);
    await rows();
    fireEvent.change(screen.getByLabelText('Pin a Pokémon'), { target: { value: '3' } });
    view.rerender(<BuilderScreen app={app} roster={roster.slice(0, 3)} team={null} simulate={simulate} onUseTeam={vi.fn()} />);
    expect(screen.getByText('Simulating 0 of 3…')).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Best teams' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Unpin/ })).toBeNull();
  });
});
