import { z } from 'zod';

import type { DatabaseQueryable } from '../../db/database.js';
import { TenantScopedRepository } from '../../db/tenant-scoped-repository.js';
import { ConflictError, NotFoundError, ValidationError } from '../../errors/domain-errors.js';
import type { EventService } from '../event/event-service.js';
import type { FleetService } from '../fleet-service.js';

const CONFIG_TYPES = ['string', 'number', 'boolean', 'json'] as const;
const RUNTIME_DEFAULT_SECRET_REDACTION = 'redacted://runtime-default-secret';
const SECRET_RUNTIME_DEFAULT_SEGMENTS = new Set([
  'secret',
  'secret_ref',
  'api_key',
  'api_key_secret_ref',
  'password',
  'credential',
  'authorization',
  'private_key',
  'known_hosts',
  'webhook_url',
]);
const INTEGER_DEFAULT_RULES = new Map([
  ['global_max_specialists', { min: 1 }],
  ['specialist_runtime_bootstrap_claim_timeout_seconds', { min: 1 }],
  ['specialist_runtime_drain_grace_seconds', { min: 1 }],
  ['server.shutdown_timeout_seconds', { min: 1 }],
  ['server.read_header_timeout_seconds', { min: 1 }],
  ['agent.history_max_messages', { min: 1 }],
  ['agent.history_preserve_recent', { min: 1 }],
  ['agent.context_compaction_chars_per_token', { min: 1 }],
  ['agent.specialist_context_tail_messages', { min: 1 }],
  ['agent.specialist_context_preserve_memory_ops', { min: 0 }],
  ['agent.specialist_context_preserve_artifact_ops', { min: 0 }],
  ['agent.orchestrator_history_preserve_recent', { min: 0 }],
  ['agent.orchestrator_preserve_memory_ops', { min: 0 }],
  ['agent.orchestrator_preserve_artifact_ops', { min: 0 }],
  ['agent.loop_detection_repeat', { min: 1 }],
  ['agent.response_repeat_threshold', { min: 1 }],
  ['agent.no_file_change_threshold', { min: 1 }],
  ['agent.max_tool_steps_per_burst', { min: 1 }],
  ['agent.max_mutating_steps_per_burst', { min: 1 }],
  ['agent.max_burst_elapsed_ms', { min: 1 }],
  ['agent.max_parallel_tool_calls_per_burst', { min: 1 }],
  ['agent.max_stuck_interventions', { min: 0 }],
  ['agent.max_iterations', { min: 1 }],
  ['agent.llm_max_retries', { min: 1 }],
  ['tasks.default_timeout_minutes', { min: 1 }],
  ['platform.workflow_activation_delay_ms', { min: 0 }],
  ['platform.workflow_activation_heartbeat_interval_ms', { min: 1 }],
  ['platform.workflow_activation_stale_after_ms', { min: 1 }],
  ['platform.task_cancel_signal_grace_period_ms', { min: 1 }],
  ['platform.worker_dispatch_ack_timeout_ms', { min: 1 }],
  ['platform.worker_key_expiry_ms', { min: 1 }],
  ['platform.event_stream_keepalive_interval_ms', { min: 1 }],
  ['platform.worker_reconnect_min_ms', { min: 1 }],
  ['platform.worker_reconnect_max_ms', { min: 1 }],
  ['platform.worker_websocket_ping_interval_ms', { min: 1 }],
  ['platform.agent_default_heartbeat_interval_seconds', { min: 1 }],
  ['platform.agent_heartbeat_grace_period_ms', { min: 0 }],
  ['platform.agent_key_expiry_ms', { min: 1 }],
  ['platform.worker_default_heartbeat_interval_seconds', { min: 1 }],
  ['platform.worker_offline_grace_period_ms', { min: 0 }],
  ['platform.lifecycle_agent_heartbeat_check_interval_ms', { min: 1 }],
  ['platform.lifecycle_worker_heartbeat_check_interval_ms', { min: 1 }],
  ['platform.lifecycle_task_timeout_check_interval_ms', { min: 1 }],
  ['platform.lifecycle_dispatch_loop_interval_ms', { min: 1 }],
  ['platform.heartbeat_prune_interval_ms', { min: 1 }],
  ['platform.governance_retention_job_interval_ms', { min: 1000 }],
  ['container_manager.reconcile_interval_seconds', { min: 1 }],
  ['container_manager.stop_timeout_seconds', { min: 1 }],
  ['container_manager.shutdown_task_stop_timeout_seconds', { min: 1 }],
  ['container_manager.docker_action_buffer_seconds', { min: 1 }],
  ['container_manager.log_flush_interval_ms', { min: 1 }],
  ['container_manager.docker_event_reconnect_backoff_ms', { min: 1 }],
  ['container_manager.crash_log_capture_timeout_seconds', { min: 1 }],
  ['container_manager.starvation_threshold_seconds', { min: 1 }],
  ['container_manager.runtime_orphan_grace_cycles', { min: 1 }],
  ['container_manager.hung_runtime_stale_after_seconds', { min: 1 }],
  ['container_manager.hung_runtime_stop_grace_period_seconds', { min: 1 }],
  ['container_manager.runtime_log_max_size_mb', { min: 1 }],
  ['container_manager.runtime_log_max_files', { min: 1 }],
  ['llm.http_timeout_seconds', { min: 1 }],
  ['tools.file_read_timeout_seconds', { min: 1 }],
  ['tools.file_write_timeout_seconds', { min: 1 }],
  ['tools.file_edit_timeout_seconds', { min: 1 }],
  ['tools.file_list_timeout_seconds', { min: 1 }],
  ['tools.git_status_timeout_seconds', { min: 1 }],
  ['tools.git_diff_timeout_seconds', { min: 1 }],
  ['tools.git_log_timeout_seconds', { min: 1 }],
  ['tools.git_commit_timeout_seconds', { min: 1 }],
  ['tools.git_push_timeout_seconds', { min: 1 }],
  ['tools.shell_exec_timeout_seconds', { min: 1 }],
  ['tools.shell_exec_timeout_min_seconds', { min: 1 }],
  ['tools.shell_exec_timeout_max_seconds', { min: 1 }],
  ['tools.helpers_exec_timeout_seconds', { min: 1 }],
  ['tools.web_fetch_timeout_seconds', { min: 1 }],
  ['tools.mcp_timeout_seconds', { min: 1 }],
  ['lifecycle.healthcheck_timeout_seconds', { min: 1 }],
  ['lifecycle.healthcheck_retry_delay_seconds', { min: 1 }],
  ['lifecycle.failed_start_stop_timeout_seconds', { min: 1 }],
  ['lifecycle.destroy_stop_timeout_seconds', { min: 1 }],
  ['platform.claim_poll_seconds', { min: 1 }],
  ['platform.api_request_timeout_seconds', { min: 1 }],
  ['platform.log_ingest_timeout_seconds', { min: 1 }],
  ['platform.log_flush_interval_ms', { min: 1 }],
  ['platform.heartbeat_max_failures', { min: 1 }],
  ['platform.cancellation_report_timeout_seconds', { min: 1 }],
  ['platform.drain_timeout_seconds', { min: 1 }],
  ['platform.self_terminate_cleanup_timeout_seconds', { min: 1 }],
  ['workspace.create_layout_timeout_seconds', { min: 1 }],
  ['workspace.configure_git_timeout_seconds', { min: 1 }],
  ['workspace.cleanup_git_timeout_seconds', { min: 1 }],
  ['workspace.configure_identity_timeout_seconds', { min: 1 }],
  ['workspace.clone_timeout_seconds', { min: 1 }],
  ['workspace.clone_max_retries', { min: 1 }],
  ['workspace.clone_backoff_base_seconds', { min: 1 }],
  ['workspace.snapshot_interval', { min: 0 }],
  ['workspace.snapshot_max_per_task', { min: 0 }],
  ['container.max_reuse_age_seconds', { min: 0 }],
  ['container.max_reuse_tasks', { min: 0 }],
  ['queue.max_depth', { min: 1 }],
  ['capture.push_timeout_seconds', { min: 1 }],
  ['capture.push_retries', { min: 0 }],
  ['capture.exec_timeout_seconds', { min: 1 }],
  ['secrets.vault_timeout_seconds', { min: 1 }],
  ['pool.pool_size', { min: 0 }],
  ['subagent.default_timeout_seconds', { min: 1 }],
  ['subagent.max_concurrent', { min: 1 }],
  ['subagent.max_total', { min: 1 }],
  ['subagent.max_depth', { min: 0 }],
  ['api.events_heartbeat_seconds', { min: 1 }],
  ['pool.refresh_interval_seconds', { min: 1 }],
]);
const DECIMAL_DEFAULT_RULES = new Map([
  ['agent.context_compaction_threshold', { min: 0, max: 1 }],
  ['agent.specialist_context_warning_threshold', { min: 0, max: 1 }],
  ['agent.specialist_context_compaction_threshold', { min: 0, max: 1 }],
  ['agent.orchestrator_context_compaction_threshold', { min: 0, max: 1 }],
  ['agent.orchestrator_emergency_compaction_threshold', { min: 0, max: 1 }],
  ['platform.worker_offline_threshold_multiplier', { min: 1 }],
  ['platform.worker_degraded_threshold_multiplier', { min: 1 }],
  ['platform.agent_heartbeat_threshold_multiplier', { min: 1 }],
]);
const ENUM_DEFAULT_RULES = new Map<string, readonly string[]>([
  ['specialist_runtime_default_pull_policy', ['always', 'if-not-present', 'never']],
  ['log.level', ['debug', 'info', 'warn', 'error']],
  ['agent.specialist_context_strategy', ['auto', 'semantic_local', 'deterministic', 'provider_native', 'off']],
  ['agent.orchestrator_context_strategy', ['activation_checkpoint', 'emergency_only', 'off']],
]);
const BOOLEAN_DEFAULT_KEYS = new Set([
  'pool.enabled',
  'agent.specialist_prepare_for_compaction_enabled',
  'agent.orchestrator_finish_checkpoint_enabled',
  'agent.orchestrator_finish_refresh_context_bundle',
]);
const REMOVED_RUNTIME_DEFAULT_KEYS = new Set([
  'global_max_runtimes',
  'global_max_execution_containers',
  'queue.max_concurrency',
  'tools.web_search_provider',
  'tools.web_search_base_url',
  'tools.web_search_api_key_secret_ref',
  'tools.web_search_timeout_seconds',
  'docker.checker_timeout_ms',
  'docker.stop_timeout_seconds',
  'container.copy_timeout_seconds',
  'containerd.connect_timeout_seconds',
  'workspace.inject_context_rename_timeout_seconds',
  'platform.webhook_max_attempts',
  'platform.webhook_retry_base_delay_ms',
  'default_pull_policy',
  'default_idle_timeout_seconds',
  'default_grace_period',
]);
const NON_DELETABLE_RUNTIME_DEFAULT_KEYS = new Set([
  'global_max_specialists',
  'tasks.default_timeout_minutes',
  'agent.max_iterations',
  'agent.llm_max_retries',
  'specialist_runtime_default_image',
  'specialist_runtime_default_cpu',
  'specialist_runtime_default_memory',
  'specialist_runtime_default_pull_policy',
  'specialist_runtime_bootstrap_claim_timeout_seconds',
  'specialist_runtime_drain_grace_seconds',
  'platform.api_request_timeout_seconds',
  'platform.log_ingest_timeout_seconds',
  'container_manager.reconcile_interval_seconds',
  'container_manager.stop_timeout_seconds',
  'container_manager.shutdown_task_stop_timeout_seconds',
  'container_manager.docker_action_buffer_seconds',
  'container_manager.log_flush_interval_ms',
  'container_manager.docker_event_reconnect_backoff_ms',
  'container_manager.crash_log_capture_timeout_seconds',
  'container_manager.starvation_threshold_seconds',
  'container_manager.runtime_orphan_grace_cycles',
  'container_manager.hung_runtime_stale_after_seconds',
  'container_manager.hung_runtime_stop_grace_period_seconds',
  'container_manager.runtime_log_max_size_mb',
  'container_manager.runtime_log_max_files',
]);

