-- Allow the same model_id under different providers within a tenant.
-- Previously (tenant_id, model_id) was unique; now (tenant_id, provider_id, model_id).

ALTER TABLE llm_models
  DROP CONSTRAINT IF EXISTS llm_models_tenant_id_model_id_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'llm_models_tenant_provider_model_key'
  ) THEN
    ALTER TABLE llm_models
      ADD CONSTRAINT llm_models_tenant_provider_model_key
        UNIQUE (tenant_id, provider_id, model_id);
  END IF;
END $$;
