import { beforeEach, describe, expect, it } from 'vitest';

import { FleetService } from '../../../src/services/fleet-service.js';
import {
  createMockPool,
  createRuntimeTargetDefaultRows,
  PLAYBOOK_ID,
  RUNTIME_ID,
  TENANT_ID,
} from './support.js';

describe('FleetService DCM runtime and snapshot flows', () => {
  let pool: ReturnType<typeof createMockPool>;
  let service: FleetService;

  beforeEach(() => {
    pool = createMockPool();
    service = new FleetService(pool as never);
  });

  describe('recordHeartbeat', () => {
    it('upserts heartbeat and returns should_drain false', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ drain_requested: false }],
        rowCount: 1,
      });

      const result = await service.recordHeartbeat(TENANT_ID, {
        runtime_id: RUNTIME_ID,
        playbook_id: PLAYBOOK_ID,
        pool_kind: 'specialist',
        state: 'idle',
        uptime_seconds: 120,
        image: 'agirunner-runtime:local',
      });

      expect(result.should_drain).toBe(false);
      expect(pool.query).toHaveBeenCalledTimes(1);
      const query = pool.query.mock.calls[0][0] as string;
      expect(query).toContain('ON CONFLICT');
      expect(query).toContain('RETURNING drain_requested');
    });

    it('returns should_drain true when drain_requested', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ drain_requested: true }],
        rowCount: 1,
      });

      const result = await service.recordHeartbeat(TENANT_ID, {
        runtime_id: RUNTIME_ID,
        playbook_id: PLAYBOOK_ID,
        pool_kind: 'specialist',
        state: 'idle',
        uptime_seconds: 120,
        image: 'agirunner-runtime:local',
      });

      expect(result.should_drain).toBe(true);
      expect(result.runtime_id).toBe(RUNTIME_ID);
      expect(result.playbook_id).toBe(PLAYBOOK_ID);
      expect(result.pool_kind).toBe('specialist');
      expect(result.state).toBe('idle');
      expect(result.task_id).toBeNull();
    });

    it('accepts executing state with task_id', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ drain_requested: false }],
        rowCount: 1,
      });

      await service.recordHeartbeat(TENANT_ID, {
        runtime_id: RUNTIME_ID,
        playbook_id: PLAYBOOK_ID,
        pool_kind: 'orchestrator',
        state: 'executing',
        task_id: '00000000-0000-0000-0000-000000000030',
        uptime_seconds: 300,
        image: 'agirunner-runtime:local',
      });

      const params = pool.query.mock.calls[0][1] as unknown[];
      expect(params).toContain('orchestrator');
      expect(params).toContain('executing');
      expect(params).toContain('00000000-0000-0000-0000-000000000030');
    });

    it('accepts draining state', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ drain_requested: false }],
        rowCount: 1,
      });

      await service.recordHeartbeat(TENANT_ID, {
        runtime_id: RUNTIME_ID,
        playbook_id: PLAYBOOK_ID,
        pool_kind: 'specialist',
        state: 'draining',
        image: 'agirunner-runtime:local',
      });

      const params = pool.query.mock.calls[0][1] as unknown[];
      expect(params).toContain('draining');
    });

    it('rejects invalid state', async () => {
      await expect(
        service.recordHeartbeat(TENANT_ID, {
          runtime_id: RUNTIME_ID,
          playbook_id: PLAYBOOK_ID,
          pool_kind: 'specialist',
          state: 'exploding',
          image: 'agirunner-runtime:local',
        }),
      ).rejects.toThrow(/Invalid heartbeat state/);
    });

    it('rejects invalid pool kind', async () => {
      await expect(
        service.recordHeartbeat(TENANT_ID, {
          runtime_id: RUNTIME_ID,
          playbook_id: PLAYBOOK_ID,
          pool_kind: 'hybrid' as never,
          state: 'idle',
          image: 'agirunner-runtime:local',
        }),
      ).rejects.toThrow(/Invalid heartbeat pool kind/);
    });
  });

  describe('getReconcileSnapshot', () => {
    it('includes typed container manager config from runtime defaults', async () => {
      pool.query.mockImplementation(async (query: string) => {
        if (query.includes('FROM worker_desired_state')) {
          return { rows: [], rowCount: 0 };
        }
        if (query.includes('SELECT config_key, config_value FROM runtime_defaults')) {
          return {
            rows: [
              { config_key: 'platform.api_request_timeout_seconds', config_value: '19' },
              { config_key: 'platform.log_ingest_timeout_seconds', config_value: '17' },
              { config_key: 'container_manager.reconcile_interval_seconds', config_value: '7' },
              { config_key: 'container_manager.stop_timeout_seconds', config_value: '45' },
              { config_key: 'container_manager.shutdown_task_stop_timeout_seconds', config_value: '3' },
              { config_key: 'container_manager.docker_action_buffer_seconds', config_value: '20' },
              { config_key: 'container_manager.log_flush_interval_ms', config_value: '500' },
              { config_key: 'container_manager.docker_event_reconnect_backoff_ms', config_value: '5000' },
              { config_key: 'container_manager.crash_log_capture_timeout_seconds', config_value: '5' },
              { config_key: 'container_manager.starvation_threshold_seconds', config_value: '60' },
              { config_key: 'container_manager.runtime_orphan_grace_cycles', config_value: '3' },
              { config_key: 'container_manager.hung_runtime_stale_after_seconds', config_value: '90' },
              { config_key: 'container_manager.hung_runtime_stop_grace_period_seconds', config_value: '30' },
              { config_key: 'container_manager.runtime_log_max_size_mb', config_value: '10' },
              { config_key: 'container_manager.runtime_log_max_files', config_value: '3' },
              { config_key: 'global_max_specialists', config_value: '12' },
              { config_key: 'specialist_runtime_default_image', config_value: 'agirunner-runtime:local' },
              { config_key: 'specialist_runtime_default_cpu', config_value: '2' },
              { config_key: 'specialist_runtime_default_memory', config_value: '256m' },
              { config_key: 'specialist_runtime_default_pull_policy', config_value: 'if-not-present' },
              { config_key: 'specialist_runtime_bootstrap_claim_timeout_seconds', config_value: '30' },
              { config_key: 'specialist_runtime_drain_grace_seconds', config_value: '30' },
            ],
            rowCount: 20,
          };
        }
        if (query.includes('FROM runtime_heartbeats')) {
          return { rows: [], rowCount: 0 };
        }
        if (query.includes('WITH ready_specialist_tasks AS')) {
          return {
            rows: [{
              pending_tasks: 0,
              specialist_tasks_with_capabilities: 0,
              specialist_distinct_capability_sets: 0,
              specialist_max_required_capabilities: 0,
              active_runtimes: 0,
              active_execution_containers: 0,
            }],
            rowCount: 1,
          };
        }
        throw new Error(`Unexpected query in getReconcileSnapshot test: ${query}`);
      });

      const result = await service.getReconcileSnapshot(TENANT_ID);

      expect(result.container_manager_config).toEqual({
        platform_api_request_timeout_seconds: 19,
        platform_log_ingest_timeout_seconds: 17,
        reconcile_interval_seconds: 7,
        stop_timeout_seconds: 45,
        shutdown_task_stop_timeout_seconds: 3,
        docker_action_buffer_seconds: 20,
        log_flush_interval_ms: 500,
        docker_event_reconnect_backoff_ms: 5000,
        crash_log_capture_timeout_seconds: 5,
        starvation_threshold_seconds: 60,
        runtime_orphan_grace_cycles: 3,
        hung_runtime_stale_after_seconds: 90,
        hung_runtime_stop_grace_period_seconds: 30,
        global_max_runtimes: 12,
        runtime_log_max_size_mb: 10,
        runtime_log_max_files: 3,
      });
    });

    it('fails closed when required container-manager runtime defaults are missing', async () => {
      pool.query.mockImplementation(async (query: string) => {
        if (query.includes('FROM worker_desired_state')) {
          return { rows: [], rowCount: 0 };
        }
        if (query.includes('SELECT config_key, config_value FROM runtime_defaults')) {
          return { rows: [], rowCount: 0 };
        }
        if (query.includes('FROM runtime_heartbeats')) {
          return { rows: [], rowCount: 0 };
        }
        if (query.includes('WITH ready_specialist_tasks AS')) {
          return {
            rows: [{
              pending_tasks: 0,
              specialist_tasks_with_capabilities: 0,
              specialist_distinct_capability_sets: 0,
              specialist_max_required_capabilities: 0,
              active_runtimes: 0,
              active_execution_containers: 0,
            }],
            rowCount: 1,
          };
        }
        throw new Error(`Unexpected query in getReconcileSnapshot test: ${query}`);
      });

      await expect(service.getReconcileSnapshot(TENANT_ID)).rejects.toThrow(
        /Missing runtime default "container_manager\.hung_runtime_stale_after_seconds"/,
      );
    });
  });

  describe('drainRuntime', () => {
    it('sets drain_requested on existing heartbeat', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{}], rowCount: 1 });

      await service.drainRuntime(TENANT_ID, RUNTIME_ID);

      const query = pool.query.mock.calls[0][0] as string;
      expect(query).toContain('drain_requested = true');
      expect(query).toContain('runtime_heartbeats');
    });

    it('throws NotFoundError when runtime not found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await expect(service.drainRuntime(TENANT_ID, RUNTIME_ID)).rejects.toThrow(
        /not found/i,
      );
    });
  });
});

