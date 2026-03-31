import type { DatabasePool } from '../../db/database.js';
import { ValidationError } from '../../errors/domain-errors.js';

import {
  buildContainerManagerConfig,
  heartbeatPlaybookKey,
  isPoolKind,
  normalizeRuntimeHeartbeatPlaybookID,
  readRequiredIntegerDefault,
  readRuntimeHeartbeatFreshnessSeconds,
  readSpecialistRuntimeTargetDefaults,
  type HeartbeatAck,
  type HeartbeatListRow,
  type HeartbeatPayload,
  type QueueDepthResult,
  type RuntimeTarget,
} from './dcm-support.js';

const GENERIC_SPECIALIST_TARGET_ID = 'specialist';
const GENERIC_SPECIALIST_TARGET_NAME = 'Specialist Agents';

const CONTAINER_MANAGER_RUNTIME_DEFAULTS = {
  globalMaxSpecialists: 'global_max_specialists',
  hungRuntimeStaleAfterSeconds: 'container_manager.hung_runtime_stale_after_seconds',
} as const;

export class FleetRuntimeService {
  constructor(private readonly pool: DatabasePool) {}

  async getQueueDepth(tenantId: string, playbookId?: string): Promise<QueueDepthResult> {
    const baseQuery = `
      SELECT t.workflow_id, w.playbook_id
      FROM tasks t
      JOIN workflows w ON w.id = t.workflow_id AND w.tenant_id = t.tenant_id
      WHERE t.tenant_id = $1
        AND t.state = 'ready'
        AND w.state NOT IN ('paused', 'cancelled', 'failed', 'completed')
        AND COALESCE(NULLIF(w.metadata->>'pause_requested_at', ''), '') = ''
        AND COALESCE(NULLIF(w.metadata->>'cancel_requested_at', ''), '') = ''
        AND w.playbook_id IS NOT NULL`;

    const params: unknown[] = [tenantId];
    const playbookFilter = playbookId ? ` AND w.playbook_id = $${params.push(playbookId)}` : '';

    const result = await this.pool.query<{ playbook_id: string; count: number }>(
      `SELECT playbook_id, COUNT(*)::int AS count
       FROM (${baseQuery}${playbookFilter}) sub
       GROUP BY playbook_id`,
      params,
    );

    const byPlaybook: Record<string, number> = {};
    let totalPending = 0;
    for (const row of result.rows) {
      byPlaybook[row.playbook_id] = row.count;
      totalPending += row.count;
    }

    return { total_pending: totalPending, by_playbook: byPlaybook };
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
    const availableExecutionSlots = Math.max(globalMaxSpecialists - stats.active_execution_containers, 0);
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

  async recordHeartbeat(tenantId: string, payload: HeartbeatPayload): Promise<HeartbeatAck> {
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

  async getContainerManagerConfig(tenantId: string) {
    const defaults = await this.loadRuntimeDefaults(tenantId);
    return buildContainerManagerConfig(defaults);
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

  private async loadSpecialistRuntimeStats(
    tenantId: string,
    heartbeatFreshnessSeconds: number,
  ): Promise<{ pending_tasks: number; active_runtimes: number; active_execution_containers: number }> {
    const result = await this.pool.query<{
      pending_tasks: number;
      active_runtimes: number;
      active_execution_containers: number;
    }>(
      `WITH ready_specialist_tasks AS (
         SELECT 1
           FROM tasks t
           JOIN workflows w
             ON w.id = t.workflow_id
            AND w.tenant_id = t.tenant_id
          WHERE t.tenant_id = $1
            AND t.state = 'ready'
            AND COALESCE(t.is_orchestrator_task, false) = false
            AND w.state NOT IN ('paused', 'cancelled', 'failed', 'completed')
            AND COALESCE(NULLIF(w.metadata->>'pause_requested_at', ''), '') = ''
            AND COALESCE(NULLIF(w.metadata->>'cancel_requested_at', ''), '') = ''
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
    const result = await this.pool.query<{ name: string }>(
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
}
