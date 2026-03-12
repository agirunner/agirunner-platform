BEGIN;

-- The canonical base schema is already playbook-based. Pre-production reset is
-- the supported path, so template-era runtime heartbeat and fleet-event rename
-- compatibility has been removed instead of preserved here.

COMMIT;
