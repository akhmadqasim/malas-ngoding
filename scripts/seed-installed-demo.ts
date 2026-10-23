// A handful of explicitly synthetic installations, on existing consenting DEMO homes only.
// Never marks real residents as installed. Repeatable without replacing other home data.
import { sql } from "../src/server/db.ts";

try {
  const changed = await sql`
    WITH sample AS (
      SELECT id, row_number() OVER (PARTITION BY region_id ORDER BY id) AS n
      FROM homes WHERE demo AND consent_map AND potential_kwp > 0
    )
    UPDATE homes h SET installed_pv = true,
      installed_kwp = least(3.3, h.potential_kwp), updated_at = now()
    FROM sample s WHERE h.id = s.id AND s.n <= 3 AND NOT h.installed_pv
    RETURNING h.region_id, h.installed_kwp`;
  console.log(`Added ${changed.length} synthetic demo installations; real residents unchanged.`);
} finally { await sql.close(); }
