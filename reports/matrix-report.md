# Matchup matrix report

Generated 2026-10-21 by `npm run gen-matrix` from PvPoke commit `415436c1af47389c299104a83d46be0df5fa5f08`.

- Meta size: 150
- Simulations: 202500
- Elapsed: 39.2 s
- Mirror mismatches (off by more than 1): 67

## Excluded (unsupported) before the meta was full

- aegislash_shield: UnsupportedPokemonError: aegislash_shield: form change (activate_charged -> aegislash_blade) is not modelled yet
- minior_core: UnsupportedPokemonError: minior_core: form change (battle_start -> minior_meteor) is not modelled yet

## Mirror mismatches (first 20)

a's rating vs b at shields sa-sb, and b's rating vs a at sb-sa. These should add up to 1000 (999 after flooring).

| a | b | shields (a-b) | a rating | b rating |
|---|---|---|---|---|
| cramorant | cramorant | 0-0 | 531 | 531 |
| cramorant | cramorant | 0-1 | 416 | 607 |
| cramorant | cramorant | 0-2 | 416 | 607 |
| cramorant | cramorant | 1-1 | 619 | 619 |
| cramorant | cramorant | 1-2 | 619 | 619 |
| cramorant | cramorant | 2-2 | 619 | 619 |
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
