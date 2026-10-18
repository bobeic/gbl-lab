// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { render } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { iconUrl, PokemonIcon } from '../../app/src/components/PokemonIcon';

const icons = JSON.parse(readFileSync('data/pogo-icons.json', 'utf8')) as Record<string, string>;
const matrix = JSON.parse(readFileSync('data/matrix-1500.json', 'utf8')) as { meta: { speciesId: string }[] };

describe('Pokémon GO icons', () => {
  it('has an icon for every meta Pokémon', () => {
    expect(matrix.meta.map((m) => m.speciesId).filter((id) => !icons[id])).toEqual([]);
  });

  it('picks regional and battle-start forms, and the plain icon for shadows', () => {
    expect(icons.stunfisk_galarian).toBe('pm618.fGALARIAN.icon.png');
    expect(icons.marowak_alolan).toBe('pm105.fALOLA.icon.png');
    expect(icons.mimikyu).toBe('pm778.fDISGUISED.icon.png');
    expect(icons.registeel_shadow).toBe('pm379.icon.png');
  });

  it('builds a URL into the PokeMiners assets', () => {
    expect(iconUrl('medicham')).toBe('https://raw.githubusercontent.com/PokeMiners/pogo_assets/master/Images/Pokemon%20-%20256x256/Addressable%20Assets/pm308.icon.png');
    expect(iconUrl('nope')).toBeNull();
  });

  it('renders a shadow badge for shadows and a grey circle when there is no icon', () => {
    const shadow = render(<PokemonIcon speciesId="registeel_shadow" />).container;
    expect(shadow.querySelector('img')?.getAttribute('src')).toBe(iconUrl('registeel'));
    expect(shadow.querySelector('.shadow-badge')).not.toBeNull();
    const missing = render(<PokemonIcon speciesId="nope" />).container;
    expect(missing.querySelector('img')).toBeNull();
    expect(missing.querySelector('.poke-icon.blank')).not.toBeNull();
  });
});
