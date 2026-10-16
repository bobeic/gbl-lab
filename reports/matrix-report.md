# Matchup matrix report

Generated 2026-10-16 by `npm run gen-matrix` from PvPoke commit `a23fb293300077028a65da534c73bd6367b7ef9d`.

- Meta size: 150
- Simulations: 202500
- Elapsed: 69.1 s
- Mirror mismatches (off by more than 1): 61

## Excluded (unsupported) before the meta was full

- cramorant: UnsupportedPokemonError: cramorant: form change (charged_move -> variable) is not modelled yet
- aegislash_shield: UnsupportedPokemonError: aegislash_shield: form change (activate_charged -> aegislash_blade) is not modelled yet

## Mirror mismatches (first 20)

a's rating vs b at shields sa-sb, and b's rating vs a at sb-sa. These should add up to 1000 (999 after flooring).

| a | b | shields (a-b) | a rating | b rating |
|---|---|---|---|---|
| florges | florges | 0-1 | 309 | 722 |
| florges | florges | 1-1 | 550 | 550 |
| thievul | thievul | 0-0 | 547 | 547 |
| thievul | thievul | 1-1 | 527 | 527 |
| sableye_shadow | sableye_shadow | 0-1 | 500 | 744 |
| sableye_shadow | sableye_shadow | 0-2 | 288 | 744 |
| sableye_shadow | sableye_shadow | 1-2 | 340 | 708 |
| sableye_shadow | sableye | 1-0 | 568 | 480 |
| snorlax | snorlax_shadow | 1-1 | 368 | 580 |
| snorlax | snorlax_shadow | 2-2 | 419 | 537 |
| electrode_hisuian | pelipper | 0-0 | 726 | 213 |
| rillaboom | rillaboom | 0-0 | 546 | 546 |
| rillaboom | rillaboom | 0-1 | 399 | 666 |
| rillaboom | rillaboom | 0-2 | 279 | 767 |
| rillaboom | rillaboom | 1-1 | 523 | 523 |
| rillaboom | rillaboom | 1-2 | 414 | 624 |
| rillaboom | dusclops_shadow | 2-2 | 337 | 449 |
| forretress_shadow | forretress_shadow | 1-1 | 519 | 519 |
| forretress_shadow | forretress_shadow | 1-2 | 316 | 722 |
| forretress_shadow | forretress | 0-0 | 519 | 519 |
