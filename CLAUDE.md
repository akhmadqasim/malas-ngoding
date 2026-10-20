# Malas Ngoding

3D energy digital twin of Kalimantan Timur (Bun + React + Mapbox). Spec: `docs/specs/malas-ngoding.md`. Plan: `docs/plans/`. Rules: `.claude/rules/`.

## Commands

- `docker compose up -d` starts PostGIS on host port 5433.
- `bun install`, `bun dev` (hot server on :3000), `bun start`.
- `bun test`, `bun run typecheck`.
- `bun run migrate`, `bun run seed`, `bun run warm`, `bun run setup` (migrate, seed, warm).

## Rules

Read `.claude/rules/conventions.md` before changing code. Secrets live in `.env` (never commit or print it).