const createDefaultSchema = z.object({
  configKey: z.string().min(1).max(200),
  configValue: z.string(),
  configType: z.enum(CONFIG_TYPES),
  description: z.string().max(1000).optional(),
});

const updateDefaultSchema = createDefaultSchema.partial().omit({ configKey: true });

export type CreateRuntimeDefaultInput = z.infer<typeof createDefaultSchema>;
export type UpdateRuntimeDefaultInput = z.infer<typeof updateDefaultSchema>;

type RuntimeDefaultsEventService = Pick<EventService, 'emit'>;

interface RuntimeDefaultRow {
  [key: string]: unknown;
  id: string;
  tenant_id: string;
  config_key: string;
  config_value: string;
  config_type: string;
  description: string | null;
  created_at: Date;
  updated_at: Date;
}

export class RuntimeDefaultsService {
  constructor(
    private readonly pool: DatabaseQueryable,
    private readonly fleetService?: Pick<FleetService, never>,
    private readonly eventService?: RuntimeDefaultsEventService,
  ) {}

  async listDefaults(tenantId: string): Promise<RuntimeDefaultRow[]> {
    const repo = new TenantScopedRepository(this.pool, tenantId);
    const rows = await repo.findAll<RuntimeDefaultRow>('runtime_defaults', '*');
    return rows
      .filter((row) => !REMOVED_RUNTIME_DEFAULT_KEYS.has(row.config_key))
      .map(toPublicRuntimeDefaultRow);
  }

