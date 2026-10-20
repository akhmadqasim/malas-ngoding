# Data rules

- Seed data lives in `data/seed/*.json` and `data/seed/regions.geojson`. Both are committed, so setup works offline.
- Values come from `docs/research/*.md`. `docs/research/gaps-filled.md` (its JSON block) is the main source. Plants come from `grid-and-plants.md`.
- Every record has a `source`. A value with no source is stored with `source: "asumsi"`. Coordinates guessed for a plant also set `approx: true`.
- Region kWh numbers are estimates (`estimated: true`). The UI must label them "perkiraan".
- Boundaries: geoBoundaries gbOpen IDN ADM2 (CC BY 3.0 IGO), filtered to 10 Kaltim regions. Re-run `bun scripts/build-boundaries.ts` (it caches the download in git-ignored `data/cache/`), then `bun run seed`.
- Database: `bun run migrate` applies `db/migrations/*.sql` once each. `bun run seed` upserts all seed files, so it is safe to repeat.
- Add schema changes as a new numbered migration file. Never edit one that has been applied.
- CO2 per region is `kwh_year` times the latest `grid_mix.grid_factor`. It is computed in `src/server/db.ts`, not stored.
