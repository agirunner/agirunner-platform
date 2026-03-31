import { beforeEach, describe, expect, it } from 'vitest';

import { FleetService } from '../../../src/services/fleet-service/fleet-service.js';
import {
  createMockPool,
  createRuntimeTargetDefaultRows,
  PLAYBOOK_ID,
  TENANT_ID,
} from './support.js';

describe('FleetService DCM', () => {
  let pool: ReturnType<typeof createMockPool>;
  let service: FleetService;

  beforeEach(() => {
    pool = createMockPool();
    service = new FleetService(pool as never);
  });

  describe('getQueueDepth', () => {
    it('returns total and per-playbook counts', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [
          { playbook_id: PLAYBOOK_ID, count: 3 },
          { playbook_id: '00000000-0000-0000-0000-000000000011', count: 2 },
        ],
        rowCount: 2,
      });

      const result = await service.getQueueDepth(TENANT_ID);

      expect(result.total_pending).toBe(5);
      expect(result.by_playbook[PLAYBOOK_ID]).toBe(3);
    });

    it('returns zero when no pending tasks', async () => {
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await service.getQueueDepth(TENANT_ID);

      expect(result.total_pending).toBe(0);
      expect(result.by_playbook).toEqual({});
    });

    it('filters by playbook_id when provided', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ playbook_id: PLAYBOOK_ID, count: 3 }],
        rowCount: 1,
      });

      await service.getQueueDepth(TENANT_ID, PLAYBOOK_ID);

      const query = pool.query.mock.calls[0][0] as string;
      expect(query).toContain('playbook_id');
      const params = pool.query.mock.calls[0][1] as unknown[];
      expect(params).toContain(PLAYBOOK_ID);
    });
  });

  describe('pruneStaleHeartbeats', () => {
    it('uses each tenant runtime stale-heartbeat default instead of a fixed minute window', async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 3 });

      const result = await service.pruneStaleHeartbeats();

      expect(result).toBe(3);
      const [query, params] = pool.query.mock.calls[0] as [string, unknown[]];
      expect(query).toContain('DELETE FROM runtime_heartbeats rh');
      expect(query).toContain('runtime_defaults rd');
      expect(query).toContain('rd.tenant_id = rh.tenant_id');
      expect(query).toContain('rd.config_key = $1');
      expect(query).toContain('make_interval(secs => rd.config_value::int)');
      expect(params).toEqual(['container_manager.hung_runtime_stale_after_seconds']);
    });
  });

  describe('getRuntimeTargets', () => {
    it('returns a generic specialist runtime target when specialist work is pending', async () => {
      pool.query.mockResolvedValueOnce({
        rows: createRuntimeTargetDefaultRows({ specialist_runtime_default_memory: '1Gi' }),
        rowCount: 8,
      });
      pool.query.mockResolvedValueOnce({
        rows: [{
          pending_tasks: 3,
          specialist_tasks_with_capabilities: 2,
          specialist_distinct_capability_sets: 2,
          specialist_max_required_capabilities: 3,
          active_runtimes: 1,
          active_execution_containers: 4,
        }],
        rowCount: 1,
      });
      pool.query.mockResolvedValueOnce({
        rows: [{ name: 'developer' }],
        rowCount: 1,
      });

      const result = await service.getRuntimeTargets(TENANT_ID);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        playbook_id: 'specialist',
        playbook_name: 'Specialist Agents',
        pool_kind: 'specialist',
        pool_mode: 'cold',
        max_runtimes: 12,
        priority: 0,
        idle_timeout_seconds: 0,
        grace_period_seconds: 30,
        image: 'agirunner-runtime:local',
        pull_policy: 'if-not-present',
        cpu: '2',
        memory: '1Gi',
        pending_tasks: 3,
        active_workflows: 0,
        active_execution_containers: 4,
        available_execution_slots: 8,
      });
      expect(result[0].routing_tags).toEqual(['role:developer']);
    });

    it('fails fast when required runtime defaults are missing', async () => {
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      pool.query.mockResolvedValueOnce({
        rows: [{
          pending_tasks: 1,
          specialist_tasks_with_capabilities: 0,
          specialist_distinct_capability_sets: 0,
          specialist_max_required_capabilities: 0,
          active_runtimes: 0,
          active_execution_containers: 0,
        }],
        rowCount: 1,
      });

      await expect(service.getRuntimeTargets(TENANT_ID)).rejects.toThrow(
        'Missing runtime default "container_manager.hung_runtime_stale_after_seconds"',
      );
    });

    it('uses runtime_defaults table values as fallbacks', async () => {
      pool.query.mockResolvedValueOnce({
        rows: createRuntimeTargetDefaultRows({
          specialist_runtime_default_memory: '768m',
          specialist_runtime_default_pull_policy: 'always',
          specialist_runtime_default_image: 'agirunner-runtime:v2',
          specialist_runtime_drain_grace_seconds: '45',
          global_max_specialists: '9',
        }),
        rowCount: 8,
      });
      pool.query.mockResolvedValueOnce({
        rows: [{
          pending_tasks: 2,
          specialist_tasks_with_capabilities: 0,
          specialist_distinct_capability_sets: 0,
          specialist_max_required_capabilities: 0,
          active_runtimes: 0,
          active_execution_containers: 3,
        }],
        rowCount: 1,
      });
      pool.query.mockResolvedValueOnce({
        rows: [{ name: 'developer' }],
        rowCount: 1,
      });

      const result = await service.getRuntimeTargets(TENANT_ID);

      expect(result[0].cpu).toBe('2');
      expect(result[0].memory).toBe('768m');
      expect(result[0].pull_policy).toBe('always');
      expect(result[0].idle_timeout_seconds).toBe(0);
      expect(result[0].grace_period_seconds).toBe(45);
      expect(result[0].image).toBe('agirunner-runtime:v2');
      expect(result[0].available_execution_slots).toBe(6);
    });

    it('returns empty array when there is no pending specialist work and no active runtimes', async () => {
      pool.query.mockResolvedValueOnce({ rows: createRuntimeTargetDefaultRows(), rowCount: 8 });
      pool.query.mockResolvedValueOnce({
        rows: [{
          pending_tasks: 0,
          specialist_tasks_with_capabilities: 0,
          specialist_distinct_capability_sets: 0,
          specialist_max_required_capabilities: 0,
          active_runtimes: 0,
          active_execution_containers: 0,
        }],
        rowCount: 1,
      });

      const result = await service.getRuntimeTargets(TENANT_ID);

      expect(result).toEqual([]);
    });

    it('uses shared aggregates instead of repeated correlated task scans', async () => {
      pool.query.mockResolvedValueOnce({ rows: createRuntimeTargetDefaultRows(), rowCount: 8 });
      pool.query.mockResolvedValueOnce({
        rows: [{
          pending_tasks: 1,
          specialist_tasks_with_capabilities: 1,
          specialist_distinct_capability_sets: 1,
          specialist_max_required_capabilities: 2,
          active_runtimes: 0,
          active_execution_containers: 0,
        }],
        rowCount: 1,
      });
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await service.getRuntimeTargets(TENANT_ID);

      const query = pool.query.mock.calls[1]?.[0] as string;
      expect(query).toContain('WITH ready_specialist_tasks AS');
      expect(query).toContain('specialist_runtime_heartbeats AS');
      expect(query).toContain('active_execution_leases AS');
      expect(query).toContain('JOIN workflows w');
      expect(query).toContain('w.id = t.workflow_id');
      expect(query).toContain('w.tenant_id = t.tenant_id');
      expect(query).toContain("w.state NOT IN ('paused', 'cancelled', 'failed', 'completed')");
      expect(query).toContain("COALESCE(NULLIF(w.metadata->>'pause_requested_at', ''), '') = ''");
      expect(query).toContain("COALESCE(NULLIF(w.metadata->>'cancel_requested_at', ''), '') = ''");
      expect(query).not.toContain('capabilities_required');
      expect(query.match(/FROM ready_specialist_tasks/g)?.length).toBeGreaterThanOrEqual(1);
      expect(query).not.toContain('FROM playbooks p');
    });

    it('filters stale specialist heartbeats out of runtime target supply reads', async () => {
      pool.query.mockResolvedValueOnce({ rows: createRuntimeTargetDefaultRows(), rowCount: 9 });
      pool.query.mockResolvedValueOnce({
        rows: [{
          pending_tasks: 1,
          specialist_tasks_with_capabilities: 0,
          specialist_distinct_capability_sets: 0,
          specialist_max_required_capabilities: 0,
          active_runtimes: 0,
          active_execution_containers: 0,
        }],
        rowCount: 1,
      });
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await service.getRuntimeTargets(TENANT_ID);

      const query = pool.query.mock.calls[1]?.[0] as string;
      const params = pool.query.mock.calls[1]?.[1] as unknown[];
      expect(query).toContain("last_heartbeat_at >= now() - make_interval(secs => $2)");
      expect(params).toEqual([TENANT_ID, 90]);
    });

    it('includes all active specialist role tags', async () => {
      pool.query.mockResolvedValueOnce({
        rows: createRuntimeTargetDefaultRows(),
        rowCount: 8,
      });
      pool.query.mockResolvedValueOnce({
        rows: [{
          pending_tasks: 3,
          specialist_tasks_with_capabilities: 2,
          specialist_distinct_capability_sets: 1,
          specialist_max_required_capabilities: 2,
          active_runtimes: 0,
          active_execution_containers: 0,
        }],
        rowCount: 1,
      });
      pool.query.mockResolvedValueOnce({
        rows: [
          { name: 'developer' },
          { name: 'reviewer' },
          { name: 'product-manager' },
          { name: 'orchestrator' },
        ],
        rowCount: 4,
      });

      const result = await service.getRuntimeTargets(TENANT_ID);

      expect(result).toHaveLength(1);
      expect(result[0].routing_tags).toEqual(['role:developer', 'role:reviewer', 'role:product-manager']);
    });
  });
});

