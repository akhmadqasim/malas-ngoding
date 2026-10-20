// Applies db/migrations/*.sql once each, in name order. Run: bun run migrate
import { readdirSync } from "node:fs";
import { sql } from "../src/server/db.ts";

const MIGRATIONS_DIR = new URL("../db/migrations/", import.meta.url);

/** Returns the names of the migrations applied by this call. */
export async function runMigrations(): Promise<string[]> {
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY)`;
  const applied = new Set(
    (await sql`SELECT name FROM schema_migrations`).map((r: { name: string }) => r.name),
  );
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  const done: string[] = [];
  for (const name of files) {
    if (applied.has(name)) continue;
    const text = await Bun.file(new URL(name, MIGRATIONS_DIR)).text();
    await sql.begin(async (tx) => {
      await tx.unsafe(text);
      await tx`INSERT INTO schema_migrations (name) VALUES (${name})`;
    });
    done.push(name);
  }
  return done;
}

if (import.meta.main) {
  try {
    const done = await runMigrations();
    console.log(done.length ? `applied: ${done.join(", ")}` : "migrations up to date");
  } finally {
    await sql.close();
  }
}
