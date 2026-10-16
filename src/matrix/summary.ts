import { cellFrom, type Cell, type MatrixRow } from './cell';

/** Per-scenario summary of one row: mean rating and how many opponents it beats or loses to. */
export interface RowSummary {
  readonly average: Cell;
  /** Opponents with rating > 500. */
  readonly wins: Cell;
  /** Opponents with rating < 500 (exactly 500 counts as neither). */
  readonly losses: Cell;
}

/** Summarise a row's ratings per shield scenario (no meta weighting). */
export function summarize(row: MatrixRow): RowSummary {
  if (row.cells.length === 0) throw new RangeError(`Row ${row.id} has no opponents to summarise`);
  const per = (f: (ratings: number[]) => number): Cell => cellFrom((sa, sb) => f(row.cells.map((c) => c[sa]![sb]!)));
  return {
    average: per((rs) => Math.round(rs.reduce((sum, r) => sum + r, 0) / rs.length)),
    wins: per((rs) => rs.filter((r) => r > 500).length),
    losses: per((rs) => rs.filter((r) => r < 500).length),
  };
}
