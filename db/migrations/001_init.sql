CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE regions (
  id text PRIMARY KEY,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('kabupaten', 'kota')),
  geom geometry(MultiPolygon, 4326) NOT NULL,
  centroid geometry(Point, 4326) NOT NULL,
  kwh_year double precision NOT NULL,
  population integer,
  customers integer,
  electrification_pct double precision,
  villages_no_pln integer,
  estimated boolean NOT NULL DEFAULT true,
  source text NOT NULL
);
CREATE INDEX regions_geom_gix ON regions USING gist (geom);
CREATE INDEX regions_centroid_gix ON regions USING gist (centroid);

CREATE TABLE power_plants (
  id serial PRIMARY KEY,
  name text NOT NULL UNIQUE,
  fuel text NOT NULL,
  capacity_mw double precision NOT NULL,
  status text NOT NULL,
  geom geometry(Point, 4326) NOT NULL,
  approx boolean NOT NULL DEFAULT false,
  source text NOT NULL
);
CREATE INDEX power_plants_geom_gix ON power_plants USING gist (geom);

CREATE TABLE grid_mix (
  year integer NOT NULL,
  fuel text NOT NULL,
  share double precision NOT NULL,
  fuel_factor double precision NOT NULL,
  grid_factor double precision NOT NULL,
  source text NOT NULL,
  PRIMARY KEY (year, fuel)
);

CREATE TABLE building_types (
  type text PRIMARY KEY,
  intensity_kwh_m2_year double precision NOT NULL,
  typical_floors integer NOT NULL,
  source text NOT NULL
);

CREATE TABLE equivalents (
  key text PRIMARY KEY,
  label text NOT NULL,
  kg_co2_per_unit double precision NOT NULL,
  unit text NOT NULL,
  source text NOT NULL
);

CREATE TABLE building_estimates (
  feature_id text PRIMARY KEY,
  input jsonb NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE poi_cache (
  key text PRIMARY KEY,
  payload jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE solar_climatology (
  key text PRIMARY KEY,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  psh_by_month jsonb NOT NULL,
  psh_year double precision NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE weather_cache (
  key text PRIMARY KEY,
  payload jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE recommendations (
  region_id text PRIMARY KEY REFERENCES regions (id),
  content jsonb NOT NULL,
  model text NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE chat_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE chat_messages (
  id serial PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES chat_sessions (id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX chat_messages_session_idx ON chat_messages (session_id, id);
