// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../app/src/App';
import { STORAGE_KEY, defaultSavedApp, type KeyValueStore, type SavedApp } from '../../src/companion';
import { testAppDataFile } from '../companionFixture';

afterEach(cleanup);

describe('App', () => {
  it('shows loading, then the battle view with search and the fresh-1v1 line', async () => {
    render(<App fetchData={() => Promise.resolve(testAppDataFile())} store={null} />);
    expect(screen.getByText('Loading…')).toBeTruthy();
    expect(await screen.findByPlaceholderText('Search opponent…')).toBeTruthy();
    expect(screen.getByText(/Ratings assume a fresh 1v1 at the current shields/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Battle' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Team' })).toBeTruthy();
  });

  it('opens the Builder tab', async () => {
    const simulate = () => Promise.resolve({ candidates: [], skipped: [], metaIds: [] });
    render(<App fetchData={() => Promise.resolve(testAppDataFile())} store={null} simulate={simulate} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Builder' }));
    expect(await screen.findByText('Your collection (from Team tab): 0 Pokémon in Great League')).toBeTruthy();
  });

  it("Builder's Use this team saves the team in that order", async () => {
    const roster = ['medicham', 'azumarill', 'registeel'].map((speciesId) => ({ speciesId, fastMoveId: 'X', chargedMoveIds: ['Y'] }));
    const data = new Map([[STORAGE_KEY, JSON.stringify({ ...defaultSavedApp(), roster })]]);
    const store: KeyValueStore = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } };
    // Only the closer (index 0) wins, and only at 0-0, so the best order puts it last.
    const candidates = [
      { index: 0, dex: 308, ratings: [[600, 400, 400]] as const },
      { index: 1, dex: 184, ratings: [[400, 400, 400]] as const },
      { index: 2, dex: 379, ratings: [[400, 400, 400]] as const },
    ];
    const simulate = () => Promise.resolve({ candidates, skipped: [], metaIds: ['swampert'] });
    render(<App fetchData={() => Promise.resolve(testAppDataFile())} store={store} simulate={simulate} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Builder' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Use this team' }));
    const saved = JSON.parse(data.get(STORAGE_KEY)!) as SavedApp;
    expect(saved.byFormat.great.team).toEqual([1, 2, 0]);
    fireEvent.click(screen.getByRole('button', { name: 'Team' }));
    const order = within(screen.getByRole('list', { name: 'Team order' })).getAllByRole('listitem').map((li) => li.textContent);
    expect(order[0]).toContain('Azumarill');
    expect(order[2]).toContain('Medicham');
  });

  it('keeps a separate team per format over one shared collection', async () => {
    const roster = ['medicham', 'azumarill', 'registeel', 'melmetal'].map((speciesId) => ({ speciesId, fastMoveId: 'X', chargedMoveIds: ['Y'] }));
    const data = new Map([[STORAGE_KEY, JSON.stringify({ ...defaultSavedApp(), roster, byFormat: { ...defaultSavedApp().byFormat, great: { ...defaultSavedApp().byFormat.great, team: [0, 1, 2] } } })]]);
    const store: KeyValueStore = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } };
    render(<App fetchData={() => Promise.resolve(testAppDataFile())} store={store} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Team' }));
    expect(within(screen.getByRole('list', { name: 'Team order' })).getAllByRole('listitem')).toHaveLength(3);

    fireEvent.change(screen.getByLabelText('Format'), { target: { value: 'fantasy' } });
    expect(within(screen.getByRole('list', { name: 'Team order' })).queryAllByRole('listitem')).toHaveLength(0);
    const mine = within(screen.getByRole('list', { name: 'Your Pokémon' })).getAllByRole('listitem').map((li) => li.textContent);
    expect(mine.some((t) => t?.includes('Medicham'))).toBe(false);
    expect(mine.some((t) => t?.includes('Melmetal'))).toBe(true);
    expect((JSON.parse(data.get(STORAGE_KEY)!) as SavedApp).format).toBe('fantasy');

    fireEvent.change(screen.getByLabelText('Format'), { target: { value: 'great' } });
    expect(within(screen.getByRole('list', { name: 'Team order' })).getAllByRole('listitem')).toHaveLength(3);
  });

  it('reports a failed data load', async () => {
    render(<App fetchData={() => Promise.reject(new Error('offline'))} store={null} />);
    expect(await screen.findByText(/Couldn't load game data/)).toBeTruthy();
    expect(screen.getByText(/offline/)).toBeTruthy();
  });
});
