import { describe, expect, it, vi, beforeEach } from 'vitest';

import { FleetService } from '../../src/services/fleet-service.js';

function createMockPool() {
  return { query: vi.fn() };
}

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const PLAYBOOK_ID = '00000000-0000-0000-0000-000000000010';
const RUNTIME_ID = '00000000-0000-0000-0000-000000000020';

function createRuntimeTargetDefaultRows(overrides: Record<string, string> = {}) {
  const defaults = {
    global_max_specialists: '12',
    specialist_runtime_default_image: 'agirunner-runtime:local',
    specialist_runtime_default_cpu: '2',
    specialist_runtime_default_memory: '256m',
    specialist_runtime_default_pull_policy: 'if-not-present',
    specialist_runtime_bootstrap_claim_timeout_seconds: '30',
    specialist_runtime_drain_grace_seconds: '30',
    'container_manager.hung_runtime_stale_after_seconds': '90',
    'container_manager.runtime_log_max_size_mb': '10',
    'container_manager.runtime_log_max_files': '3',
    ...overrides,
  };
  return Object.entries(defaults).map(([config_key, config_value]) => ({ config_key, config_value }));
}

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
        playbook_name: 'Specialist runtimes',
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

  describe('getFleetStatus', () => {
    it('aggregates runtime states across playbooks', async () => {
      pool.query.mockResolvedValueOnce({
        rows: createRuntimeTargetDefaultRows({
          global_max_specialists: '6',
        }),
        rowCount: 8,
      });
      pool.query.mockResolvedValueOnce({
        rows: [
          { runtime_id: '00000000-0000-0000-0000-000000000020', tenant_id: TENANT_ID, playbook_id: null, playbook_name: 'Specialist runtimes', pool_kind: 'specialist', state: 'executing', task_id: null },
          { runtime_id: '00000000-0000-0000-0000-000000000021', tenant_id: TENANT_ID, playbook_id: null, playbook_name: 'Specialist runtimes', pool_kind: 'specialist', state: 'idle', task_id: null },
          { runtime_id: '00000000-0000-0000-0000-000000000022', tenant_id: TENANT_ID, playbook_id: PLAYBOOK_ID, playbook_name: 'SDLC', pool_kind: 'orchestrator', state: 'executing', task_id: 'task-1' },
        ],
        rowCount: 3,
      });
      pool.query.mockResolvedValueOnce({
        rows: createRuntimeTargetDefaultRows({
          global_max_specialists: '6',
        }),
        rowCount: 8,
      });
      pool.query.mockResolvedValueOnce({
        rows: [{
          pending_tasks: 2,
          specialist_tasks_with_capabilities: 2,
          specialist_distinct_capability_sets: 1,
          specialist_max_required_capabilities: 2,
          active_runtimes: 2,
          active_execution_containers: 1,
        }],
        rowCount: 1,
      });
      pool.query.mockResolvedValueOnce({
        rows: [{ name: 'developer' }],
        rowCount: 1,
      });
      pool.query.mockResolvedValueOnce({
        rows: [
          {
            pool_kind: 'orchestrator',
            desired_workers: 1,
            desired_replicas: 1,
            enabled_workers: 1,
            draining_workers: 0,
            running_containers: 1,
          },
          {
            pool_kind: 'specialist',
            desired_workers: 2,
            desired_replicas: 3,
            enabled_workers: 2,
            draining_workers: 0,
            running_containers: 2,
          },
        ],
        rowCount: 2,
      });
      pool.query.mockResolvedValueOnce({
        rows: [{ id: 'evt-1', event_type: 'runtime.started', level: 'info', created_at: new Date() }],
        rowCount: 1,
      });

      const result = await service.getFleetStatus(TENANT_ID);

      expect(result.global_max_runtimes).toBe(6);
      expect(result.total_running).toBe(3);
      expect(result.total_idle).toBe(1);
      expect(result.total_executing).toBe(2);
      expect(result.total_draining).toBe(0);
      expect(result.by_playbook).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            playbook_id: 'specialist',
            playbook_name: 'Specialist runtimes',
            running: 2,
            max_runtimes: 6,
            pending_tasks: 2,
          }),
          expect.objectContaining({
            playbook_id: PLAYBOOK_ID,
            playbook_name: 'SDLC',
            running: 1,
            max_runtimes: 0,
            pending_tasks: 0,
          }),
        ]),
      );
      expect(result.by_playbook_pool).toHaveLength(2);
      expect(result.by_playbook_pool).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ pool_kind: 'orchestrator', pending_tasks: 0 }),
          expect.objectContaining({
            playbook_id: 'specialist',
            pool_kind: 'specialist',
            pending_tasks: 2,
            max_runtimes: 6,
          }),
        ]),
      );
      expect(result.worker_pools).toHaveLength(2);
      expect(result.recent_events).toHaveLength(1);
      expect(result.recent_events[0].event_type).toBe('runtime.started');
    });

    it('fails closed when global_max_specialists is not configured', async () => {
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // global_max_specialists

      await expect(service.getFleetStatus(TENANT_ID)).rejects.toThrow(
        /Missing runtime default "global_max_specialists"/,
      );
    });

    it('filters stale runtime heartbeats out of live fleet status reads', async () => {
      pool.query.mockResolvedValueOnce({
        rows: createRuntimeTargetDefaultRows({ global_max_specialists: '10' }),
        rowCount: 9,
      });
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      pool.query.mockResolvedValueOnce({
        rows: createRuntimeTargetDefaultRows({ global_max_specialists: '10' }),
        rowCount: 9,
      });
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
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await service.getFleetStatus(TENANT_ID);

      const heartbeatQuery = pool.query.mock.calls[1]?.[0] as string;
      const heartbeatParams = pool.query.mock.calls[1]?.[1] as unknown[];
      expect(heartbeatQuery).toContain("rh.last_heartbeat_at >= now() - make_interval(secs => $3)");
      expect(heartbeatParams).toEqual([TENANT_ID, 'Specialist runtimes', 90]);
    });
  });

  describe('listFleetEvents', () => {
    it('returns paginated events', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ count: 25 }], rowCount: 1 })
        .mockResolvedValueOnce({
          rows: [
            { id: '1', event_type: 'runtime.started', level: 'info', created_at: new Date() },
          ],
          rowCount: 1,
        });

      const result = await service.listFleetEvents(TENANT_ID, { limit: 10, offset: 0 });

      expect(result.total).toBe(25);
      expect(result.events).toHaveLength(1);
    });

    it('applies playbook_id filter', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ count: 5 }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await service.listFleetEvents(TENANT_ID, { playbook_id: PLAYBOOK_ID });

      const countQuery = pool.query.mock.calls[0][0] as string;
      expect(countQuery).toContain('playbook_id');
    });

    it('applies runtime_id filter', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ count: 3 }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await service.listFleetEvents(TENANT_ID, { runtime_id: RUNTIME_ID });

      const countQuery = pool.query.mock.calls[0][0] as string;
      expect(countQuery).toContain('runtime_id');
    });

    it('applies time range filters', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ count: 0 }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await service.listFleetEvents(TENANT_ID, {
        since: '2026-01-01T00:00:00Z',
        until: '2026-12-31T23:59:59Z',
      });

      const countQuery = pool.query.mock.calls[0][0] as string;
      expect(countQuery).toContain('created_at >=');
      expect(countQuery).toContain('created_at <=');
    });

    it('redacts secret-bearing payload values from fleet event reads', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ count: 1 }], rowCount: 1 })
        .mockResolvedValueOnce({
          rows: [
            {
              id: '1',
              event_type: 'runtime.started',
              level: 'info',
              payload: {
                api_key: 'sk-secret-value',
                nested: {
                  authorization: 'Bearer top-secret-token',
                  safe: 'visible',
                },
              },
              created_at: new Date(),
            },
          ],
          rowCount: 1,
        });

      const result = await service.listFleetEvents(TENANT_ID, { limit: 10, offset: 0 });

      expect(result.events[0]?.payload).toEqual({
        api_key: 'redacted://fleet-event-secret',
        nested: {
          authorization: 'redacted://fleet-event-secret',
          safe: 'visible',
        },
      });
    });
  });

  describe('recordFleetEvent', () => {
    it('inserts event with all fields', async () => {
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await service.recordFleetEvent(TENANT_ID, {
        event_type: 'runtime.started',
        level: 'info',
        runtime_id: RUNTIME_ID,
        playbook_id: PLAYBOOK_ID,
        container_id: 'abc123',
        payload: { image: 'agirunner-runtime:local' },
      });

      expect(pool.query).toHaveBeenCalledTimes(1);
      const query = pool.query.mock.calls[0][0] as string;
      expect(query).toContain('fleet_events');
      const params = pool.query.mock.calls[0][1] as unknown[];
      expect(params[1]).toBe('runtime.started');
    });

    it('uses info as default level', async () => {
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await service.recordFleetEvent(TENANT_ID, {
        event_type: 'container.created',
      });

      const params = pool.query.mock.calls[0][1] as unknown[];
      expect(params[2]).toBe('info');
    });

    it('rejects invalid event type', async () => {
      await expect(
        service.recordFleetEvent(TENANT_ID, {
          event_type: 'invalid.event',
        }),
      ).rejects.toThrow(/Invalid fleet event type/);
    });

    it('rejects invalid event level', async () => {
      await expect(
        service.recordFleetEvent(TENANT_ID, {
          event_type: 'runtime.started',
          level: 'critical',
        }),
      ).rejects.toThrow(/Invalid fleet event level/);
    });

    it('accepts all valid event types', async () => {
      const validTypes = [
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
      ];

      for (const eventType of validTypes) {
        pool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
        await service.recordFleetEvent(TENANT_ID, { event_type: eventType });
      }

      expect(pool.query).toHaveBeenCalledTimes(validTypes.length);
    });

    it('accepts all valid event levels', async () => {
      const validLevels = ['debug', 'info', 'warn', 'error'];

      for (const level of validLevels) {
        pool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
        await service.recordFleetEvent(TENANT_ID, {
          event_type: 'runtime.started',
          level,
        });
      }

      expect(pool.query).toHaveBeenCalledTimes(validLevels.length);
    });

    it('redacts secret-bearing payload values before persistence', async () => {
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await service.recordFleetEvent(TENANT_ID, {
        event_type: 'runtime.started',
        payload: {
          api_key: 'sk-secret-value',
          headers: {
            Authorization: 'Bearer top-secret-token',
          },
          safe: 'visible',
        },
      });

      const params = pool.query.mock.calls[0][1] as unknown[];
      expect(JSON.parse(params[8] as string)).toEqual({
        api_key: 'redacted://fleet-event-secret',
        headers: {
          Authorization: 'redacted://fleet-event-secret',
        },
        safe: 'visible',
      });
    });
  });

  describe('getFleetStatus recent_events', () => {
    it('includes recent fleet events in status response', async () => {
      pool.query.mockResolvedValueOnce({
        rows: createRuntimeTargetDefaultRows({ global_max_specialists: '5' }),
        rowCount: 8,
      });
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      pool.query.mockResolvedValueOnce({
        rows: createRuntimeTargetDefaultRows({ global_max_specialists: '5' }),
        rowCount: 8,
      });
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
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const events = [
        { id: 'evt-1', event_type: 'runtime.started', level: 'info', created_at: new Date() },
        { id: 'evt-2', event_type: 'runtime.shutdown', level: 'info', created_at: new Date() },
      ];
      pool.query.mockResolvedValueOnce({ rows: events, rowCount: 2 });

      const result = await service.getFleetStatus(TENANT_ID);

      expect(result.recent_events).toHaveLength(2);
      expect(result.recent_events[0].id).toBe('evt-1');
      expect(result.recent_events[1].event_type).toBe('runtime.shutdown');
    });

    it('redacts secret-bearing payload values in recent fleet events', async () => {
      pool.query.mockResolvedValueOnce({
        rows: createRuntimeTargetDefaultRows({ global_max_specialists: '5' }),
        rowCount: 8,
      });
      pool.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });
      pool.query.mockResolvedValueOnce({
        rows: createRuntimeTargetDefaultRows({ global_max_specialists: '5' }),
        rowCount: 8,
      });
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
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      pool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'evt-1',
            event_type: 'runtime.started',
            level: 'info',
            payload: {
              api_key: 'sk-secret-value',
              nested: {
                authorization: 'Bearer top-secret-token',
                safe: 'visible',
              },
            },
            created_at: new Date(),
          },
        ],
        rowCount: 1,
      });

      const result = await service.getFleetStatus(TENANT_ID);

      expect(result.recent_events[0]?.payload).toEqual({
        api_key: 'redacted://fleet-event-secret',
        nested: {
          authorization: 'redacted://fleet-event-secret',
          safe: 'visible',
        },
      });
    });

    it('queries fleet_events with correct tenant and limit', async () => {
      pool.query.mockResolvedValueOnce({
        rows: createRuntimeTargetDefaultRows({ global_max_specialists: '5' }),
        rowCount: 8,
      });
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      pool.query.mockResolvedValueOnce({
        rows: createRuntimeTargetDefaultRows({ global_max_specialists: '5' }),
        rowCount: 8,
      });
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
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await service.getFleetStatus(TENANT_ID);

      const recentEventsCall = pool.query.mock.calls[5];
      const sql = recentEventsCall[0] as string;
      expect(sql).toContain('fleet_events');
      expect(sql).toContain('ORDER BY created_at DESC');
      expect(sql).toContain('LIMIT 20');
      const params = recentEventsCall[1] as unknown[];
      expect(params[0]).toBe(TENANT_ID);
    });
  });
});
