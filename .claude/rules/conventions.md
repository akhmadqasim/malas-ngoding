# Conventions

- Bun for everything: `bun install`, `bun test`, `bun run`. No Vite, no Express, no Node-only tooling.
- Commits: `type(scope): desc`, lower case, conventional types (`feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `style`). No `Co-Authored-By` trailer and no AI attribution. Branch `main` only.
- Language: UI text in Bahasa Indonesia; code, identifiers and comments in English. Estimated numbers show the label "perkiraan".
- Numbers use the `id-ID` locale, for example `12.345 kWh`, `Rp 23,7 jt`.
- API routes are `/api/...` with no version prefix. Errors are JSON `{ "error": string }` with a proper status code.
- Database: Postgres + PostGIS in Docker on host port **5433**. Never touch the `postgres` container on 5432.
- Env keys (`MAPBOX_TOKEN`, `ANTHROPIC_API_KEY`, `DATABASE_URL`) live in `.env`; `.env.example` documents them.
- Check current docs via Context7 before using a Bun, Mapbox GL JS, Motion or Anthropic SDK API.