  async getDefault(tenantId: string, id: string): Promise<RuntimeDefaultRow> {
    const repo = new TenantScopedRepository(this.pool, tenantId);
    const row = await repo.findById<RuntimeDefaultRow>('runtime_defaults', '*', id);
    if (!row) throw new NotFoundError('Runtime default not found');
    return toPublicRuntimeDefaultRow(row);
  }

  async getByKey(tenantId: string, configKey: string): Promise<RuntimeDefaultRow | null> {
    const repo = new TenantScopedRepository(this.pool, tenantId);
    const rows = await repo.findAll<RuntimeDefaultRow>(
      'runtime_defaults',
      '*',
      ['config_key = $2'],
      [configKey],
    );
    return rows[0] ?? null;
  }

  async createDefault(
    tenantId: string,
    input: CreateRuntimeDefaultInput,
  ): Promise<RuntimeDefaultRow> {
    const validated = createDefaultSchema.parse(input);
    validateKnownRuntimeDefault(validated);

    const existing = await this.getByKey(tenantId, validated.configKey);
    if (existing)
      throw new ConflictError(`Runtime default "${validated.configKey}" already exists`);

    const result = await this.pool.query<RuntimeDefaultRow>(
      `INSERT INTO runtime_defaults (tenant_id, config_key, config_value, config_type, description)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        tenantId,
        validated.configKey,
        validated.configValue,
        validated.configType,
        validated.description ?? null,
      ],
    );
    const created = toPublicRuntimeDefaultRow(result.rows[0]);
    return created;
  }

  async updateDefault(
    tenantId: string,
    id: string,
    input: UpdateRuntimeDefaultInput,
  ): Promise<RuntimeDefaultRow> {
    const validated = updateDefaultSchema.parse(input);
    const current = await this.getDefault(tenantId, id);
    validateKnownRuntimeDefault({
      configKey: current.config_key,
      configValue: validated.configValue ?? current.config_value,
      configType: (validated.configType ??
        current.config_type) as CreateRuntimeDefaultInput['configType'],
      description: validated.description ?? current.description ?? undefined,
    });
    const setClauses: string[] = [];
    const values: unknown[] = [tenantId, id];
    let paramIndex = 3;

    const fields: Array<[string, unknown]> = [
      ['config_value', validated.configValue],
      ['config_type', validated.configType],
      ['description', validated.description],
    ];

    for (const [column, value] of fields) {
      if (value !== undefined) {
        setClauses.push(`${column} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
      }
    }

