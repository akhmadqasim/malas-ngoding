import { afterAll } from "bun:test";
import { sql } from "../src/server/db.ts";

// Preloaded by bunfig.toml. The Postgres tests (tests/server/db.test.ts, applications.db.test.ts) share one
// pool, and a closed Bun SQL pool cannot reconnect, so it is closed once after every test file has run;
// without it `bun test` would wait on the open connections.
afterAll(async () => {
  await sql.close();
});
