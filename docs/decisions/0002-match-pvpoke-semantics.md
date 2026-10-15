# 0002 — Match PvPoke's simulation semantics exactly

Status: accepted (2026-10-15)

Context: The user's goal is to improve; wrong advice is worse than none. PvPoke is the community reference and is MIT licensed.

Decision: Reproduce PvPoke's mechanics (float32 constants, multiplication order, action queue, buff meter, CMP) and port its decision logic, including quirks such as the per-move "last damage" cache. When our understanding and PvPoke disagree, PvPoke wins. A Node harness running PvPoke's own code produces golden fixtures.

Consequences: Results are comparable with pvpoke.com. Some code mirrors PvPoke's structure rather than an idealised design; such places reference PvPoke file:line.
