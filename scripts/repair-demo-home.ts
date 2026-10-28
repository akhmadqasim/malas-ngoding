import * as db from "../src/server/db.ts";
import { buildHome } from "../src/server/routes/home.ts";
// Repair only the original synthetic demo marker; never move a resident's assigned home.
const rows = await db.sql`SELECT u.id FROM users u JOIN homes h ON h.user_id=u.id WHERE u.email='demo@warga.local' AND u.demo=true AND h.demo=true AND h.feature_id='demo:demo@warga.local' AND abs(h.lng-117.1475)<0.0000001 AND abs(h.lat+0.4955)<0.0000001`;
if (!rows[0]) console.log("No original demo placeholder to repair.");
else {
 const id=Number(rows[0].id), home=await db.homeGet(id);
 if (!home) throw new Error("Demo home missing");
 await Bun.write("output/demo-home-before-repair.json", JSON.stringify(home,null,2));
 const built=await buildHome({db},{...home,featureId:"mapbox:575625507",lng:117.1473174905973,lat:-0.4954460597499305,footprintM2:127,heightM:3});
 if ("problem" in built) throw new Error(built.problem);
 await db.homeUpsert(id,built.home,true);
 console.log("Original demo placeholder repaired to its confirmed building footprint; other accounts untouched.");
}
await db.sql.close();
