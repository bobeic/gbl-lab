# 0001 — TypeScript, running in the browser

Status: accepted (2026-10-15)

Context: The tool must be usable on a phone without a server; later parts add a web UI and a play-vs-agent mode.

Decision: Write everything in strict TypeScript. The simulator runs in the browser; heavy batch jobs (meta rankings) run offline in Node and ship as static data. Host as a static site.

Consequences: One language, free hosting. If reinforcement learning is ever needed it is trained elsewhere and exported for in-browser inference.
