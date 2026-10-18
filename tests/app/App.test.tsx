// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../app/src/App';
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
    expect(await screen.findByText('Your collection (from Team tab): 0 Pokémon')).toBeTruthy();
  });

  it('reports a failed data load', async () => {
    render(<App fetchData={() => Promise.reject(new Error('offline'))} store={null} />);
    expect(await screen.findByText(/Couldn't load game data/)).toBeTruthy();
    expect(screen.getByText(/offline/)).toBeTruthy();
  });
});
