import { z } from 'zod';

import type { DatabasePool } from '../db/database.js';
import { TenantScopedRepository } from '../db/tenant-scoped-repository.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors/domain-errors.js';

const VALID_POOL_MODES = new Set(['warm', 'cold']);
const VALID_PULL_POLICIES = new Set(['always', 'if-not-present', 'never']);

interface FleetLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
}

const SILENT_LOGGER: FleetLogger = { warn: () => {} };

const VALID_FLEET_EVENT_TYPES = new Set([
  'runtime.started',
  'runtime.task.claimed',
  'runtime.task.completed',
  'runtime.task.failed',
  'runtime.idle',
  'runtime.draining',
  'runtime.shutdown',
  'runtime.hung_detected',
  'container.created',
  'container.destroyed',
  'orphan.cleaned',
]);

const VALID_FLEET_EVENT_LEVELS = new Set(['debug', 'info', 'warn', 'error']);

const createDesiredStateSchema = z.object({
  workerName: z.string().min(1).max(200),
  role: z.string().min(1).max(100),
  runtimeImage: z.string().min(1),
  cpuLimit: z.string().default('2'),
  memoryLimit: z.string().default('2g'),
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

interface DesiredStateRow {
  [key: string]: unknown;
  id: string;
  tenant_id: string;
  worker_name: string;
  role: string;
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

interface FleetWorkerView extends DesiredStateRow {
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

export class FleetService {
  private readonly logger: FleetLogger;

  constructor(
    private readonly pool: DatabasePool,
    logger?: FleetLogger,
  ) {
    this.logger = logger ?? SILENT_LOGGER;
  }

  async listWorkers(tenantId: string): Promise<FleetWorkerView[]> {
    const repo = new TenantScopedRepository(this.pool, tenantId);
    const desired = await repo.findAll<DesiredStateRow>('worker_desired_state', '*');

    const views: FleetWorkerView[] = [];
    for (const d of desired) {
      const actual = await this.pool.query<ActualStateRow>(
        'SELECT * FROM worker_actual_state WHERE desired_state_id = $1',
        [d.id],
      );
      views.push({ ...d, actual: actual.rows });
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
    return { ...row, actual: actual.rows };
  }

  async createWorker(tenantId: string, input: CreateDesiredStateInput): Promise<DesiredStateRow> {
    const validated = createDesiredStateSchema.parse(input);

    const result = await this.pool.query<DesiredStateRow>(
      `INSERT INTO worker_desired_state (
        tenant_id, worker_name, role, runtime_image, cpu_limit, memory_limit,
        network_policy, environment, llm_provider, llm_model, llm_api_key_secret_ref,
        replicas, enabled
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *`,
      [
        tenantId,
        validated.workerName,
        validated.role,
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
    return result.rows[0];
  }

  async updateWorker(tenantId: string, id: string, input: UpdateDesiredStateInput): Promise<DesiredStateRow> {
    const validated = updateDesiredStateSchema.parse(input);
    const setClauses: string[] = [];
    const values: unknown[] = [tenantId, id];
    let paramIndex = 3;

    const fields: Array<[string, unknown]> = [
      ['role', validated.role],
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
      const worker = await this.getWorker(tenantId, id);
      return worker;
    }

    setClauses.push('version = version + 1');
    setClauses.push('updated_at = NOW()');

    const result = await this.pool.query<DesiredStateRow>(
      `UPDATE worker_desired_state SET ${setClauses.join(', ')} WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      values,
    );
    if (!result.rowCount) throw new NotFoundError('Fleet worker not found');
    return result.rows[0];
  }

  async deleteWorker(tenantId: string, id: string): Promise<void> {
    const result = await this.pool.query(
      'UPDATE worker_desired_state SET enabled = false, updated_at = NOW() WHERE tenant_id = $1 AND id = $2',
      [tenantId, id],
    );
    if (!result.rowCount) throw new NotFoundError('Fleet worker not found');
  }

  async restartWorker(tenantId: string, id: string): Promise<DesiredStateRow> {
    const result = await this.pool.query<DesiredStateRow>(
      `UPDATE worker_desired_state SET restart_requested = true, updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      [tenantId, id],
    );
    if (!result.rowCount) throw new NotFoundError('Fleet worker not found');
    return result.rows[0];
  }

  async drainWorker(tenantId: string, id: string): Promise<DesiredStateRow> {
    const result = await this.pool.query<DesiredStateRow>(
      `UPDATE worker_desired_state SET draining = true, updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      [tenantId, id],
    );
    if (!result.rowCount) throw new NotFoundError('Fleet worker not found');
    return result.rows[0];
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
       ON CONFLICT (desired_state_id) DO UPDATE SET
         container_id = $2, container_status = $3, cpu_usage_percent = $4,
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

  async pruneStaleHeartbeats(maxAgeMinutes = 10): Promise<number> {
    const result = await this.pool.query(
      `DELETE FROM runtime_heartbeats
       WHERE last_heartbeat_at < now() - make_interval(mins => $1)`,
      [maxAgeMinutes],
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

  validateRuntimeConfig(
    templateId: string,
    runtime: Record<string, unknown>,
    taskContainer?: Record<string, unknown>,
  ): { runtime: Record<string, unknown>; taskContainer: Record<string, unknown> } {
    const validatedRuntime = { ...runtime };
    const validatedTask = { ...(taskContainer ?? {}) };

    if (validatedRuntime.pool_mode !== undefined && !VALID_POOL_MODES.has(validatedRuntime.pool_mode as string)) {
      this.logger.warn(
        { templateId, value: validatedRuntime.pool_mode },
        'invalid_runtime_pool_mode_using_default',
      );
      validatedRuntime.pool_mode = 'warm';
    }

    if (validatedRuntime.max_runtimes !== undefined) {
      const val = validatedRuntime.max_runtimes as number;
      if (!Number.isInteger(val) || val < 1) {
        this.logger.warn(
          { templateId, value: val },
          'invalid_max_runtimes_using_default',
        );
        validatedRuntime.max_runtimes = 1;
      }
    }

    if (validatedRuntime.pull_policy !== undefined && !VALID_PULL_POLICIES.has(validatedRuntime.pull_policy as string)) {
      this.logger.warn(
        { templateId, value: validatedRuntime.pull_policy },
        'invalid_runtime_pull_policy_using_default',
      );
      validatedRuntime.pull_policy = 'if-not-present';
    }

    if (validatedTask.pull_policy !== undefined && !VALID_PULL_POLICIES.has(validatedTask.pull_policy as string)) {
      this.logger.warn(
        { templateId, value: validatedTask.pull_policy },
        'invalid_task_container_pull_policy_using_default',
      );
      validatedTask.pull_policy = 'if-not-present';
    }

    if (validatedTask.pool_mode !== undefined && !VALID_POOL_MODES.has(validatedTask.pool_mode as string)) {
      this.logger.warn(
        { templateId, value: validatedTask.pool_mode },
        'invalid_task_container_pool_mode_using_default',
      );
      validatedTask.pool_mode = 'cold';
    }

    const runtimePoolMode = (validatedRuntime.pool_mode as string) ?? 'warm';
    const taskPoolMode = validatedTask.pool_mode as string | undefined;
    if (taskPoolMode === 'warm' && runtimePoolMode !== 'warm') {
      this.logger.warn(
        { templateId },
        'task_container_warm_requires_runtime_warm_downgrading_to_cold',
      );
      validatedTask.pool_mode = 'cold';
    }

    return { runtime: validatedRuntime, taskContainer: validatedTask };
  }

  async getQueueDepth(tenantId: string, templateId?: string): Promise<QueueDepthResult> {
    const baseQuery = `
      SELECT t.workflow_id, w.template_id
      FROM tasks t
      JOIN workflows w ON w.id = t.workflow_id AND w.tenant_id = t.tenant_id
      WHERE t.tenant_id = $1
        AND t.state = 'ready'
        AND w.state NOT IN ('cancelled', 'failed', 'completed')`;

    const params: unknown[] = [tenantId];
    const templateFilter = templateId
      ? ` AND w.template_id = $${params.push(templateId)}`
      : '';

    const result = await this.pool.query<{ template_id: string }>(
      `SELECT template_id, COUNT(*)::int AS count
       FROM (${baseQuery}${templateFilter}) sub
       GROUP BY template_id`,
      params,
    );

    const byTemplate: Record<string, number> = {};
    let totalPending = 0;
    for (const row of result.rows) {
      const count = (row as unknown as Record<string, number>).count;
      byTemplate[row.template_id] = count;
      totalPending += count;
    }

    return { total_pending: totalPending, by_template: byTemplate };
  }

  async getRuntimeTargets(tenantId: string): Promise<RuntimeTarget[]> {
    const result = await this.pool.query<RuntimeTargetRow>(
      `SELECT
         t.id AS template_id,
         t.name AS template_name,
         t.schema AS schema,
         (SELECT COUNT(*)::int FROM workflows w
          WHERE w.tenant_id = t.tenant_id AND w.template_id = t.id
            AND w.state NOT IN ('cancelled', 'failed', 'completed')) AS active_workflows,
         (SELECT COUNT(*)::int FROM tasks tk
          JOIN workflows w2 ON w2.id = tk.workflow_id AND w2.tenant_id = tk.tenant_id
          WHERE tk.tenant_id = t.tenant_id AND w2.template_id = t.id
            AND tk.state = 'ready'
            AND w2.state NOT IN ('cancelled', 'failed', 'completed')) AS pending_tasks
       FROM templates t
       WHERE t.tenant_id = $1
         AND t.deleted_at IS NULL
         AND t.is_published = true
         AND t.schema::jsonb ? 'runtime'`,
      [tenantId],
    );

    return result.rows.map((row) => {
      const schema = row.schema as Record<string, unknown>;
      const rawRuntime = (schema.runtime ?? {}) as Record<string, unknown>;
      const rawTaskContainer = schema.task_container as Record<string, unknown> | undefined;

      const validated = this.validateRuntimeConfig(
        row.template_id,
        rawRuntime,
        rawTaskContainer,
      );
      const runtime = validated.runtime;
      const taskContainer = validated.taskContainer;

      return {
        template_id: row.template_id,
        template_name: row.template_name,
        pool_mode: (runtime.pool_mode as string) ?? 'warm',
        max_runtimes: (runtime.max_runtimes as number) ?? 1,
        priority: (runtime.priority as number) ?? 0,
        idle_timeout_seconds: (runtime.idle_timeout_seconds as number) ?? 300,
        grace_period_seconds: (runtime.grace_period_seconds as number) ?? 180,
        image: (runtime.image as string) ?? 'agirunner-runtime:local',
        pull_policy: (runtime.pull_policy as string) ?? 'if-not-present',
        cpu: (runtime.cpu as string) ?? '1.0',
        memory: (runtime.memory as string) ?? '512m',
        task_image: (taskContainer.image as string) ?? '',
        task_pull_policy: (taskContainer.pull_policy as string) ?? 'if-not-present',
        task_cpu: (taskContainer.cpu as string) ?? '0.5',
        task_memory: (taskContainer.memory as string) ?? '256m',
        warm_pool_size: (taskContainer.warm_pool_size as number) ?? 0,
        task_pool_mode: (taskContainer.pool_mode as string) ?? 'cold',
        pending_tasks: row.pending_tasks,
        active_workflows: row.active_workflows,
      };
    });
  }

  async recordHeartbeat(
    tenantId: string,
    payload: HeartbeatPayload,
  ): Promise<{ should_drain: boolean }> {
    const validStates = ['idle', 'executing', 'draining'];
    if (!validStates.includes(payload.state)) {
      throw new ValidationError(`Invalid heartbeat state: ${payload.state}`);
    }

    const result = await this.pool.query<{ drain_requested: boolean }>(
      `INSERT INTO runtime_heartbeats (
         runtime_id, tenant_id, template_id, state, task_id,
         uptime_seconds, last_claim_at, image, last_heartbeat_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       ON CONFLICT (runtime_id) DO UPDATE SET
         state = $4, task_id = $5, uptime_seconds = $6,
         last_claim_at = COALESCE($7, runtime_heartbeats.last_claim_at),
         last_heartbeat_at = NOW()
       RETURNING drain_requested`,
      [
        payload.runtime_id,
        tenantId,
        payload.template_id,
        payload.state,
        payload.task_id ?? null,
        payload.uptime_seconds ?? 0,
        payload.last_claim_at ?? null,
        payload.image ?? 'agirunner-runtime:local',
      ],
    );

    const drainRequested = result.rows[0]?.drain_requested ?? false;
    return { should_drain: drainRequested };
  }

  async listHeartbeats(tenantId: string): Promise<HeartbeatListRow[]> {
    const result = await this.pool.query<HeartbeatListRow>(
      `SELECT runtime_id, template_id, state,
              to_char(last_heartbeat_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_heartbeat_at,
              task_id AS active_task_id
       FROM runtime_heartbeats
       WHERE tenant_id = $1`,
      [tenantId],
    );
    return result.rows;
  }

  async getFleetStatus(tenantId: string): Promise<FleetStatus> {
    const globalMaxResult = await this.pool.query<{ config_value: string }>(
      `SELECT config_value FROM runtime_defaults
       WHERE tenant_id = $1 AND config_key = 'global_max_runtimes'`,
      [tenantId],
    );
    const globalMaxRuntimes = globalMaxResult.rows[0]
      ? parseInt(globalMaxResult.rows[0].config_value, 10)
      : 10;

    const heartbeats = await this.pool.query<HeartbeatRow>(
      `SELECT rh.*, t.name AS template_name
       FROM runtime_heartbeats rh
       JOIN templates t ON t.id = rh.template_id
       WHERE rh.tenant_id = $1`,
      [tenantId],
    );

    let totalRunning = 0;
    let totalIdle = 0;
    let totalExecuting = 0;
    let totalDraining = 0;
    const templateMap = new Map<string, TemplateFleetSummary>();

    for (const hb of heartbeats.rows) {
      totalRunning++;
      if (hb.state === 'idle') totalIdle++;
      else if (hb.state === 'executing') totalExecuting++;
      else if (hb.state === 'draining') totalDraining++;

      let summary = templateMap.get(hb.template_id);
      if (!summary) {
        summary = {
          template_id: hb.template_id,
          template_name: hb.template_name,
          max_runtimes: 0,
          running: 0,
          idle: 0,
          executing: 0,
          pending_tasks: 0,
          active_workflows: 0,
        };
        templateMap.set(hb.template_id, summary);
      }
      summary.running++;
      if (hb.state === 'idle') summary.idle++;
      else if (hb.state === 'executing') summary.executing++;
    }

    const targets = await this.getRuntimeTargets(tenantId);
    for (const target of targets) {
      const summary = templateMap.get(target.template_id);
      if (summary) {
        summary.max_runtimes = target.max_runtimes;
        summary.pending_tasks = target.pending_tasks;
        summary.active_workflows = target.active_workflows;
      } else {
        templateMap.set(target.template_id, {
          template_id: target.template_id,
          template_name: target.template_name,
          max_runtimes: target.max_runtimes,
          running: 0,
          idle: 0,
          executing: 0,
          pending_tasks: target.pending_tasks,
          active_workflows: target.active_workflows,
        });
      }
    }

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
      by_template: [...templateMap.values()],
      recent_events: recentEventsResult.rows,
    };
  }

  async listFleetEvents(
    tenantId: string,
    filters: FleetEventFilters,
  ): Promise<{ events: FleetEventRow[]; total: number }> {
    const conditions = ['fe.tenant_id = $1'];
    const params: unknown[] = [tenantId];
    let paramIndex = 2;

    if (filters.template_id) {
      conditions.push(`fe.template_id = $${paramIndex++}`);
      params.push(filters.template_id);
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
      events: eventsResult.rows,
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

  async recordFleetEvent(tenantId: string, event: RecordFleetEventInput): Promise<void> {
    if (!VALID_FLEET_EVENT_TYPES.has(event.event_type)) {
      throw new ValidationError(`Invalid fleet event type: ${event.event_type}`);
    }
    if (event.level && !VALID_FLEET_EVENT_LEVELS.has(event.level)) {
      throw new ValidationError(`Invalid fleet event level: ${event.level}`);
    }
    await this.pool.query(
      `INSERT INTO fleet_events (
         tenant_id, event_type, level, runtime_id, template_id,
         task_id, workflow_id, container_id, payload
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        tenantId,
        event.event_type,
        event.level ?? 'info',
        event.runtime_id ?? null,
        event.template_id ?? null,
        event.task_id ?? null,
        event.workflow_id ?? null,
        event.container_id ?? null,
        JSON.stringify(event.payload ?? {}),
      ],
    );
  }
}

// --- DCM Types ---

export interface QueueDepthResult {
  total_pending: number;
  by_template: Record<string, number>;
}

export interface RuntimeTarget {
  template_id: string;
  template_name: string;
  pool_mode: string;
  max_runtimes: number;
  priority: number;
  idle_timeout_seconds: number;
  grace_period_seconds: number;
  image: string;
  pull_policy: string;
  cpu: string;
  memory: string;
  task_image: string;
  task_pull_policy: string;
  task_cpu: string;
  task_memory: string;
  warm_pool_size: number;
  task_pool_mode: string;
  pending_tasks: number;
  active_workflows: number;
}

interface RuntimeTargetRow {
  [key: string]: unknown;
  template_id: string;
  template_name: string;
  schema: unknown;
  active_workflows: number;
  pending_tasks: number;
}

export interface HeartbeatPayload {
  runtime_id: string;
  template_id: string;
  state: string;
  task_id?: string | null;
  uptime_seconds?: number;
  last_claim_at?: string | null;
  image?: string;
}

interface HeartbeatRow {
  [key: string]: unknown;
  runtime_id: string;
  tenant_id: string;
  template_id: string;
  template_name: string;
  state: string;
  task_id: string | null;
}

interface TemplateFleetSummary {
  template_id: string;
  template_name: string;
  max_runtimes: number;
  running: number;
  idle: number;
  executing: number;
  pending_tasks: number;
  active_workflows: number;
}

export interface FleetStatus {
  global_max_runtimes: number;
  total_running: number;
  total_idle: number;
  total_executing: number;
  total_draining: number;
  by_template: TemplateFleetSummary[];
  recent_events: FleetEventRow[];
}

export interface FleetEventFilters {
  template_id?: string;
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
  template_id: string | null;
  task_id: string | null;
  workflow_id: string | null;
  container_id: string | null;
  payload: Record<string, unknown>;
  created_at: Date;
}

export interface HeartbeatListRow {
  runtime_id: string;
  template_id: string;
  state: string;
  last_heartbeat_at: string;
  active_task_id: string | null;
}

export interface RecordFleetEventInput {
  event_type: string;
  level?: string;
  runtime_id?: string;
  template_id?: string;
  task_id?: string;
  workflow_id?: string;
  container_id?: string;
  payload?: Record<string, unknown>;
}
