# Matchup matrix report

Generated 2026-11-04 by `npm run gen-matrix` from PvPoke commit `e02bde78d19be9b9099b5a6629c6a8d0835a53be`.

- Meta size: 150
- Simulations: 202500
- Elapsed: 75.5 s
- Mirror mismatches (off by more than 1): 59

## Excluded (unsupported) before the meta was full

- aegislash_shield: UnsupportedPokemonError: aegislash_shield: form change (activate_charged -> aegislash_blade) is not modelled yet
- minior_core: UnsupportedPokemonError: minior_core: form change (battle_start -> minior_meteor) is not modelled yet

## Mirror mismatches (first 20)

a's rating vs b at shields sa-sb, and b's rating vs a at sb-sa. These should add up to 1000 (999 after flooring).

| a | b | shields (a-b) | a rating | b rating |
|---|---|---|---|---|
| cramorant | cramorant | 0-0 | 511 | 511 |
| cramorant | cramorant | 0-1 | 492 | 757 |
| cramorant | cramorant | 0-2 | 246 | 757 |
| cramorant | cramorant | 2-2 | 654 | 654 |
| florges | florges | 0-1 | 309 | 722 |
| florges | florges | 1-1 | 550 | 550 |
| sableye_shadow | sableye_shadow | 0-1 | 500 | 744 |
| sableye_shadow | sableye_shadow | 0-2 | 288 | 744 |
| sableye_shadow | sableye_shadow | 1-2 | 340 | 708 |
| sableye_shadow | sableye | 1-0 | 568 | 480 |
| thievul | thievul | 0-0 | 547 | 547 |
| thievul | thievul | 1-1 | 527 | 527 |
| snorlax | snorlax_shadow | 1-1 | 368 | 580 |
| snorlax | snorlax_shadow | 2-2 | 419 | 537 |
| rillaboom | rillaboom | 0-0 | 546 | 546 |
| rillaboom | rillaboom | 0-1 | 399 | 666 |
| rillaboom | rillaboom | 0-2 | 279 | 767 |
| rillaboom | rillaboom | 1-1 | 523 | 523 |
| rillaboom | rillaboom | 1-2 | 414 | 624 |
| rillaboom | dusclops_shadow | 2-2 | 337 | 449 |
