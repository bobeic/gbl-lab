/** PvPoke battle rating: 500 x share of opponent HP removed + 500 x share of own HP left. */
export function battleRating(selfHp: number, selfMaxHp: number, oppHp: number, oppMaxHp: number): number {
  return Math.floor(500 * ((oppMaxHp - oppHp) / oppMaxHp) + 500 * (selfHp / selfMaxHp));
}
