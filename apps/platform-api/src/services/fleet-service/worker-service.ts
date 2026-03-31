import type { DatabasePool } from '../../db/database.js';
import { TenantScopedRepository } from '../../db/tenant-scoped-repository.js';
import { NotFoundError } from '../../errors/domain-errors.js';

import {
  ACTIVE_WORKER_TASK_STATES,
  type ActualStateRow,
  type ContainerImageRow,
  type ContainerView,
  type CreateDesiredStateInput,
  type FleetWorkerView,
  type PublicDesiredStateRow,
  type UpdateDesiredStateInput,
  resolveWorkerCreateDefaults,
  toPublicDesiredStateRow,
  validateDesiredStateResources,
  validateDesiredStateSecrets,
  createDesiredStateSchema,
  updateDesiredStateSchema,
  HUNG_RUNTIME_STALE_AFTER_SECONDS_KEY,
} from './worker-support.js';

const FLEET_WORKER_NOT_FOUND_MESSAGE = 'Fleet worker not found';

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

export class FleetWorkerService {
  constructor(private readonly pool: DatabasePool) {}

  async listWorkers(
    tenantId: string,
    options: { enabledOnly?: boolean } = {},
  ): Promise<FleetWorkerView[]> {
    const repo = new TenantScopedRepository(this.pool, tenantId);
    const conditions = options.enabledOnly ? ['enabled = $2'] : [];
    const values = options.enabledOnly ? [true] : [];
    const desired = await repo.findAll<DesiredStateRow>('worker_desired_state', '*', conditions, values);
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

    return desired.map((row) => ({
      ...toPublicDesiredStateRow({
        ...row,
        active_task_id: activeTaskByDesiredState.get(row.id) ?? null,
      }),
      actual: actualByDesiredState.get(row.id) ?? [],
    }));
  }

  async getWorker(tenantId: string, id: string): Promise<FleetWorkerView> {
    const row = await this.loadDesiredStateRow(tenantId, id);
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
    const validated = resolveWorkerCreateDefaults(createDesiredStateSchema.parse(input));
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
    if (!result.rowCount) {
      throw new NotFoundError(FLEET_WORKER_NOT_FOUND_MESSAGE);
    }
    return toPublicDesiredStateRow(result.rows[0]);
  }

  async deleteWorker(tenantId: string, id: string): Promise<void> {
    const result = await this.pool.query(
      'UPDATE worker_desired_state SET enabled = false, updated_at = NOW() WHERE tenant_id = $1 AND id = $2',
      [tenantId, id],
    );
    if (!result.rowCount) throw new NotFoundError(FLEET_WORKER_NOT_FOUND_MESSAGE);
  }

  async restartWorker(tenantId: string, id: string): Promise<PublicDesiredStateRow> {
    const result = await this.pool.query<DesiredStateRow>(
      `UPDATE worker_desired_state SET restart_requested = true, updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      [tenantId, id],
    );
    if (!result.rowCount) throw new NotFoundError(FLEET_WORKER_NOT_FOUND_MESSAGE);
    return toPublicDesiredStateRow(result.rows[0]);
  }

  async acknowledgeWorkerRestart(tenantId: string, id: string): Promise<PublicDesiredStateRow> {
    const result = await this.pool.query<DesiredStateRow>(
      `UPDATE worker_desired_state SET restart_requested = false, updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      [tenantId, id],
    );
    if (!result.rowCount) throw new NotFoundError(FLEET_WORKER_NOT_FOUND_MESSAGE);
    return toPublicDesiredStateRow(result.rows[0]);
  }

  async drainWorker(tenantId: string, id: string): Promise<PublicDesiredStateRow> {
    const result = await this.pool.query<DesiredStateRow>(
      `UPDATE worker_desired_state SET draining = true, updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      [tenantId, id],
    );
    if (!result.rowCount) throw new NotFoundError(FLEET_WORKER_NOT_FOUND_MESSAGE);
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
      [HUNG_RUNTIME_STALE_AFTER_SECONDS_KEY],
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

  private async loadDesiredStateActiveTasks(tenantId: string, desiredStateIds: string[]): Promise<Map<string, string>> {
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
      throw new NotFoundError(FLEET_WORKER_NOT_FOUND_MESSAGE);
    }
    return row;
  }
}

