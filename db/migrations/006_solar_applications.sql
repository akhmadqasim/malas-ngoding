-- Rooftop PV installation reports: a resident reports panels already installed (with photos), the local
-- government checks and verifies them for its records. Contract: src/shared/applications.ts.

-- Capacity checked by the government. Only a verified report writes it; PUT /api/me/home never does, and it
-- is cleared when the resident moves the home to another building.
ALTER TABLE homes ADD COLUMN verified_kwp double precision;
ALTER TABLE homes ADD COLUMN verified_at timestamptz;
ALTER TABLE homes ADD CONSTRAINT homes_verified_kwp_check CHECK (verified_kwp IS NULL OR (verified_kwp > 0 AND verified_kwp <= 10000));

-- Numbers the human references (PLTS-2026-000123). Gaps after a rolled-back insert are fine.
CREATE SEQUENCE solar_application_seq;

CREATE TABLE solar_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq bigint NOT NULL UNIQUE,
  reference text NOT NULL UNIQUE,
  -- Deleting a user (only the seed prunes demo users) removes their reports too.
  user_id integer NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('submitted', 'under_review', 'needs_changes', 'survey_scheduled', 'verified', 'rejected', 'cancelled')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  -- From the home snapshot, kept as a column for the government's region filter.
  region_id text,
  demo boolean NOT NULL DEFAULT false,
  home_snapshot jsonb NOT NULL,
  estimate jsonb NOT NULL,
  report jsonb NOT NULL,
  contact jsonb NOT NULL,
  survey jsonb,
  verification jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX solar_applications_user_ix ON solar_applications (user_id, seq DESC);
CREATE INDEX solar_applications_status_ix ON solar_applications (status, seq DESC);
-- One active report per resident, enforced by the database even under concurrent requests.
CREATE UNIQUE INDEX solar_applications_one_active_ix ON solar_applications (user_id)
  WHERE status NOT IN ('verified', 'rejected', 'cancelled');

-- Timeline and audit. public_note shows to the resident; internal_note and the actor only to the government.
CREATE TABLE solar_application_events (
  id bigserial PRIMARY KEY,
  application_id uuid NOT NULL REFERENCES solar_applications (id) ON DELETE CASCADE,
  at timestamptz NOT NULL DEFAULT now(),
  action text NOT NULL,
  status text NOT NULL,
  title text NOT NULL,
  public_note text,
  internal_note text,
  actor_user_id integer REFERENCES users (id) ON DELETE SET NULL,
  actor_role text CHECK (actor_role IN ('warga', 'pemda')),
  -- What an edit replaced, for the audit.
  data jsonb
);
CREATE INDEX solar_application_events_app_ix ON solar_application_events (application_id, id);

-- Photos. Uploaded first (application_id null), attached when the report is sent or edited.
CREATE TABLE solar_application_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id integer NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  application_id uuid REFERENCES solar_applications (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('installation', 'pln_approval', 'compliance', 'other')),
  content_type text NOT NULL,
  size_bytes integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),
  bytes bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX solar_application_files_user_ix ON solar_application_files (user_id) WHERE application_id IS NULL;
CREATE INDEX solar_application_files_app_ix ON solar_application_files (application_id);

-- Idempotency-Key per user: the same key and body return the same report.
CREATE TABLE solar_application_requests (
  user_id integer NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  key uuid NOT NULL,
  request_hash text NOT NULL,
  application_id uuid NOT NULL REFERENCES solar_applications (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);
