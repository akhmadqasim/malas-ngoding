-- Accounts, sign-in sessions and the one home each resident marks on the map.
-- Residents (warga) register themselves; government accounts (pemda) are made by an admin or by the demo login.
CREATE TABLE users (
  id serial PRIMARY KEY,
  -- Stored lower-case by the server.
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('warga', 'pemda')),
  -- Seeded demo accounts; they are only reachable through POST /api/auth/demo.
  demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- token_hash is the sha256 hex of the cookie token; the token itself is never stored.
CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_id_ix ON sessions (user_id);

CREATE TABLE homes (
  id serial PRIMARY KEY,
  user_id integer NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
  feature_id text NOT NULL,
  lng double precision NOT NULL,
  lat double precision NOT NULL,
  geom geometry(Point, 4326) NOT NULL,
  region_id text REFERENCES regions (id),
  building_type text NOT NULL,
  floors integer NOT NULL,
  footprint_m2 double precision NOT NULL,
  height_m double precision,
  kwh_month double precision,
  bill_rp_month double precision,
  -- Worked out when the home is saved (see routes/home.ts): yearly kWh, where it came from, and the rooftop PV the roof holds.
  kwh_year double precision NOT NULL,
  kwh_source text NOT NULL CHECK (kwh_source IN ('tagihan', 'perkiraan')),
  potential_kwp double precision NOT NULL,
  interested_pv boolean NOT NULL DEFAULT false,
  consent_map boolean NOT NULL DEFAULT false,
  demo boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX homes_geom_gix ON homes USING gist (geom);
CREATE INDEX homes_region_ix ON homes (region_id);
