// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MovesEditor } from '../../app/src/components/MovesEditor';
import { testFormats } from '../companionFixture';

afterEach(cleanup);
const app = testFormats().halloweenmega;

describe('MovesEditor', () => {
  it("keeps a super mega's mega move in its own slot", () => {
    const onChange = vi.fn();
    render(<MovesEditor app={app} speciesId="greninja_mega" seen={undefined} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Change moves' }));
    expect((screen.getByLabelText('Mega move') as HTMLSelectElement).value).toBe('SURF_PLUS');
    fireEvent.change(screen.getByLabelText('Charged move 2'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onChange).toHaveBeenCalledWith(['WATER_SHURIKEN', 'HYDRO_CANNON', 'SURF_PLUS']);
  });

  it('has no mega move slot for other Pokémon', () => {
    render(<MovesEditor app={app} speciesId="sableye_mega" seen={undefined} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Change moves' }));
    expect(screen.queryByLabelText('Mega move')).toBeNull();
  });
});