    if (setClauses.length === 0) return toPublicRuntimeDefaultRow(current);

    setClauses.push('updated_at = NOW()');

    const result = await this.pool.query<RuntimeDefaultRow>(
      `UPDATE runtime_defaults SET ${setClauses.join(', ')} WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      values,
    );
    if (!result.rowCount) throw new NotFoundError('Runtime default not found');
    return toPublicRuntimeDefaultRow(result.rows[0]);
  }

  async upsertDefault(
    tenantId: string,
    input: CreateRuntimeDefaultInput,
  ): Promise<RuntimeDefaultRow> {
    const validated = createDefaultSchema.parse(input);
    validateKnownRuntimeDefault(validated);

    const result = await this.pool.query<RuntimeDefaultRow>(
      `INSERT INTO runtime_defaults (tenant_id, config_key, config_value, config_type, description)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tenant_id, config_key)
       DO UPDATE SET config_value = $3, config_type = $4, description = $5, updated_at = NOW()
       RETURNING *`,
      [
        tenantId,
        validated.configKey,
        validated.configValue,
        validated.configType,
        validated.description ?? null,
      ],
    );
    return toPublicRuntimeDefaultRow(result.rows[0]);
  }

  async deleteDefault(tenantId: string, id: string, configKey?: string): Promise<void> {
    assertRuntimeDefaultCanBeDeleted(configKey);
    const result = await this.pool.query(
      'DELETE FROM runtime_defaults WHERE tenant_id = $1 AND id = $2',
      [tenantId, id],
    );
    if (!result.rowCount) throw new NotFoundError('Runtime default not found');
    void configKey;
  }
}

function toPublicRuntimeDefaultRow(row: RuntimeDefaultRow): RuntimeDefaultRow {
  if (!shouldRedactRuntimeDefault(row.config_key, row.config_value)) {
    return row;
  }

  return {
    ...row,
    config_value: RUNTIME_DEFAULT_SECRET_REDACTION,
  };
}

function shouldRedactRuntimeDefault(configKey: string, configValue: string): boolean {
  return configValue.trim().length > 0 && hasSecretLikeRuntimeDefaultKey(configKey);
}

function hasSecretLikeRuntimeDefaultKey(configKey: string): boolean {
  return configKey
    .split('.')
    .map((segment) => segment.trim().toLowerCase().replaceAll('-', '_'))
    .some((segment) => SECRET_RUNTIME_DEFAULT_SEGMENTS.has(segment));
}

function assertRuntimeDefaultCanBeDeleted(configKey?: string): void {
  if (!configKey || !NON_DELETABLE_RUNTIME_DEFAULT_KEYS.has(configKey)) {
    return;
  }

  throw new ValidationError(`Runtime default "${configKey}" is required and cannot be deleted`);
}

function validateKnownRuntimeDefault(input: CreateRuntimeDefaultInput): void {
  if (REMOVED_RUNTIME_DEFAULT_KEYS.has(input.configKey)) {
    throw new Error(`${input.configKey} has been removed`);
  }
  validateBooleanRuntimeDefault(input);
  validateEnumRuntimeDefault(input);
  validateNumericRuntimeDefault(input);

  void input;
}

function validateBooleanRuntimeDefault(input: CreateRuntimeDefaultInput): void {
  if (!BOOLEAN_DEFAULT_KEYS.has(input.configKey)) {
    return;
  }
  if (input.configType !== 'boolean') {
    throw new Error(`${input.configKey} must use boolean config type`);
  }
  if (input.configValue !== 'true' && input.configValue !== 'false') {
    throw new Error(`${input.configKey} must be true or false`);
  }
}

function validateEnumRuntimeDefault(input: CreateRuntimeDefaultInput): void {
  const allowedValues = ENUM_DEFAULT_RULES.get(input.configKey);
  if (!allowedValues) {
    return;
  }
  if (input.configType !== 'string') {
    throw new Error(`${input.configKey} must use string config type`);
  }
  if (!allowedValues.includes(input.configValue)) {
    throw new Error(`${input.configKey} must be one of: ${allowedValues.join(', ')}`);
  }
}

function validateNumericRuntimeDefault(input: CreateRuntimeDefaultInput): void {
  const integerRule = INTEGER_DEFAULT_RULES.get(input.configKey);
  if (integerRule) {
    if (input.configType !== 'number') {
      throw new Error(`${input.configKey} must use number config type`);
    }
    const parsed = Number(input.configValue);
    if (!Number.isInteger(parsed)) {
      throw new Error(`${input.configKey} must be a whole number`);
    }
    if (parsed < integerRule.min) {
      throw new Error(`${input.configKey} must be at least ${integerRule.min}`);
    }
    return;
  }

  const decimalRule = DECIMAL_DEFAULT_RULES.get(input.configKey);
  if (!decimalRule) {
    return;
  }
  if (input.configType !== 'number') {
    throw new Error(`${input.configKey} must use number config type`);
  }
  const parsed = Number(input.configValue);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${input.configKey} must be a number`);
  }
  if (parsed < decimalRule.min) {
    if (decimalRule.max !== undefined) {
      throw new Error(
        `${input.configKey} must be between ${decimalRule.min} and ${decimalRule.max}`,
      );
    }
    throw new Error(`${input.configKey} must be at least ${decimalRule.min}`);
  }
  if (decimalRule.max !== undefined && parsed > decimalRule.max) {
    throw new Error(`${input.configKey} must be between ${decimalRule.min} and ${decimalRule.max}`);
  }
}
