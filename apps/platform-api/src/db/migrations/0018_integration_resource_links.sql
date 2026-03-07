CREATE TABLE integration_resource_links (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  adapter_id UUID NOT NULL REFERENCES integration_adapters(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  external_id TEXT NOT NULL,
  external_url TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_integration_resource_links_unique
  ON integration_resource_links (tenant_id, adapter_id, entity_type, entity_id);

CREATE INDEX idx_integration_resource_links_external
  ON integration_resource_links (tenant_id, adapter_id, external_id);
