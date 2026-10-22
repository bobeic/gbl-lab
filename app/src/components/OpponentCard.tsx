import { PokemonIcon } from './PokemonIcon';
import { formatCounts, type Hit, type OpponentCard as Card } from '../../../src/companion';

/** Their likely moves: the fast move's energy and turns, each charged move's counts and side effects and, with one of mine on the field, each move's damage to it. */
export function OpponentCard({ card, vsMe }: { readonly card: Card; readonly vsMe?: ReadonlyMap<string, Hit> }) {
  return (
    <section class="opp" aria-label="Opponent">
      <div class="row"><span class="name"><PokemonIcon speciesId={card.speciesId} />{card.name}</span><span class="type">{card.types.join(' / ')}</span></div>
      <div class="row">
        <span>{card.fast.name} <span class="type">{card.fast.type}</span></span>
        <span class="small">{card.fast.energyGain} energy / {card.fast.turns} turns</span>
      </div>
      {vsMe?.has(card.fast.id) && <p class="small">{vsMe.get(card.fast.id)!.damage} damage · ~{vsMe.get(card.fast.id)!.percent}% of your HP</p>}
      {card.charged.map((c) => (
        <div key={c.id}>
          <div class="row">
            <span>{c.name} <span class="type">{c.type} · {c.energy}</span></span>
            <span class="count">{formatCounts(c.counts)}</span>
          </div>
          {(vsMe?.has(c.id) || c.effect) && (
            <p class="small">{[vsMe?.has(c.id) && `~${vsMe.get(c.id)!.percent}% of your HP`, c.effect].filter(Boolean).join(' · ')}</p>
          )}
        </div>
      ))}
    </section>
  );
}
