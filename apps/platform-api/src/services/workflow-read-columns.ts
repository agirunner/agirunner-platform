const WORKFLOW_READ_COLUMNS = [
  'id',
  'tenant_id',
  'project_id',
  'playbook_id',
  'playbook_version',
  'project_spec_version',
  'name',
  'state',
  'lifecycle',
  'current_stage',
  'parameters',
  'context',
  'context_size_bytes',
  'context_max_bytes',
  'resolved_config',
  'config_layers',
  'instruction_config',
  'orchestration_state',
  'git_branch',
  'token_budget',
  'cost_cap_usd',
  'max_duration_minutes',
  'legal_hold',
  'archived_at',
  'metadata',
  'started_at',
  'completed_at',
  'created_at',
  'updated_at',
] as const;

interface BuildWorkflowReadColumnsOptions {
  includeCurrentStage?: boolean;
}

export function buildWorkflowReadColumns(
  alias?: string,
  options: BuildWorkflowReadColumnsOptions = {},
) {
  const prefix = alias ? `${alias}.` : '';
  const includeCurrentStage = options.includeCurrentStage ?? true;
  return WORKFLOW_READ_COLUMNS
    .filter((column) => includeCurrentStage || column !== 'current_stage')
    .map((column) => `${prefix}${column}`)
    .join(', ');
}
