/** A short static explanation of the 0-1000 battle rating. */
export function RatingExplainer({ onClose }: { readonly onClose: () => void }) {
  return (
    <section class="screen">
      <h2>What the number means</h2>
      <p class="small">PvPoke's battle rating, always from your Pokémon's side, 0 to 1000.</p>
      <div class="scale">
        <span class="rating good">700</span><span>Comfortable win, lots of HP left</span>
        <span class="rating even">500</span><span>Dead even. 450 to 550 is a coin flip</span>
        <span class="rating bad">300</span><span>You lose, but chip them</span>
        <span class="rating bad">100</span><span>Wiped out</span>
      </div>
      <p class="note">Ratings assume a fresh 1v1 at the current shields: HP and energy aren't tracked.</p>
      <button class="btn" type="button" onClick={onClose}>Back</button>
    </section>
  );
}
