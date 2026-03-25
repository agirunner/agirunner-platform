import { z } from 'zod';

import type { DatabasePool } from '../db/database.js';
import { TenantScopedRepository } from '../db/tenant-scoped-repository.js';
import { NotFoundError, ValidationError } from '../errors/domain-errors.js';
import { type PlaybookRuntimePoolKind } from '../orchestration/playbook-model.js';
import {
  assertValidContainerCpu,
  assertValidContainerImage,
  assertValidContainerMemory,
} from './container-resource-validation.js';
import {
  GLOBAL_MAX_SPECIALISTS_RUNTIME_KEY,
  SPECIALIST_RUNTIME_DEFAULT_KEYS,
} from './runtime-default-values.js';

const VALID_POOL_KINDS = new Set(['orchestrator', 'specialist']);
const FLEET_ENV_SECRET_REDACTION = 'redacted://fleet-environment-secret';
const FLEET_EVENT_SECRET_REDACTION = 'redacted://fleet-event-secret';
const DEFAULT_SPECIALIST_CPU_LIMIT = '2';
const DEFAULT_SPECIALIST_MEMORY_LIMIT = '256m';
const DEFAULT_ORCHESTRATOR_CPU_LIMIT = '2';
const DEFAULT_ORCHESTRATOR_MEMORY_LIMIT = '256m';
const secretLikeKeyPattern = /(secret|token|password|api[_-]?key|credential|authorization|private[_-]?key|known_hosts)/i;
const secretLikeValuePattern =
  /(?:^enc:v\d+:|^secret:|^redacted:\/\/|^Bearer\s+\S+|^sk-[A-Za-z0-9_-]+|^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/i;
const GENERIC_SPECIALIST_TARGET_ID = 'specialist';
const GENERIC_SPECIALIST_TARGET_NAME = 'Specialist Agents';

interface FleetLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
}

const SILENT_LOGGER: FleetLogger = { warn: () => {} };

const VALID_FLEET_EVENT_TYPES = new Set([
  'runtime.started',
  'runtime.task.claimed',
  'runtime.task.completed',
  'runtime.task.escalated',
  'runtime.task.failed',
  'runtime.idle',
  'runtime.draining',
  'runtime.shutdown',
  'runtime.hung_detected',
  'container.created',
  'container.destroyed',
  'orphan.cleaned',
  'runtime_created',
  'runtime_draining',
  'runtime_hung',
  'runtime_orphan_cleaned',
  'runtime_preempted',
  'image_drift_detected',
]);

const VALID_FLEET_EVENT_LEVELS = new Set(['debug', 'info', 'warn', 'error']);

const createDesiredStateSchema = z.object({
  workerName: z.string().min(1).max(200),
  role: z.string().min(1).max(100),
  poolKind: z.enum(['orchestrator', 'specialist']).default('specialist'),
  runtimeImage: z.string().min(1),
  cpuLimit: z.string().optional(),
  memoryLimit: z.string().optional(),
  networkPolicy: z.string().default('restricted'),
  environment: z.record(z.unknown()).default({}),
  llmProvider: z.string().optional(),
  llmModel: z.string().optional(),
  llmApiKeySecretRef: z.string().optional(),
  replicas: z.number().int().positive().default(1),
  enabled: z.boolean().default(true),
});

const updateDesiredStateSchema = createDesiredStateSchema.partial().omit({ workerName: true });

export type CreateDesiredStateInput = z.infer<typeof createDesiredStateSchema>;
export type UpdateDesiredStateInput = z.infer<typeof updateDesiredStateSchema>;

function resolveCreateDesiredStateDefaults(input: CreateDesiredStateInput): CreateDesiredStateInput & {
  cpuLimit: string;
  memoryLimit: string;
} {
  const defaults =
    input.poolKind === 'orchestrator'
      ? {
          cpuLimit: DEFAULT_ORCHESTRATOR_CPU_LIMIT,
          memoryLimit: DEFAULT_ORCHESTRATOR_MEMORY_LIMIT,
        }
      : {
          cpuLimit: DEFAULT_SPECIALIST_CPU_LIMIT,
          memoryLimit: DEFAULT_SPECIALIST_MEMORY_LIMIT,
        };

  return {
    ...input,
    cpuLimit: input.cpuLimit ?? defaults.cpuLimit,
    memoryLimit: input.memoryLimit ?? defaults.memoryLimit,
  };
}

interface DesiredStateRow {
  [key: string]: unknown;
  id: string;
  tenant_id: string;
  worker_name: string;
  role: string;
  pool_kind: string;
  runtime_image: string;
  cpu_limit: string;
  memory_limit: string;
  network_policy: string;
  environment: Record<string, unknown>;
  llm_provider: string | null;
  llm_model: string | null;
  llm_api_key_secret_ref: string | null;
  replicas: number;
  enabled: boolean;
  restart_requested: boolean;
  draining: boolean;
  version: number;
  created_at: Date;
  updated_at: Date;
  updated_by: string | null;
  active_task_id?: string | null;
}

interface PublicDesiredStateRow extends Omit<DesiredStateRow, 'environment' | 'llm_api_key_secret_ref'> {
  environment: Record<string, unknown>;
  llm_api_key_secret_ref_configured: boolean;
}

interface ActualStateRow {
  id: string;
  desired_state_id: string;
  container_id: string | null;
  container_status: string | null;
  cpu_usage_percent: number | null;
  memory_usage_bytes: number | null;
  network_rx_bytes: number | null;
  network_tx_bytes: number | null;
  started_at: Date | null;
  last_updated: Date;
}

interface FleetWorkerView extends PublicDesiredStateRow {
  actual: ActualStateRow[];
}

interface ContainerView {
  [key: string]: unknown;
  id: string;
  container_id: string | null;
  name: string;
  status: string;
  image: string;
  worker_role: string;
  pool_kind: string;
  cpu_usage_percent: number | null;
  memory_usage_bytes: number | null;
  started_at: Date | null;
  last_updated: Date;
}

interface ContainerImageRow {
  id: string;
  repository: string;
  tag: string | null;
  digest: string | null;
  size_bytes: number | null;
  created_at: Date | null;
  last_seen: Date;
}

function toPublicDesiredStateRow(row: DesiredStateRow): PublicDesiredStateRow {
  const { llm_api_key_secret_ref: llmApiKeySecretRef, ...rest } = row;
  return {
    ...rest,
    environment: redactEnvironmentSecrets(row.environment),
    llm_api_key_secret_ref_configured:
      typeof llmApiKeySecretRef === 'string' && llmApiKeySecretRef.trim().length > 0,
  };
}

const ACTIVE_WORKER_TASK_STATES = ['claimed', 'in_progress'] as const;

function redactEnvironmentSecrets(
  environment: Record<string, unknown>,
  inheritedSecret = false,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(environment).map(([key, value]) => {
      const branchIsSecret = inheritedSecret || isSecretLikeKey(key);
      return [key, redactEnvironmentValue(value, branchIsSecret)];
    }),
  );
}

