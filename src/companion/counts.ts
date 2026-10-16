const MAX_ENERGY = 100;

/** Number of fast moves needed before each of the next `throws` charged moves, carrying leftover energy. */
export function countSequence(energyGain: number, cost: number, throws = 3): number[] {
  if (energyGain <= 0) throw new RangeError(`Fast move energy gain must be positive, got ${energyGain}`);
  if (cost <= 0 || cost > MAX_ENERGY) throw new RangeError(`Charged move cost must be 1-${MAX_ENERGY}, got ${cost}`);
  const seq: number[] = [];
  let energy = 0;
  for (let t = 0; t < throws; t++) {
    let count = 0;
    while (energy < cost) {
      energy = Math.min(MAX_ENERGY, energy + energyGain);
      count++;
    }
    seq.push(count);
    energy -= cost;
  }
  return seq;
}

/** Format a count sequence the way players say it, e.g. "5-4-5". */
export function formatCounts(seq: readonly number[]): string {
  return seq.join('-');
}
