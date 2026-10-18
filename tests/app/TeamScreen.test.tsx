// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TeamScreen } from '../../app/src/screens/TeamScreen';
import type { RosterEntry } from '../../src/matrix/teamMatrix';
import { testAppData } from '../companionFixture';

afterEach(cleanup);
const app = testAppData();
const readmeExample = `[{ "speciesId": "azumarill", "fastMoveId": "BUBBLE", "chargedMoveIds": ["ICE_BEAM", "PLAY_ROUGH"],
   "ivs": { "atk": 0, "def": 15, "hp": 15 }, "label": "My Azumarill" }]`;
const entry = (speciesId: string, fastMoveId: string, chargedMoveIds: string[]): RosterEntry => ({ speciesId, fastMoveId, chargedMoveIds });
const three = [
  entry('medicham', 'PSYCHO_CUT', ['ICE_PUNCH', 'DYNAMIC_PUNCH']),
  entry('araquanid', 'INFESTATION', ['WATER_PULSE', 'MIRROR_COAT']),
  entry('azumarill', 'BUBBLE', ['ICE_BEAM', 'PLAY_ROUGH']),
];

function setup(roster: readonly RosterEntry[] = [], team: readonly [number, number, number] | null = null) {
  const onChange = vi.fn();
  render(<TeamScreen app={app} roster={roster} team={team} onChange={onChange} />);
  return onChange;
}

describe('TeamScreen', () => {
  it('defaults a new Pokémon to its ranking moveset and saves it', () => {
    const onChange = setup();
    fireEvent.input(screen.getByPlaceholderText('Search Pokémon…'), { target: { value: 'medicham' } });
    fireEvent.click(screen.getByRole('button', { name: 'Medicham' }));
    expect((screen.getByLabelText('Fast move') as HTMLSelectElement).value).toBe('PSYCHO_CUT');
    expect((screen.getByLabelText('Charged move 1') as HTMLSelectElement).value).toBe('ICE_PUNCH');
    expect((screen.getByLabelText('Charged move 2') as HTMLSelectElement).value).toBe('DYNAMIC_PUNCH');
    fireEvent.click(screen.getByRole('button', { name: 'Save Pokémon' }));
    expect(onChange).toHaveBeenCalledWith([entry('medicham', 'PSYCHO_CUT', ['ICE_PUNCH', 'DYNAMIC_PUNCH'])], null);
  });

  it('shows an inline error and keeps the form when saving an unsupported Pokémon', () => {
    const onChange = setup();
    fireEvent.input(screen.getByPlaceholderText('Search Pokémon…'), { target: { value: 'aegis' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aegislash (Blade)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Pokémon' }));
    expect(screen.getByRole('alert').textContent).toMatch(/UnsupportedPokemonError/);
    expect(screen.getByRole('button', { name: 'Save Pokémon' })).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('rejects importing an unsupported Pokémon and leaves the roster alone', () => {
    const onChange = setup();
    fireEvent.input(screen.getByLabelText('Import roster JSON'), {
      target: { value: '[{"speciesId":"aegislash_shield","fastMoveId":"AEGISLASH_CHARGE_PSYCHO_CUT","chargedMoveIds":["SHADOW_BALL","GYRO_BALL"]}]' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(screen.getByRole('alert').textContent).toMatch(/Aegislash|UnsupportedPokemonError/);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('imports the README roster example as one entry', () => {
    const onChange = setup(three);
    fireEvent.input(screen.getByLabelText('Import roster JSON'), { target: { value: readmeExample } });
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const [roster] = onChange.mock.calls[0]!;
    expect(roster).toHaveLength(4);
    expect(roster[3]).toMatchObject({ speciesId: 'azumarill', label: 'My Azumarill' });
  });

  it('builds the team in pick order and reorders it', () => {
    const onChange = setup(three);
    const list = screen.getByRole('list', { name: 'Your Pokémon' });
    for (const name of ['Araquanid', 'Azumarill', 'Medicham']) {
      fireEvent.click(within(list).getByRole('button', { name: `Add ${name} to team` }));
    }
    expect(onChange).toHaveBeenLastCalledWith(three, [1, 2, 0]);
    cleanup();
    const reorder = setup(three, [1, 2, 0]);
    fireEvent.click(screen.getByRole('button', { name: 'Move Medicham up' }));
    expect(reorder).toHaveBeenLastCalledWith(three, [1, 0, 2]);
  });

  it('exports the roster as JSON', () => {
    setup(three);
    const out = screen.getByLabelText('Roster JSON') as HTMLTextAreaElement;
    expect(JSON.parse(out.value)).toEqual(three);
  });

  it('shows each Pokémon\'s GO icon in the team and the list', () => {
    setup(three, [0, 1, 2]);
    const srcs = (name: string) => [...screen.getByRole('list', { name }).querySelectorAll('img')].map((i) => i.getAttribute('src')?.split('/').pop());
    expect(srcs('Team order')).toEqual(['pm308.icon.png', 'pm752.icon.png', 'pm184.icon.png']);
    expect(srcs('Your Pokémon')).toEqual(['pm308.icon.png', 'pm752.icon.png', 'pm184.icon.png']);
  });
});
