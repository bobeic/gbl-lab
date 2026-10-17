import { formatCounts, type MoveAdvice, type MyMoveInfo } from '../../../src/companion';

function typeWord(m: MyMoveInfo): string {
  const words = [
    m.effectiveness > 2 ? 'double super effective' : m.effectiveness > 1 ? 'super effective'
      : m.effectiveness < 0.5 ? 'double resisted' : m.effectiveness < 1 ? 'resisted' : 'neutral',
  ];
  if (m.stab) words.push('STAB');
  return words.join(', ');
}

/** Why the engine's first throw is the right one: harder hit, or cheaper bait. */
function firstThrowLine(moves: readonly MyMoveInfo[], firstId: string | null): string | null {
  const first = moves.find((m) => m.id === firstId);
  if (!first) return null;
  if (moves.length < 2) return `Throw ${first.name}`;
  const hardest = moves.reduce((a, b) => (b.damage > a.damage ? b : a));
  if (hardest === first) return `Throw ${first.name} first: it does the most damage`;
  if (first.energy < hardest.energy) return `Throw ${first.name} first: it's cheaper, so it comes sooner and can bait a shield. ${hardest.name} hits harder`;
  return `Throw ${first.name} first`;
}

/** My on-field Pokémon's charged moves against their Pokémon: damage, type multipliers, side effects. */
export function MovesPanel({ myName, theirName, advice }: { readonly myName: string; readonly theirName: string; readonly advice: MoveAdvice }) {
  const line = firstThrowLine(advice.moves, advice.firstThrow);
  return (
    <section class="me" aria-label="Your moves">
      <div class="label">{myName} vs {theirName}</div>
      {advice.moves.map((m) => (
        <div key={m.id}>
          <div class="row">
            <span>{m.name} <span class="type">{m.energy} energy</span></span>
            <span class="count">{formatCounts(m.counts)}</span>
          </div>
          <p class="small">~{m.percent}% of their HP · {typeWord(m)}{m.effect ? ` · ${m.effect}` : ''}</p>
        </div>
      ))}
      {line && <p><strong>{line}</strong></p>}
    </section>
  );
}
