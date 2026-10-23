-- Reported installations are distinct from interest and simulated rooftop potential.
ALTER TABLE homes ADD COLUMN installed_pv boolean NOT NULL DEFAULT false;
ALTER TABLE homes ADD COLUMN installed_kwp double precision;
ALTER TABLE homes ADD CONSTRAINT homes_installed_kwp_check CHECK (
  installed_kwp IS NULL OR (installed_pv AND installed_kwp > 0 AND installed_kwp <= 10000)
);
