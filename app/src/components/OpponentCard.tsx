import { PokemonIcon } from './PokemonIcon';
import { formatCounts, type OpponentCard as Card } from '../../../src/companion';

/** Their likely moves: the fast move's energy and turns, and each charged move's counts. */
export function OpponentCard({ card }: { readonly card: Card }) {
  return (
    <section class="opp" aria-label="Opponent">
      <div class="row"><span class="name"><PokemonIcon speciesId={card.speciesId} />{card.name}</span><span class="type">{card.types.join(' / ')}</span></div>
      <div class="row">
        <span>{card.fast.name} <span class="type">{card.fast.type}</span></span>
        <span class="small">{card.fast.energyGain} energy / {card.fast.turns} turns</span>
      </div>
      {card.charged.map((c) => (
        <div class="row" key={c.id}>
          <span>{c.name} <span class="type">{c.type} · {c.energy}</span></span>
          <span class="count">{formatCounts(c.counts)}</span>
        </div>
      ))}
    </section>
  );
}
