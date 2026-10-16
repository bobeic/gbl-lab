import { ratingBand, type RatingBand } from '../../../src/companion';
import type { Cell } from '../../../src/matrix/cell';

export const BAND_CLASS: Readonly<Record<RatingBand, string>> = { win: 'good', close: 'even', loss: 'bad' };

/** The 3x3 grid of ratings at every shield combination; rows are my shields, columns theirs. */
export function ShieldTable({ cell }: { readonly cell: Cell }) {
  return (
    <table aria-label="Rating at every shield count">
      <thead>
        <tr><th>You ↓ / Them →</th><th>0</th><th>1</th><th>2</th></tr>
      </thead>
      <tbody>
        {cell.map((row, mine) => (
          <tr key={mine}>
            <th>{mine}</th>
            {row.map((r, theirs) => <td key={theirs} class={BAND_CLASS[ratingBand(r)]}>{r}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