function redactEnvironmentValue(value: unknown, inheritedSecret: boolean): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => redactEnvironmentValue(entry, inheritedSecret));
  }

  if (value && typeof value === 'object') {
    return redactEnvironmentSecrets(value as Record<string, unknown>, inheritedSecret);
  }

  if (typeof value !== 'string') {
    return value;
  }

  const normalized = value.trim();
  if (normalized.length === 0) {
    return value;
  }

  if (inheritedSecret || isSecretReference(normalized) || isSecretLikeValue(normalized)) {
    return FLEET_ENV_SECRET_REDACTION;
  }

  return value;
}

function isSecretReference(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith('secret:') || normalized.startsWith('redacted://');
}

function isSecretLikeKey(key: string): boolean {
  return secretLikeKeyPattern.test(key);
}

function sanitizeFleetEventRows<T extends { payload?: Record<string, unknown> | null }>(rows: T[]): T[] {
  return rows.map((row) => sanitizeFleetEventRow(row));
}

function sanitizeFleetEventRow<T extends { payload?: Record<string, unknown> | null }>(row: T): T {
  return {
    ...row,
    payload: sanitizeFleetEventPayload(row.payload),
  };
}

function sanitizeFleetEventPayload(payload: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!payload) {
    return {};
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    sanitized[key] = sanitizeFleetEventValue(value, isSecretLikeKey(key));
  }
  return sanitized;
}

function sanitizeFleetEventValue(value: unknown, inheritedSecret: boolean): unknown {
  if (typeof value === 'string') {
    return inheritedSecret || isSecretLikeValue(value) ? FLEET_EVENT_SECRET_REDACTION : value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeFleetEventValue(entry, inheritedSecret));
  }

  if (value && typeof value === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      sanitized[key] = sanitizeFleetEventValue(nestedValue, inheritedSecret || isSecretLikeKey(key));
    }
    return sanitized;
  }

  return value;
}

function isSecretLikeValue(value: string): boolean {
  const normalized = value.trim();
  if (normalized.length === 0) {
    return false;
  }
  return secretLikeValuePattern.test(normalized);
}

function validateDesiredStateSecrets(input: {
  environment?: Record<string, unknown>;
  llmApiKeySecretRef?: string;
}): void {
  validateEnvironmentSecrets(input.environment ?? {}, []);
  validateLlmSecretRef(input.llmApiKeySecretRef);
}

function validateDesiredStateResources(input: {
  runtimeImage?: string;
  cpuLimit?: string;
  memoryLimit?: string;
}): void {
  if (typeof input.runtimeImage === 'string') {
    assertValidContainerImage(input.runtimeImage, 'Runtime image');
  }
  if (typeof input.cpuLimit === 'string') {
    assertValidContainerCpu(input.cpuLimit, 'CPU limit');
  }
  if (typeof input.memoryLimit === 'string') {
    assertValidContainerMemory(input.memoryLimit, 'Memory limit');
  }
}

function validateEnvironmentSecrets(
  environment: Record<string, unknown>,
  path: string[],
): void {
  for (const [key, value] of Object.entries(environment)) {
    validateEnvironmentValue(key, value, [...path, key], isSecretLikeKey(key));
  }
}

function validateEnvironmentValue(
  key: string,
  value: unknown,
  path: string[],
  inheritedSecret: boolean,
): void {
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      validateEnvironmentValue(key, entry, [...path, String(index)], inheritedSecret);
    }
    return;
  }

  if (value && typeof value === 'object') {
    for (const [nestedKey, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      validateEnvironmentValue(
        nestedKey,
        nestedValue,
        [...path, nestedKey],
        inheritedSecret || isSecretLikeKey(nestedKey),
      );
    }
    return;
  }

  if (typeof value !== 'string') {
    return;
  }

  const normalized = value.trim();
  if (normalized.length === 0 || isSecretReference(normalized)) {
    return;
  }

  if (inheritedSecret || isSecretLikeValue(normalized)) {
    throw new ValidationError(
      `Environment field ${path.join('.')} must use secret: references instead of plaintext secret values`,
    );
  }
}

function validateLlmSecretRef(value: string | undefined): void {
  if (value === undefined) {
    return;
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    return;
  }
  if (!normalized.toLowerCase().startsWith('secret:')) {
    throw new ValidationError('llmApiKeySecretRef must use secret: references');
  }
}

export class FleetService {
  private readonly logger: FleetLogger;

  constructor(
    private readonly pool: DatabasePool,
    logger?: FleetLogger,
  ) {
    this.logger = logger ?? SILENT_LOGGER;
  }

  async listWorkers(
    tenantId: string,
    options: { enabledOnly?: boolean } = {},
  ): Promise<FleetWorkerView[]> {
    const repo = new TenantScopedRepository(this.pool, tenantId);
    const conditions = options.enabledOnly ? ['enabled = $2'] : [];
    const values = options.enabledOnly ? [true] : [];
    const desired = await repo.findAll<DesiredStateRow>(
      'worker_desired_state',
      '*',
      conditions,
      values,
    );
    if (desired.length === 0) {
      return [];
    }

    const desiredStateIds = desired.map((row) => row.id);
    const actualResult = await this.pool.query<ActualStateRow>(
      'SELECT * FROM worker_actual_state WHERE desired_state_id = ANY($1::uuid[])',
      [desiredStateIds],
    );
    const actualByDesiredState = new Map<string, ActualStateRow[]>();
    for (const row of actualResult.rows) {
      const existing = actualByDesiredState.get(row.desired_state_id);
      if (existing) {
        existing.push(row);
      } else {
        actualByDesiredState.set(row.desired_state_id, [row]);
      }
    }
    const activeTaskByDesiredState = await this.loadDesiredStateActiveTasks(tenantId, desiredStateIds);

    const views: FleetWorkerView[] = [];
    for (const d of desired) {
      views.push({
        ...toPublicDesiredStateRow({
          ...d,
          active_task_id: activeTaskByDesiredState.get(d.id) ?? null,
        }),
        actual: actualByDesiredState.get(d.id) ?? [],
      });
    }
    return views;
  }

  async getWorker(tenantId: string, id: string): Promise<FleetWorkerView> {
    const repo = new TenantScopedRepository(this.pool, tenantId);
    const row = await repo.findById<DesiredStateRow>('worker_desired_state', '*', id);
    if (!row) throw new NotFoundError('Fleet worker not found');

    const actual = await this.pool.query<ActualStateRow>(
      'SELECT * FROM worker_actual_state WHERE desired_state_id = $1',
      [id],
    );
    const activeTaskByDesiredState = await this.loadDesiredStateActiveTasks(tenantId, [id]);
    return {
      ...toPublicDesiredStateRow({
        ...row,
        active_task_id: activeTaskByDesiredState.get(id) ?? null,
      }),
      actual: actual.rows,
    };
  }

