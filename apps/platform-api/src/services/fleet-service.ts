import { z } from 'zod';

import type { DatabasePool } from '../db/database.js';
import { TenantScopedRepository } from '../db/tenant-scoped-repository.js';
import { ConflictError, NotFoundError } from '../errors/domain-errors.js';

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
  constructor(private readonly pool: DatabasePool) {}

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

  async listContainers(tenantId: string): Promise<ActualStateRow[]> {
    const result = await this.pool.query<ActualStateRow>(
      `SELECT was.* FROM worker_actual_state was
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

  async reportImage(repository: string, tag: string | null, digest: string | null, sizeBytes: number | null): Promise<void> {
    await this.pool.query(
      `INSERT INTO container_images (repository, tag, digest, size_bytes, last_seen)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (repository, tag) DO UPDATE SET
         digest = $3, size_bytes = $4, last_seen = NOW()`,
      [repository, tag, digest, sizeBytes],
    );
  }
}
