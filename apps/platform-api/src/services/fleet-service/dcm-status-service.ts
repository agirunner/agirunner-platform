import type { DatabasePool } from '../../db/database.js';
import { NotFoundError, ValidationError } from '../../errors/domain-errors.js';

import {
  heartbeatPlaybookKey,
  isPoolKind,
  normalizeRuntimeHeartbeatPlaybookID,
  readRequiredIntegerDefault,
  sanitizeFleetEventPayload,
  sanitizeFleetEventRows,
  type FleetEventFilters,
  type FleetEventRow,
  type FleetStatus,
  type PlaybookFleetSummary,
  type PlaybookPoolFleetSummary,
  type RecordFleetEventInput,
  type WorkerPoolSummary,
} from './dcm-support.js';
import type { FleetRuntimeService } from './dcm-runtime-service.js';

const GENERIC_SPECIALIST_TARGET_NAME = 'Specialist Agents';
const CONTAINER_MANAGER_RUNTIME_DEFAULTS = {
  globalMaxSpecialists: 'global_max_specialists',
  hungRuntimeStaleAfterSeconds: 'container_manager.hung_runtime_stale_after_seconds',
} as const;
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

export class FleetStatusService {
  constructor(
    private readonly pool: DatabasePool,
    private readonly runtimeService: FleetRuntimeService,
  ) {}

  async getFleetStatus(tenantId: string): Promise<FleetStatus> {
    const defaults = await this.loadRuntimeDefaults(tenantId);
    const globalMaxRuntimes = readRequiredIntegerDefault(
      defaults,
      CONTAINER_MANAGER_RUNTIME_DEFAULTS.globalMaxSpecialists,
    );
    const heartbeatFreshnessSeconds = readRequiredIntegerDefault(
      defaults,
      CONTAINER_MANAGER_RUNTIME_DEFAULTS.hungRuntimeStaleAfterSeconds,
    );

    const heartbeats = await this.pool.query<{
      runtime_id: string;
      tenant_id: string;
      playbook_id: string | null;
      playbook_name: string;
      pool_kind: string;
      state: string;
      task_id: string | null;
    }>(
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

    const targets = await this.runtimeService.getRuntimeTargets(tenantId);
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
    const result = await this.pool.query<{
      pool_kind: string;
      desired_workers: number;
      desired_replicas: number;
      enabled_workers: number;
      draining_workers: number;
      running_containers: number;
    }>(
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
}