  async createWorker(tenantId: string, input: CreateDesiredStateInput): Promise<PublicDesiredStateRow> {
    const validated = resolveCreateDesiredStateDefaults(createDesiredStateSchema.parse(input));
    validateDesiredStateResources(validated);
    validateDesiredStateSecrets(validated);

    const result = await this.pool.query<DesiredStateRow>(
      `INSERT INTO worker_desired_state (
        tenant_id, worker_name, role, pool_kind, runtime_image, cpu_limit, memory_limit,
        network_policy, environment, llm_provider, llm_model, llm_api_key_secret_ref,
        replicas, enabled
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *`,
      [
        tenantId,
        validated.workerName,
        validated.role,
        validated.poolKind,
        validated.runtimeImage,
        validated.cpuLimit,
        validated.memoryLimit,
        validated.networkPolicy,
        validated.environment,
        validated.llmProvider ?? null,
        validated.llmModel ?? null,
        validated.llmApiKeySecretRef ?? null,
        validated.replicas,
        validated.enabled,
      ],
    );
    return toPublicDesiredStateRow(result.rows[0]);
  }

  async updateWorker(tenantId: string, id: string, input: UpdateDesiredStateInput): Promise<PublicDesiredStateRow> {
    const validated = updateDesiredStateSchema.parse(input);
    validateDesiredStateResources(validated);
    validateDesiredStateSecrets(validated);
    const setClauses: string[] = [];
    const values: unknown[] = [tenantId, id];
    let paramIndex = 3;

    const fields: Array<[string, unknown]> = [
      ['role', validated.role],
      ['pool_kind', validated.poolKind],
      ['runtime_image', validated.runtimeImage],
      ['cpu_limit', validated.cpuLimit],
      ['memory_limit', validated.memoryLimit],
      ['network_policy', validated.networkPolicy],
      ['environment', validated.environment ? JSON.stringify(validated.environment) : undefined],
      ['llm_provider', validated.llmProvider],
      ['llm_model', validated.llmModel],
      ['llm_api_key_secret_ref', validated.llmApiKeySecretRef],
      ['replicas', validated.replicas],
      ['enabled', validated.enabled],
    ];

    for (const [column, value] of fields) {
      if (value !== undefined) {
        setClauses.push(`${column} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
      }
    }

    if (setClauses.length === 0) {
      return toPublicDesiredStateRow(await this.loadDesiredStateRow(tenantId, id));
    }

    setClauses.push('version = version + 1');
    setClauses.push('updated_at = NOW()');

    const result = await this.pool.query<DesiredStateRow>(
      `UPDATE worker_desired_state SET ${setClauses.join(', ')} WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      values,
    );
    if (!result.rowCount) throw new NotFoundError('Fleet worker not found');
    return toPublicDesiredStateRow(result.rows[0]);
  }

  async deleteWorker(tenantId: string, id: string): Promise<void> {
    const result = await this.pool.query(
      'UPDATE worker_desired_state SET enabled = false, updated_at = NOW() WHERE tenant_id = $1 AND id = $2',
      [tenantId, id],
    );
    if (!result.rowCount) throw new NotFoundError('Fleet worker not found');
  }

  async restartWorker(tenantId: string, id: string): Promise<PublicDesiredStateRow> {
    const result = await this.pool.query<DesiredStateRow>(
      `UPDATE worker_desired_state SET restart_requested = true, updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      [tenantId, id],
    );
    if (!result.rowCount) throw new NotFoundError('Fleet worker not found');
    return toPublicDesiredStateRow(result.rows[0]);
  }

  async acknowledgeWorkerRestart(tenantId: string, id: string): Promise<PublicDesiredStateRow> {
    const result = await this.pool.query<DesiredStateRow>(
      `UPDATE worker_desired_state SET restart_requested = false, updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      [tenantId, id],
    );
    if (!result.rowCount) throw new NotFoundError('Fleet worker not found');
    return toPublicDesiredStateRow(result.rows[0]);
  }

  async drainWorker(tenantId: string, id: string): Promise<PublicDesiredStateRow> {
    const result = await this.pool.query<DesiredStateRow>(
      `UPDATE worker_desired_state SET draining = true, updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      [tenantId, id],
    );
    if (!result.rowCount) throw new NotFoundError('Fleet worker not found');
    return toPublicDesiredStateRow(result.rows[0]);
  }

  async drainAllRuntimesForTenant(tenantId: string): Promise<number> {
    const result = await this.pool.query(
      `UPDATE runtime_heartbeats
          SET drain_requested = true
        WHERE tenant_id = $1`,
      [tenantId],
    );
    return result.rowCount ?? 0;
  }

  async listContainers(tenantId: string): Promise<ContainerView[]> {
    const result = await this.pool.query<ContainerView>(
      `SELECT
         was.id,
         was.container_id,
         wds.worker_name AS name,
         COALESCE(was.container_status, 'unknown') AS status,
         wds.runtime_image AS image,
         wds.role AS worker_role,
         wds.pool_kind,
         was.cpu_usage_percent,
         was.memory_usage_bytes,
         was.started_at,
         was.last_updated
       FROM worker_actual_state was
       JOIN worker_desired_state wds ON wds.id = was.desired_state_id
       WHERE wds.tenant_id = $1`,
      [tenantId],
    );
    return result.rows;
  }

  async getContainerStats(id: string): Promise<ActualStateRow> {
    const result = await this.pool.query<ActualStateRow>(
      'SELECT * FROM worker_actual_state WHERE id = $1',
      [id],
    );
    if (!result.rowCount) throw new NotFoundError('Container not found');
    return result.rows[0];
  }

  async listImages(): Promise<ContainerImageRow[]> {
    const result = await this.pool.query<ContainerImageRow>(
      'SELECT * FROM container_images ORDER BY last_seen DESC',
    );
    return result.rows;
  }

  async reportActualState(
    desiredStateId: string,
    containerId: string,
    status: string,
    stats: { cpuPercent?: number; memoryBytes?: number; rxBytes?: number; txBytes?: number },
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO worker_actual_state (desired_state_id, container_id, container_status, cpu_usage_percent, memory_usage_bytes, network_rx_bytes, network_tx_bytes, last_updated)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (desired_state_id, container_id) DO UPDATE SET
         container_status = $3, cpu_usage_percent = $4,
         memory_usage_bytes = $5, network_rx_bytes = $6, network_tx_bytes = $7, last_updated = NOW()`,
      [
        desiredStateId,
        containerId,
        status,
        stats.cpuPercent ?? null,
        stats.memoryBytes ?? null,
        stats.rxBytes ?? null,
        stats.txBytes ?? null,
      ],
    );
  }

  async pruneStaleActualState(desiredStateId: string, activeContainerIds: string[]): Promise<number> {
    if (activeContainerIds.length === 0) {
      return 0;
    }
    const placeholders = activeContainerIds.map((_, i) => `$${i + 2}`).join(', ');
    const result = await this.pool.query(
      `DELETE FROM worker_actual_state
       WHERE desired_state_id = $1
         AND container_id NOT IN (${placeholders})`,
      [desiredStateId, ...activeContainerIds],
    );
    return result.rowCount ?? 0;
  }

  async pruneStaleHeartbeats(): Promise<number> {
    const result = await this.pool.query(
      `DELETE FROM runtime_heartbeats rh
       USING runtime_defaults rd
       WHERE rd.tenant_id = rh.tenant_id
         AND rd.config_key = $1
         AND rh.last_heartbeat_at < now() - make_interval(secs => rd.config_value::int)`,
      [CONTAINER_MANAGER_RUNTIME_DEFAULTS.hungRuntimeStaleAfterSeconds],
    );
    return result.rowCount ?? 0;
  }

  async pruneStaleContainers(tenantId: string): Promise<number> {
    const result = await this.pool.query(
      `DELETE FROM worker_actual_state
       WHERE desired_state_id IN (
         SELECT id FROM worker_desired_state WHERE tenant_id = $1
       )
       AND container_status IN ($2, $3)`,
      [tenantId, 'exited', 'dead'],
    );
    return result.rowCount ?? 0;
  }

  async requestImagePull(repository: string, tag: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO container_images (repository, tag, last_seen)
       VALUES ($1, $2, NOW())
       ON CONFLICT (repository, tag) DO UPDATE SET last_seen = NOW()`,
      [repository, tag],
    );
  }

  async reportImage(repository: string, tag: string | null, digest: string | null, sizeBytes: number | null): Promise<void> {
    await this.pool.query(
      `INSERT INTO container_images (repository, tag, digest, size_bytes, last_seen)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (repository, tag) DO UPDATE SET
         digest = $3, size_bytes = $4, last_seen = NOW()`,
      [repository, tag, digest, sizeBytes],
    );
  }

  // --- Dynamic Container Management ---

  async getQueueDepth(tenantId: string, playbookId?: string): Promise<QueueDepthResult> {
    const baseQuery = `
      SELECT t.workflow_id, w.playbook_id
      FROM tasks t
      JOIN workflows w ON w.id = t.workflow_id AND w.tenant_id = t.tenant_id
      WHERE t.tenant_id = $1
        AND t.state = 'ready'
        AND w.state NOT IN ('cancelled', 'failed', 'completed')
        AND w.playbook_id IS NOT NULL`;

    const params: unknown[] = [tenantId];
    const playbookFilter = playbookId
      ? ` AND w.playbook_id = $${params.push(playbookId)}`
      : '';

    const result = await this.pool.query<{ playbook_id: string }>(
      `SELECT playbook_id, COUNT(*)::int AS count
       FROM (${baseQuery}${playbookFilter}) sub
       GROUP BY playbook_id`,
      params,
    );

    const byPlaybook: Record<string, number> = {};
    let totalPending = 0;
    for (const row of result.rows) {
      const count = (row as unknown as Record<string, number>).count;
      byPlaybook[row.playbook_id] = count;
      totalPending += count;
    }

    return { total_pending: totalPending, by_playbook: byPlaybook };
  }

  private async loadRuntimeDefaults(tenantId: string): Promise<Map<string, string>> {
    const result = await this.pool.query<{ config_key: string; config_value: string }>(
      'SELECT config_key, config_value FROM runtime_defaults WHERE tenant_id = $1',
      [tenantId],
    );
    const defaults = new Map<string, string>();
    for (const row of result.rows) {
      defaults.set(row.config_key, row.config_value);
    }
    return defaults;
  }

  async getRuntimeTargets(tenantId: string): Promise<RuntimeTarget[]> {
    const defaults = await this.loadRuntimeDefaults(tenantId);
    const heartbeatFreshnessSeconds = readRuntimeHeartbeatFreshnessSeconds(defaults);
    const stats = await this.loadSpecialistRuntimeStats(tenantId, heartbeatFreshnessSeconds);
    if (stats.pending_tasks <= 0 && stats.active_runtimes <= 0) {
      return [];
    }

    const runtimeDefaults = readSpecialistRuntimeTargetDefaults(defaults);
    const routingTags = await this.loadSpecialistRoutingTags(tenantId);
    const globalMaxSpecialists = readRequiredIntegerDefault(
      defaults,
      CONTAINER_MANAGER_RUNTIME_DEFAULTS.globalMaxSpecialists,
    );
    const availableExecutionSlots = Math.max(
      globalMaxSpecialists - stats.active_execution_containers,
      0,
    );
    return [
      {
        playbook_id: GENERIC_SPECIALIST_TARGET_ID,
        playbook_name: GENERIC_SPECIALIST_TARGET_NAME,
        pool_kind: 'specialist',
        routing_tags: routingTags,
        pool_mode: 'cold',
        max_runtimes: globalMaxSpecialists,
        priority: 0,
        idle_timeout_seconds: 0,
        grace_period_seconds: runtimeDefaults.drainGraceSeconds,
        image: runtimeDefaults.image,
        pull_policy: runtimeDefaults.pullPolicy,
        cpu: runtimeDefaults.cpu,
        memory: runtimeDefaults.memory,
        pending_tasks: stats.pending_tasks,
        active_workflows: 0,
        active_execution_containers: stats.active_execution_containers,
        available_execution_slots: availableExecutionSlots,
      },
    ];
  }

  private async loadSpecialistRuntimeStats(
    tenantId: string,
    heartbeatFreshnessSeconds: number,
  ): Promise<SpecialistRuntimeStatsRow> {
    const result = await this.pool.query<SpecialistRuntimeStatsRow>(
      `WITH ready_specialist_tasks AS (
         SELECT 1
           FROM tasks
          WHERE tenant_id = $1
            AND state = 'ready'
            AND COALESCE(is_orchestrator_task, false) = false
       ),
       specialist_runtime_heartbeats AS (
         SELECT COUNT(*)::int AS active_runtimes
           FROM runtime_heartbeats
          WHERE tenant_id = $1
            AND pool_kind = 'specialist'
            AND last_heartbeat_at >= now() - make_interval(secs => $2)
       ),
       active_execution_leases AS (
         SELECT COUNT(*)::int AS active_execution_containers
           FROM execution_container_leases
          WHERE tenant_id = $1
            AND released_at IS NULL
       )
       SELECT
         (SELECT COUNT(*)::int FROM ready_specialist_tasks) AS pending_tasks,
         (SELECT active_runtimes FROM specialist_runtime_heartbeats) AS active_runtimes,
         (SELECT active_execution_containers FROM active_execution_leases) AS active_execution_containers`,
      [tenantId, heartbeatFreshnessSeconds],
    );
    return result.rows[0] ?? {
      pending_tasks: 0,
      active_runtimes: 0,
      active_execution_containers: 0,
    };
  }

  private async loadSpecialistRoutingTags(tenantId: string): Promise<string[]> {
    const result = await this.pool.query<RoleCatalogRow>(
      `SELECT name
         FROM role_definitions
        WHERE tenant_id = $1
          AND is_active = true`,
      [tenantId],
    );

    const tags = new Set<string>();
    for (const row of result.rows) {
      const roleName = row.name.trim();
      if (roleName.length === 0 || roleName === 'orchestrator') {
        continue;
      }
      tags.add(`role:${roleName}`);
    }
    return [...tags];
  }

  async getReconcileSnapshot(tenantId: string): Promise<{
    desired_states: FleetWorkerView[];
    runtime_targets: RuntimeTarget[];
    heartbeats: HeartbeatListRow[];
    container_manager_config: ContainerManagerConfig;
  }> {
    const [desiredStates, runtimeTargets, heartbeats, defaults] = await Promise.all([
      this.listWorkers(tenantId, { enabledOnly: true }),
      this.getRuntimeTargets(tenantId),
      this.listHeartbeats(tenantId),
      this.loadRuntimeDefaults(tenantId),
    ]);

    return {
      desired_states: desiredStates,
      runtime_targets: runtimeTargets,
      heartbeats,
      container_manager_config: buildContainerManagerConfig(defaults),
    };
  }

  private async loadDesiredStateActiveTasks(
    tenantId: string,
    desiredStateIds: string[],
  ): Promise<Map<string, string>> {
    if (desiredStateIds.length === 0) {
      return new Map<string, string>();
    }

    const result = await this.pool.query<{ desired_state_id: string; active_task_id: string }>(
      `SELECT DISTINCT ON (was.desired_state_id)
              was.desired_state_id,
              t.id AS active_task_id
         FROM worker_actual_state was
         JOIN workers w
           ON w.tenant_id = $1
          AND COALESCE(w.metadata->>'instance_id', '') <> ''
          AND was.container_id LIKE (w.metadata->>'instance_id') || '%'
         JOIN tasks t
           ON t.tenant_id = $1
          AND t.assigned_worker_id = w.id
          AND t.state = ANY($3::task_state[])
        WHERE was.desired_state_id = ANY($2::uuid[])
        ORDER BY was.desired_state_id ASC, t.updated_at DESC`,
      [tenantId, desiredStateIds, [...ACTIVE_WORKER_TASK_STATES]],
    );

    return new Map<string, string>(
      result.rows
        .filter((row) => row.active_task_id.trim().length > 0)
        .map((row) => [row.desired_state_id, row.active_task_id]),
    );
  }

  private async loadDesiredStateRow(tenantId: string, id: string): Promise<DesiredStateRow> {
    const repo = new TenantScopedRepository(this.pool, tenantId);
    const row = await repo.findById<DesiredStateRow>('worker_desired_state', '*', id);
    if (!row) {
      throw new NotFoundError('Fleet worker not found');
    }
    return row;
  }

  async recordHeartbeat(
    tenantId: string,
    payload: HeartbeatPayload,
  ): Promise<HeartbeatAck> {
    const validStates = ['idle', 'executing', 'draining'];
    if (!validStates.includes(payload.state)) {
      throw new ValidationError(`Invalid heartbeat state: ${payload.state}`);
    }
    if (!isPoolKind(payload.pool_kind)) {
      throw new ValidationError(`Invalid heartbeat pool kind: ${payload.pool_kind}`);
    }

    const playbookId = normalizeRuntimeHeartbeatPlaybookID(payload.playbook_id);

    const result = await this.pool.query<{ drain_requested: boolean }>(
      `INSERT INTO runtime_heartbeats (
         runtime_id, tenant_id, playbook_id, pool_kind, state, task_id,
         uptime_seconds, last_claim_at, image, last_heartbeat_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
       ON CONFLICT (runtime_id) DO UPDATE SET
         playbook_id = EXCLUDED.playbook_id,
         pool_kind = $4,
         state = $5,
         task_id = $6,
         uptime_seconds = $7,
         last_claim_at = COALESCE($8, runtime_heartbeats.last_claim_at),
         last_heartbeat_at = NOW()
       RETURNING drain_requested`,
      [
        payload.runtime_id,
        tenantId,
        playbookId,
        payload.pool_kind,
        payload.state,
        payload.task_id ?? null,
        payload.uptime_seconds ?? 0,
        payload.last_claim_at ?? null,
        payload.image ?? 'agirunner-runtime:local',
      ],
    );

    const drainRequested = result.rows[0]?.drain_requested ?? false;
    return {
      runtime_id: payload.runtime_id,
      playbook_id: playbookId,
      pool_kind: payload.pool_kind,
      state: payload.state,
      task_id: payload.task_id ?? null,
      should_drain: drainRequested,
    };
  }

  async listHeartbeats(tenantId: string): Promise<HeartbeatListRow[]> {
    const result = await this.pool.query<HeartbeatListRow>(
      `SELECT runtime_id, playbook_id, pool_kind, state,
              to_char(last_heartbeat_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_heartbeat_at,
              task_id AS active_task_id
       FROM runtime_heartbeats
       WHERE tenant_id = $1`,
      [tenantId],
    );
    return result.rows;
  }

  async getFleetStatus(tenantId: string): Promise<FleetStatus> {
    const runtimeDefaults = await this.loadRuntimeDefaults(tenantId);
    const globalMaxRuntimes = readRequiredIntegerDefault(
      runtimeDefaults,
      CONTAINER_MANAGER_RUNTIME_DEFAULTS.globalMaxSpecialists,
    );
    const heartbeatFreshnessSeconds = readRuntimeHeartbeatFreshnessSeconds(runtimeDefaults);

    const heartbeats = await this.pool.query<HeartbeatRow>(
      `SELECT
         rh.*,
         COALESCE(
           p.name,
           CASE
             WHEN rh.pool_kind = 'specialist' AND rh.playbook_id IS NULL THEN $2
             ELSE 'Unknown runtime target'
           END
         ) AS playbook_name
       FROM runtime_heartbeats rh
       LEFT JOIN playbooks p ON p.id = rh.playbook_id
       WHERE rh.tenant_id = $1
         AND rh.last_heartbeat_at >= now() - make_interval(secs => $3)`,
      [tenantId, GENERIC_SPECIALIST_TARGET_NAME, heartbeatFreshnessSeconds],
    );

    let totalRunning = 0;
    let totalIdle = 0;
    let totalExecuting = 0;
    let totalDraining = 0;
    const playbookMap = new Map<string, PlaybookFleetSummary>();
    const playbookPoolMap = new Map<string, PlaybookPoolFleetSummary>();

    for (const hb of heartbeats.rows) {
      totalRunning++;
      if (hb.state === 'idle') totalIdle++;
      else if (hb.state === 'executing') totalExecuting++;
      else if (hb.state === 'draining') totalDraining++;

      const playbookKey = heartbeatPlaybookKey(hb.playbook_id, hb.pool_kind);
      let summary = playbookMap.get(playbookKey);
      if (!summary) {
        summary = {
          playbook_id: playbookKey,
          playbook_name: hb.playbook_name,
          max_runtimes: 0,
          running: 0,
          idle: 0,
          executing: 0,
          pending_tasks: 0,
          active_workflows: 0,
        };
        playbookMap.set(playbookKey, summary);
      }
      summary.running++;
      if (hb.state === 'idle') summary.idle++;
      else if (hb.state === 'executing') summary.executing++;

      const poolKind = isPoolKind(hb.pool_kind) ? hb.pool_kind : 'specialist';
      const poolKey = `${playbookKey}:${poolKind}`;
      let poolSummary = playbookPoolMap.get(poolKey);
      if (!poolSummary) {
        poolSummary = {
          playbook_id: playbookKey,
          playbook_name: hb.playbook_name,
          pool_kind: poolKind,
          max_runtimes: 0,
          running: 0,
          idle: 0,
          executing: 0,
          draining: 0,
          pending_tasks: 0,
          active_workflows: 0,
        };
        playbookPoolMap.set(poolKey, poolSummary);
      }
      poolSummary.running++;
      if (hb.state === 'idle') poolSummary.idle++;
      else if (hb.state === 'executing') poolSummary.executing++;
      else if (hb.state === 'draining') poolSummary.draining++;
    }

    const targets = await this.getRuntimeTargets(tenantId);
    for (const target of targets) {
      const summary = playbookMap.get(target.playbook_id);
      if (summary) {
        summary.max_runtimes += target.max_runtimes;
        summary.pending_tasks += target.pending_tasks;
        summary.active_workflows = Math.max(summary.active_workflows, target.active_workflows);
      } else {
        playbookMap.set(target.playbook_id, {
          playbook_id: target.playbook_id,
          playbook_name: target.playbook_name,
          max_runtimes: target.max_runtimes,
          running: 0,
          idle: 0,
          executing: 0,
          pending_tasks: target.pending_tasks,
          active_workflows: target.active_workflows,
        });
      }

      const poolKey = `${target.playbook_id}:${target.pool_kind}`;
      const poolSummary = playbookPoolMap.get(poolKey);
      if (poolSummary) {
        poolSummary.max_runtimes = target.max_runtimes;
        poolSummary.pending_tasks = target.pending_tasks;
        poolSummary.active_workflows = target.active_workflows;
      } else {
        playbookPoolMap.set(poolKey, {
          playbook_id: target.playbook_id,
          playbook_name: target.playbook_name,
          pool_kind: target.pool_kind,
          max_runtimes: target.max_runtimes,
          running: 0,
          idle: 0,
          executing: 0,
          draining: 0,
          pending_tasks: target.pending_tasks,
          active_workflows: target.active_workflows,
        });
      }
    }

    const workerPools = await this.getWorkerPoolStatus(tenantId);

    const recentEventsResult = await this.pool.query<FleetEventRow>(
      `SELECT * FROM fleet_events
       WHERE tenant_id = $1
       ORDER BY created_at DESC
       LIMIT 20`,
      [tenantId],
    );

    return {
      global_max_runtimes: globalMaxRuntimes,
      total_running: totalRunning,
      total_idle: totalIdle,
      total_executing: totalExecuting,
      total_draining: totalDraining,
      worker_pools: workerPools,
      by_playbook: [...playbookMap.values()],
      by_playbook_pool: [...playbookPoolMap.values()],
      recent_events: sanitizeFleetEventRows(recentEventsResult.rows),
    };
  }

  async listFleetEvents(
    tenantId: string,
    filters: FleetEventFilters,
  ): Promise<{ events: FleetEventRow[]; total: number }> {
    const conditions = ['fe.tenant_id = $1'];
    const params: unknown[] = [tenantId];
    let paramIndex = 2;

    if (filters.playbook_id) {
      conditions.push(`fe.playbook_id = $${paramIndex++}`);
      params.push(filters.playbook_id);
    }
    if (filters.runtime_id) {
      conditions.push(`fe.runtime_id = $${paramIndex++}`);
      params.push(filters.runtime_id);
    }
    if (filters.since) {
      conditions.push(`fe.created_at >= $${paramIndex++}`);
      params.push(filters.since);
    }
    if (filters.until) {
      conditions.push(`fe.created_at <= $${paramIndex++}`);
      params.push(filters.until);
    }

    const whereClause = conditions.join(' AND ');
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;

    const countResult = await this.pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM fleet_events fe WHERE ${whereClause}`,
      params,
    );

    const eventsResult = await this.pool.query<FleetEventRow>(
      `SELECT fe.* FROM fleet_events fe
       WHERE ${whereClause}
       ORDER BY fe.created_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      [...params, limit, offset],
    );

    return {
      events: sanitizeFleetEventRows(eventsResult.rows),
      total: countResult.rows[0]?.count ?? 0,
    };
  }

  async drainRuntime(tenantId: string, runtimeId: string): Promise<void> {
    const result = await this.pool.query(
      `UPDATE runtime_heartbeats SET drain_requested = true
       WHERE tenant_id = $1 AND runtime_id = $2`,
      [tenantId, runtimeId],
    );
    if (!result.rowCount) {
      throw new NotFoundError(`Runtime heartbeat not found: ${runtimeId}`);
    }
  }

  async removeHeartbeat(tenantId: string, runtimeId: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM runtime_heartbeats
       WHERE tenant_id = $1
         AND runtime_id = $2`,
      [tenantId, runtimeId],
    );
  }

  async recordFleetEvent(tenantId: string, event: RecordFleetEventInput): Promise<void> {
    if (!VALID_FLEET_EVENT_TYPES.has(event.event_type)) {
      throw new ValidationError(`Invalid fleet event type: ${event.event_type}`);
    }
    if (event.level && !VALID_FLEET_EVENT_LEVELS.has(event.level)) {
      throw new ValidationError(`Invalid fleet event level: ${event.level}`);
    }
    const playbookId = normalizeRuntimeHeartbeatPlaybookID(event.playbook_id);
    await this.pool.query(
      `INSERT INTO fleet_events (
         tenant_id, event_type, level, runtime_id, playbook_id,
         task_id, workflow_id, container_id, payload
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        tenantId,
        event.event_type,
        event.level ?? 'info',
        event.runtime_id ?? null,
        playbookId,
        event.task_id ?? null,
        event.workflow_id ?? null,
        event.container_id ?? null,
        JSON.stringify(sanitizeFleetEventPayload(event.payload ?? {})),
      ],
    );
  }

  private async getWorkerPoolStatus(tenantId: string): Promise<WorkerPoolSummary[]> {
    const result = await this.pool.query<WorkerPoolSummaryRow>(
      `WITH worker_summary AS (
          SELECT pool_kind,
                 COUNT(*)::int AS desired_workers,
                 COALESCE(SUM(replicas), 0)::int AS desired_replicas,
                 COUNT(*) FILTER (WHERE enabled)::int AS enabled_workers,
                 COUNT(*) FILTER (WHERE draining)::int AS draining_workers
            FROM worker_desired_state
           WHERE tenant_id = $1
           GROUP BY pool_kind
        ), container_counts AS (
          SELECT wds.pool_kind,
                 COUNT(was.id)::int AS running_containers
            FROM worker_desired_state wds
            LEFT JOIN worker_actual_state was
              ON was.desired_state_id = wds.id
             AND COALESCE(was.container_status, 'unknown') NOT IN ('exited', 'dead')
           WHERE wds.tenant_id = $1
           GROUP BY wds.pool_kind
        )
        SELECT ws.pool_kind, ws.desired_workers, ws.desired_replicas,
               ws.enabled_workers, ws.draining_workers,
               COALESCE(cc.running_containers, 0)::int AS running_containers
          FROM worker_summary ws
          LEFT JOIN container_counts cc ON cc.pool_kind = ws.pool_kind
         ORDER BY ws.pool_kind ASC`,
      [tenantId],
    );

    return result.rows.map((row) => ({
      pool_kind: isPoolKind(row.pool_kind) ? row.pool_kind : 'specialist',
      desired_workers: row.desired_workers,
      desired_replicas: row.desired_replicas,
      enabled_workers: row.enabled_workers,
      draining_workers: row.draining_workers,
      running_containers: row.running_containers,
    }));
  }
}

// --- DCM Types ---

export interface QueueDepthResult {
  total_pending: number;
  by_playbook: Record<string, number>;
}

export interface RuntimeTarget {
  playbook_id: string;
  playbook_name: string;
  pool_kind: PlaybookRuntimePoolKind;
  routing_tags: string[];
  pool_mode: string;
  max_runtimes: number;
  priority: number;
  idle_timeout_seconds: number;
  grace_period_seconds: number;
  image: string;
  pull_policy: string;
  cpu: string;
  memory: string;
  pending_tasks: number;
  active_workflows: number;
  active_execution_containers?: number;
  available_execution_slots?: number;
}

interface SpecialistRuntimeStatsRow {
  pending_tasks: number;
  active_runtimes: number;
  active_execution_containers: number;
}

interface RoleCatalogRow {
  name: string;
}

const SPECIALIST_RUNTIME_TARGET_DEFAULT_KEYS = {
  image: SPECIALIST_RUNTIME_DEFAULT_KEYS.image,
  cpu: SPECIALIST_RUNTIME_DEFAULT_KEYS.cpu,
  memory: SPECIALIST_RUNTIME_DEFAULT_KEYS.memory,
  pullPolicy: SPECIALIST_RUNTIME_DEFAULT_KEYS.pullPolicy,
  bootstrapClaimTimeoutSeconds: SPECIALIST_RUNTIME_DEFAULT_KEYS.bootstrapClaimTimeoutSeconds,
  drainGraceSeconds: SPECIALIST_RUNTIME_DEFAULT_KEYS.drainGraceSeconds,
} as const;

interface SpecialistRuntimeTargetDefaults {
  image: string;
  cpu: string;
  memory: string;
  pullPolicy: string;
  bootstrapClaimTimeoutSeconds: number;
  drainGraceSeconds: number;
}

const CONTAINER_MANAGER_RUNTIME_DEFAULTS = {
  platformApiRequestTimeoutSeconds: 'platform.api_request_timeout_seconds',
  platformLogIngestTimeoutSeconds: 'platform.log_ingest_timeout_seconds',
  reconcileIntervalSeconds: 'container_manager.reconcile_interval_seconds',
  stopTimeoutSeconds: 'container_manager.stop_timeout_seconds',
  shutdownTaskStopTimeoutSeconds: 'container_manager.shutdown_task_stop_timeout_seconds',
  dockerActionBufferSeconds: 'container_manager.docker_action_buffer_seconds',
  logFlushIntervalMs: 'container_manager.log_flush_interval_ms',
  dockerEventReconnectBackoffMs: 'container_manager.docker_event_reconnect_backoff_ms',
  crashLogCaptureTimeoutSeconds: 'container_manager.crash_log_capture_timeout_seconds',
  starvationThresholdSeconds: 'container_manager.starvation_threshold_seconds',
  runtimeOrphanGraceCycles: 'container_manager.runtime_orphan_grace_cycles',
  hungRuntimeStaleAfterSeconds: 'container_manager.hung_runtime_stale_after_seconds',
  hungRuntimeStopGracePeriodSeconds: 'container_manager.hung_runtime_stop_grace_period_seconds',
  globalMaxSpecialists: GLOBAL_MAX_SPECIALISTS_RUNTIME_KEY,
  runtimeLogMaxSizeMB: 'container_manager.runtime_log_max_size_mb',
  runtimeLogMaxFiles: 'container_manager.runtime_log_max_files',
} as const;

function buildContainerManagerConfig(defaults: Map<string, string>): ContainerManagerConfig {
  return {
    platform_api_request_timeout_seconds: readRequiredIntegerDefault(
      defaults,
      CONTAINER_MANAGER_RUNTIME_DEFAULTS.platformApiRequestTimeoutSeconds,
    ),
    platform_log_ingest_timeout_seconds: readRequiredIntegerDefault(
      defaults,
      CONTAINER_MANAGER_RUNTIME_DEFAULTS.platformLogIngestTimeoutSeconds,
    ),
    reconcile_interval_seconds: readRequiredIntegerDefault(
      defaults,
      CONTAINER_MANAGER_RUNTIME_DEFAULTS.reconcileIntervalSeconds,
    ),
    stop_timeout_seconds: readRequiredIntegerDefault(
      defaults,
      CONTAINER_MANAGER_RUNTIME_DEFAULTS.stopTimeoutSeconds,
    ),
    shutdown_task_stop_timeout_seconds: readRequiredIntegerDefault(
      defaults,
      CONTAINER_MANAGER_RUNTIME_DEFAULTS.shutdownTaskStopTimeoutSeconds,
    ),
    docker_action_buffer_seconds: readRequiredIntegerDefault(
      defaults,
      CONTAINER_MANAGER_RUNTIME_DEFAULTS.dockerActionBufferSeconds,
    ),
    log_flush_interval_ms: readRequiredIntegerDefault(
      defaults,
      CONTAINER_MANAGER_RUNTIME_DEFAULTS.logFlushIntervalMs,
    ),
    docker_event_reconnect_backoff_ms: readRequiredIntegerDefault(
      defaults,
      CONTAINER_MANAGER_RUNTIME_DEFAULTS.dockerEventReconnectBackoffMs,
    ),
    crash_log_capture_timeout_seconds: readRequiredIntegerDefault(
      defaults,
      CONTAINER_MANAGER_RUNTIME_DEFAULTS.crashLogCaptureTimeoutSeconds,
    ),
    starvation_threshold_seconds: readRequiredIntegerDefault(
      defaults,
      CONTAINER_MANAGER_RUNTIME_DEFAULTS.starvationThresholdSeconds,
    ),
    runtime_orphan_grace_cycles: readRequiredIntegerDefault(
      defaults,
      CONTAINER_MANAGER_RUNTIME_DEFAULTS.runtimeOrphanGraceCycles,
    ),
    hung_runtime_stale_after_seconds: readRequiredIntegerDefault(
      defaults,
      CONTAINER_MANAGER_RUNTIME_DEFAULTS.hungRuntimeStaleAfterSeconds,
    ),
    hung_runtime_stop_grace_period_seconds: readRequiredIntegerDefault(
      defaults,
      CONTAINER_MANAGER_RUNTIME_DEFAULTS.hungRuntimeStopGracePeriodSeconds,
    ),
    global_max_runtimes: readRequiredIntegerDefault(
      defaults,
      CONTAINER_MANAGER_RUNTIME_DEFAULTS.globalMaxSpecialists,
    ),
    runtime_log_max_size_mb: readRequiredIntegerDefault(
      defaults,
      CONTAINER_MANAGER_RUNTIME_DEFAULTS.runtimeLogMaxSizeMB,
    ),
    runtime_log_max_files: readRequiredIntegerDefault(
      defaults,
      CONTAINER_MANAGER_RUNTIME_DEFAULTS.runtimeLogMaxFiles,
    ),
  };
}

function readRequiredIntegerDefault(
  defaults: Map<string, string>,
  key: string,
): number {
  const parsed = Number(defaults.get(key) ?? '');
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ValidationError(`Missing runtime default "${key}"`);
  }
  return parsed;
}

function readRuntimeHeartbeatFreshnessSeconds(defaults: Map<string, string>): number {
  return readRequiredIntegerDefault(
    defaults,
    CONTAINER_MANAGER_RUNTIME_DEFAULTS.hungRuntimeStaleAfterSeconds,
  );
}

function readSpecialistRuntimeTargetDefaults(
  defaults: Map<string, string>,
): SpecialistRuntimeTargetDefaults {
  return {
    image: readRequiredStringDefault(defaults, SPECIALIST_RUNTIME_TARGET_DEFAULT_KEYS.image),
    cpu: readRequiredStringDefault(defaults, SPECIALIST_RUNTIME_TARGET_DEFAULT_KEYS.cpu),
    memory: readRequiredStringDefault(defaults, SPECIALIST_RUNTIME_TARGET_DEFAULT_KEYS.memory),
    pullPolicy: readRequiredStringDefault(defaults, SPECIALIST_RUNTIME_TARGET_DEFAULT_KEYS.pullPolicy),
    bootstrapClaimTimeoutSeconds: readRequiredIntegerDefault(
      defaults,
      SPECIALIST_RUNTIME_TARGET_DEFAULT_KEYS.bootstrapClaimTimeoutSeconds,
    ),
    drainGraceSeconds: readRequiredIntegerDefault(
      defaults,
      SPECIALIST_RUNTIME_TARGET_DEFAULT_KEYS.drainGraceSeconds,
    ),
  };
}

function readRequiredStringDefault(defaults: Map<string, string>, key: string): string {
  const value = defaults.get(key)?.trim();
  if (!value) {
    throw new ValidationError(`Missing runtime default "${key}"`);
  }
  return value;
}

export interface HeartbeatPayload {
  runtime_id: string;
  playbook_id?: string | null;
  pool_kind: PlaybookRuntimePoolKind;
  state: string;
  task_id?: string | null;
  uptime_seconds?: number;
  last_claim_at?: string | null;
  image?: string;
}

export interface HeartbeatAck {
  runtime_id: string;
  playbook_id: string | null;
  pool_kind: PlaybookRuntimePoolKind;
  state: string;
  task_id: string | null;
  should_drain: boolean;
}

interface HeartbeatRow {
  [key: string]: unknown;
  runtime_id: string;
  tenant_id: string;
  playbook_id: string | null;
  playbook_name: string;
  pool_kind: string;
  state: string;
  task_id: string | null;
}

interface PlaybookFleetSummary {
  playbook_id: string;
  playbook_name: string;
  max_runtimes: number;
  running: number;
  idle: number;
  executing: number;
  pending_tasks: number;
  active_workflows: number;
}

export interface PlaybookPoolFleetSummary extends PlaybookFleetSummary {
  pool_kind: PlaybookRuntimePoolKind;
  draining: number;
}

export interface WorkerPoolSummary {
  pool_kind: PlaybookRuntimePoolKind;
  desired_workers: number;
  desired_replicas: number;
  enabled_workers: number;
  draining_workers: number;
  running_containers: number;
}

export interface ContainerManagerConfig {
  platform_api_request_timeout_seconds: number;
  platform_log_ingest_timeout_seconds: number;
  reconcile_interval_seconds: number;
  stop_timeout_seconds: number;
  shutdown_task_stop_timeout_seconds: number;
  docker_action_buffer_seconds: number;
  log_flush_interval_ms: number;
  docker_event_reconnect_backoff_ms: number;
  crash_log_capture_timeout_seconds: number;
  starvation_threshold_seconds: number;
  runtime_orphan_grace_cycles: number;
  hung_runtime_stale_after_seconds: number;
  hung_runtime_stop_grace_period_seconds: number;
  global_max_runtimes: number;
  runtime_log_max_size_mb: number;
  runtime_log_max_files: number;
}

export interface FleetStatus {
  global_max_runtimes: number;
  total_running: number;
  total_idle: number;
  total_executing: number;
  total_draining: number;
  worker_pools: WorkerPoolSummary[];
  by_playbook: PlaybookFleetSummary[];
  by_playbook_pool: PlaybookPoolFleetSummary[];
  recent_events: FleetEventRow[];
}

export interface FleetEventFilters {
  playbook_id?: string;
  runtime_id?: string;
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
}

export interface FleetEventRow {
  [key: string]: unknown;
  id: string;
  tenant_id: string;
  event_type: string;
  level: string;
  runtime_id: string | null;
  playbook_id: string | null;
  task_id: string | null;
  workflow_id: string | null;
  container_id: string | null;
  payload: Record<string, unknown>;
  created_at: Date;
}

export interface HeartbeatListRow {
  runtime_id: string;
  playbook_id: string | null;
  pool_kind: PlaybookRuntimePoolKind;
  state: string;
  last_heartbeat_at: string;
  active_task_id: string | null;
}

export interface RecordFleetEventInput {
  event_type: string;
  level?: string;
  runtime_id?: string;
  playbook_id?: string;
  task_id?: string;
  workflow_id?: string;
  container_id?: string;
  payload?: Record<string, unknown>;
}

interface WorkerPoolSummaryRow {
  pool_kind: string;
  desired_workers: number;
  desired_replicas: number;
  enabled_workers: number;
  draining_workers: number;
  running_containers: number;
}

function isPoolKind(value: string): value is PlaybookRuntimePoolKind {
  return VALID_POOL_KINDS.has(value);
}

function heartbeatPlaybookKey(
  playbookID: string | null,
  poolKind: string,
): string {
  if ((isPoolKind(poolKind) ? poolKind : 'specialist') === 'specialist' && (!playbookID || playbookID.trim().length === 0)) {
    return GENERIC_SPECIALIST_TARGET_ID;
  }
  return playbookID?.trim() || GENERIC_SPECIALIST_TARGET_ID;
}

function normalizeRuntimeHeartbeatPlaybookID(playbookID: string | null | undefined): string | null {
  if (!playbookID) {
    return null;
  }
  const normalized = playbookID.trim();
  if (normalized === GENERIC_SPECIALIST_TARGET_ID) {
    return null;
  }
  return normalized.length > 0 ? normalized : null;
}
