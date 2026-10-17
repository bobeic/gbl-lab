import icons from '../../../data/pogo-icons.json';

const BASE = 'https://raw.githubusercontent.com/PokeMiners/pogo_assets/master/Images/Pokemon%20-%20256x256/Addressable%20Assets/';
const files: Record<string, string> = icons;

/** The species' GO icon URL (shadows use the plain icon), or null when the asset set has none. */
export function iconUrl(speciesId: string): string | null {
  const file = files[speciesId];
  return file ? BASE + file : null;
}

/** A small GO icon, with a purple badge for shadows; a grey circle when there's no icon. Decorative: the name sits beside it. */
export function PokemonIcon({ speciesId }: { readonly speciesId: string }) {
  const url = iconUrl(speciesId);
  return (
    <span class={url ? 'poke-icon' : 'poke-icon blank'}>
      {url && <img src={url} alt="" loading="lazy" onError={(e) => { e.currentTarget.parentElement?.classList.add('blank'); e.currentTarget.remove(); }} />}
      {speciesId.endsWith('_shadow') && <span class="shadow-badge" />}
    </span>
  );
}
