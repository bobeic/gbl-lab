/** The main mid-battle screen. */
export function BattleScreen() {
  return (
    <section class="screen">
      <input class="search" type="search" placeholder="Search opponent…" aria-label="Search opponent" />
      <p class="note">Ratings assume a fresh 1v1 at the current shields. HP and energy aren't tracked.</p>
    </section>
  );
}
