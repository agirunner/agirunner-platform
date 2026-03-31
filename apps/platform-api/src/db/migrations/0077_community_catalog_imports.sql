CREATE TABLE IF NOT EXISTS catalog_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source_kind text NOT NULL DEFAULT 'github_catalog',
  source_repository text NOT NULL,
  source_ref text NOT NULL,
  source_commit_sha text,
  requested_playbook_ids text[] NOT NULL DEFAULT '{}'::text[],
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT catalog_import_batches_source_kind_check
    CHECK (source_kind IN ('github_catalog'))
);

CREATE INDEX IF NOT EXISTS idx_catalog_import_batches_tenant_created
  ON catalog_import_batches (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS catalog_import_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  import_batch_id uuid NOT NULL REFERENCES catalog_import_batches(id) ON DELETE CASCADE,
  artifact_type text NOT NULL,
  catalog_id text NOT NULL,
  catalog_name text NOT NULL,
  catalog_version text,
  catalog_path text NOT NULL,
  source_repository text NOT NULL,
  source_ref text NOT NULL,
  source_commit_sha text,
  local_entity_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT catalog_import_links_artifact_type_check
    CHECK (artifact_type IN ('playbook', 'specialist', 'skill'))
);

CREATE INDEX IF NOT EXISTS idx_catalog_import_links_tenant_catalog
  ON catalog_import_links (tenant_id, artifact_type, catalog_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_catalog_import_links_local_entity
  ON catalog_import_links (tenant_id, artifact_type, local_entity_id);
