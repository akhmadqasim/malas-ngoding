-- Long-term solar and wind climatology on the NASA POWER grid over Kalimantan Timur
-- (data/seed/re-potential.json, built by scripts/build-re-potential.ts). One row per grid point.
CREATE TABLE re_potential (
  id serial PRIMARY KEY,
  lng double precision NOT NULL,
  lat double precision NOT NULL,
  geom geometry(Point, 4326) NOT NULL,
  -- kWh/m2/day, all-sky surface shortwave (equals peak sun hours).
  ghi double precision NOT NULL,
  -- m/s at 50 m and 10 m above ground.
  ws50 double precision NOT NULL,
  ws10 double precision NOT NULL,
  source text NOT NULL,
  UNIQUE (lng, lat)
);
CREATE INDEX re_potential_geom_gix ON re_potential USING gist (geom);
