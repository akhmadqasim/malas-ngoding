-- Terrain of each renewable potential cell's Kaltim land (data/seed/re-terrain.json, built by
-- scripts/build-terrain.ts from open DEM tiles). Null until the terrain seed has been loaded.
ALTER TABLE re_potential
  ADD COLUMN elev_mean double precision,
  ADD COLUMN elev_max double precision,
  -- Degrees.
  ADD COLUMN slope_mean double precision,
  -- Percent of the cell's Kaltim land with a slope of at most 5 and 10 degrees.
  ADD COLUMN flat5_pct double precision,
  ADD COLUMN flat10_pct double precision,
  ADD COLUMN terrain_source text;
