export const REDESIGN_RESET_PRESERVED_TABLES = new Set([
  'api_keys',
  'llm_providers',
  'llm_models',
  'role_model_assignments',
  'runtime_defaults',
  'schema_migrations',
  'tenants',
]);

export const PRESERVED_LLM_RUNTIME_DEFAULT_KEYS = [
  'default_model_id',
  'default_reasoning_config',
] as const;
