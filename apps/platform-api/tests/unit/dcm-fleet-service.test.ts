import { describe, expect, it, vi, beforeEach } from 'vitest';

import { FleetService } from '../../src/services/fleet-service.js';

function createMockPool() {
  return { query: vi.fn() };
}

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const PLAYBOOK_ID = '00000000-0000-0000-0000-000000000010';
const RUNTIME_ID = '00000000-0000-0000-0000-000000000020';

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

  describe('getRuntimeTargets', () => {
    it('returns targets derived from playbooks with runtime config', async () => {
      // First call: loadRuntimeDefaults
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      // Second call: playbooks query
      pool.query.mockResolvedValueOnce({
        rows: [{
          playbook_id: PLAYBOOK_ID,
          playbook_name: 'SDLC Pipeline',
          definition: {
            roles: ['developer'],
            board: { columns: [{ id: 'planned', label: 'Planned' }] },
            stages: [],
            lifecycle: 'planned',
            runtime: {
              specialist_pool: {
                pool_mode: 'warm',
                max_runtimes: 2,
                priority: 5,
                idle_timeout_seconds: 300,
                grace_period_seconds: 180,
                image: 'agirunner-runtime:v1',
                pull_policy: 'always',
                cpu: '2.0',
                memory: '1g',
              },
              orchestrator_pool: {
                pool_mode: 'warm',
                max_runtimes: 1,
                priority: 10,
              },
            },
          },
          active_workflows: 1,
          pending_tasks: 3,
          pending_orchestrator_tasks: 1,
          specialist_tasks_with_capabilities: 2,
          specialist_distinct_capability_sets: 2,
          specialist_max_required_capabilities: 3,
        }],
        rowCount: 1,
      });
      pool.query.mockResolvedValueOnce({
        rows: [{ name: 'developer', capabilities: ['coding', 'testing'] }],
        rowCount: 1,
      });

      const result = await service.getRuntimeTargets(TENANT_ID);

      expect(result).toHaveLength(2);
      expect(result[0].playbook_id).toBe(PLAYBOOK_ID);
      expect(result[0].pool_kind).toBe('orchestrator');
      expect(result[0].capability_tags).toEqual([]);
      expect(result[0].pool_mode).toBe('warm');
      expect(result[0].max_runtimes).toBe(1);
      expect(result[0].priority).toBe(10);
      expect(result[0].pending_tasks).toBe(1);
      expect(result[0].capability_demand_units).toBe(0);
      expect(result[1].pool_kind).toBe('specialist');
      expect(result[1].capability_tags).toEqual(['developer', 'role:developer', 'coding', 'testing']);
      expect(result[1].image).toBe('agirunner-runtime:v1');
      expect(result[1].pending_tasks).toBe(3);
      expect(result[1].tasks_with_capabilities).toBe(2);
      expect(result[1].distinct_capability_sets).toBe(2);
      expect(result[1].max_required_capabilities).toBe(3);
      expect(result[1].capability_demand_units).toBe(7);
      expect(result[1].active_workflows).toBe(1);
    });

    it('applies hardcoded fallbacks when no runtime defaults configured', async () => {
      // First call: loadRuntimeDefaults (empty)
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      // Second call: playbooks query
      pool.query.mockResolvedValueOnce({
        rows: [{
          playbook_id: PLAYBOOK_ID,
          playbook_name: 'Minimal',
          definition: {
            roles: ['developer'],
            board: { columns: [{ id: 'planned', label: 'Planned' }] },
            stages: [],
            lifecycle: 'planned',
            runtime: {},
          },
          active_workflows: 0,
          pending_tasks: 0,
          pending_orchestrator_tasks: 0,
          specialist_tasks_with_capabilities: 0,
          specialist_distinct_capability_sets: 0,
          specialist_max_required_capabilities: 0,
        }],
        rowCount: 1,
      });
      pool.query.mockResolvedValueOnce({
        rows: [{ name: 'developer', capabilities: ['coding', 'testing'] }],
        rowCount: 1,
      });

      const result = await service.getRuntimeTargets(TENANT_ID);

      expect(result[0].pool_kind).toBe('specialist');
      expect(result[0].capability_tags).toEqual(['developer', 'role:developer', 'coding', 'testing']);
      expect(result[0].pool_mode).toBe('warm');
      expect(result[0].max_runtimes).toBe(1);
      expect(result[0].priority).toBe(0);
      expect(result[0].idle_timeout_seconds).toBe(300);
      expect(result[0].grace_period_seconds).toBe(180);
      expect(result[0].image).toBe('agirunner-runtime:local');
      expect(result[0].pull_policy).toBe('if-not-present');
      expect(result[0].cpu).toBe('1');
      expect(result[0].memory).toBe('256m');
    });

    it('uses runtime_defaults table values as fallbacks', async () => {
      // First call: loadRuntimeDefaults with seeded values
      pool.query.mockResolvedValueOnce({
        rows: [
          { config_key: 'default_cpu', config_value: '1' },
          { config_key: 'default_memory', config_value: '512m' },
          { config_key: 'default_pull_policy', config_value: 'always' },
          { config_key: 'default_grace_period', config_value: '30' },
          { config_key: 'default_runtime_image', config_value: 'agirunner-runtime:v2' },
        ],
        rowCount: 5,
      });
      // Second call: playbooks query
      pool.query.mockResolvedValueOnce({
        rows: [{
          playbook_id: PLAYBOOK_ID,
          playbook_name: 'Minimal',
          definition: {
            roles: ['developer'],
            board: { columns: [{ id: 'planned', label: 'Planned' }] },
            stages: [],
            lifecycle: 'planned',
            runtime: {},
          },
          active_workflows: 0,
          pending_tasks: 0,
          pending_orchestrator_tasks: 0,
          specialist_tasks_with_capabilities: 0,
          specialist_distinct_capability_sets: 0,
          specialist_max_required_capabilities: 0,
        }],
        rowCount: 1,
      });
      pool.query.mockResolvedValueOnce({
        rows: [{ name: 'developer', capabilities: ['coding', 'testing'] }],
        rowCount: 1,
      });

      const result = await service.getRuntimeTargets(TENANT_ID);

      expect(result[0].cpu).toBe('1');
      expect(result[0].memory).toBe('512m');
      expect(result[0].pull_policy).toBe('always');
      expect(result[0].grace_period_seconds).toBe(30);
      expect(result[0].image).toBe('agirunner-runtime:v2');
    });

    it('returns empty array when no playbooks have runtime config', async () => {
      // First call: loadRuntimeDefaults
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      // Second call: playbooks query
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      // Third call: role capability lookup (no roles to resolve)
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await service.getRuntimeTargets(TENANT_ID);

      expect(result).toEqual([]);
    });

    it('uses shared aggregates instead of repeated correlated task scans', async () => {
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await service.getRuntimeTargets(TENANT_ID);

      const query = pool.query.mock.calls[1]?.[0] as string;
      expect(query).toContain('WITH active_workflows AS');
      expect(query).toContain('task_counts AS');
      expect(query).toContain('COUNT(*) FILTER');
      expect(query).toContain('COUNT(DISTINCT tk.capabilities_required) FILTER');
      expect(query.match(/FROM tasks tk/g)).toHaveLength(1);
      expect(query).not.toContain('(SELECT COUNT(*)::int FROM tasks tk');
    });

    it('includes all playbook role tags and capabilities for specialist pools', async () => {
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      pool.query.mockResolvedValueOnce({
        rows: [{
          playbook_id: PLAYBOOK_ID,
          playbook_name: 'SDLC Pipeline',
          definition: {
            roles: ['developer', 'reviewer', 'product-manager'],
            board: { columns: [{ id: 'planned', label: 'Planned' }] },
            checkpoints: [],
            lifecycle: 'planned',
            runtime: {},
          },
          active_workflows: 1,
          pending_tasks: 3,
          pending_orchestrator_tasks: 0,
          specialist_tasks_with_capabilities: 2,
          specialist_distinct_capability_sets: 1,
          specialist_max_required_capabilities: 2,
        }],
        rowCount: 1,
      });
      pool.query.mockResolvedValueOnce({
        rows: [
          { name: 'developer', capabilities: ['coding', 'testing'] },
          { name: 'reviewer', capabilities: ['code-review', 'security-review'] },
          { name: 'product-manager', capabilities: ['requirements', 'documentation', 'research'] },
        ],
        rowCount: 3,
      });

      const result = await service.getRuntimeTargets(TENANT_ID);

      expect(result).toHaveLength(1);
      expect(result[0].capability_tags).toEqual([
        'developer',
        'role:developer',
        'coding',
        'testing',
        'reviewer',
        'role:reviewer',
        'code-review',
        'security-review',
        'product-manager',
        'role:product-manager',
        'requirements',
        'documentation',
        'research',
      ]);
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
      // First call: global_max_runtimes config
      pool.query.mockResolvedValueOnce({
        rows: [{ config_value: '10' }],
        rowCount: 1,
      });
      // Second call: heartbeats
      pool.query.mockResolvedValueOnce({
        rows: [
          { runtime_id: '00000000-0000-0000-0000-000000000020', tenant_id: TENANT_ID, playbook_id: PLAYBOOK_ID, playbook_name: 'SDLC', pool_kind: 'specialist', state: 'executing', task_id: null },
          { runtime_id: '00000000-0000-0000-0000-000000000021', tenant_id: TENANT_ID, playbook_id: PLAYBOOK_ID, playbook_name: 'SDLC', pool_kind: 'specialist', state: 'idle', task_id: null },
          { runtime_id: '00000000-0000-0000-0000-000000000022', tenant_id: TENANT_ID, playbook_id: PLAYBOOK_ID, playbook_name: 'SDLC', pool_kind: 'orchestrator', state: 'executing', task_id: 'task-1' },
        ],
        rowCount: 3,
      });
      // Third call: loadRuntimeDefaults (inside getRuntimeTargets)
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      // Fourth call: runtime targets playbooks query
      pool.query.mockResolvedValueOnce({
        rows: [{
          playbook_id: PLAYBOOK_ID,
          playbook_name: 'SDLC',
          definition: {
            roles: ['developer'],
            board: { columns: [{ id: 'planned', label: 'Planned' }] },
            stages: [],
            lifecycle: 'planned',
            runtime: {
              orchestrator_pool: { max_runtimes: 1 },
              specialist_pool: { max_runtimes: 3 },
            },
          },
          active_workflows: 1,
          pending_tasks: 2,
          pending_orchestrator_tasks: 1,
          specialist_tasks_with_capabilities: 2,
          specialist_distinct_capability_sets: 1,
          specialist_max_required_capabilities: 2,
        }],
        rowCount: 1,
      });
      // Fifth call: role capabilities for runtime target capabilities
      pool.query.mockResolvedValueOnce({
        rows: [{ name: 'developer', capabilities: ['coding', 'testing'] }],
        rowCount: 1,
      });
      // Sixth call: worker pool status
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
      // Seventh call: recent_events
      pool.query.mockResolvedValueOnce({
        rows: [{ id: 'evt-1', event_type: 'runtime.started', level: 'info', created_at: new Date() }],
        rowCount: 1,
      });

      const result = await service.getFleetStatus(TENANT_ID);

      expect(result.global_max_runtimes).toBe(10);
      expect(result.total_running).toBe(3);
      expect(result.total_idle).toBe(1);
      expect(result.total_executing).toBe(2);
      expect(result.total_draining).toBe(0);
      expect(result.by_playbook).toHaveLength(1);
      expect(result.by_playbook[0].running).toBe(3);
      expect(result.by_playbook[0].max_runtimes).toBe(4);
      expect(result.by_playbook[0].pending_tasks).toBe(3);
      expect(result.by_playbook_pool).toHaveLength(2);
      expect(result.by_playbook_pool).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ pool_kind: 'orchestrator', pending_tasks: 1 }),
          expect.objectContaining({
            pool_kind: 'specialist',
            pending_tasks: 2,
            tasks_with_capabilities: 2,
            distinct_capability_sets: 1,
            max_required_capabilities: 2,
            capability_demand_units: 5,
          }),
        ]),
      );
      expect(result.worker_pools).toHaveLength(2);
      expect(result.recent_events).toHaveLength(1);
      expect(result.recent_events[0].event_type).toBe('runtime.started');
    });

    it('uses default global_max_runtimes when not configured', async () => {
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // global_max_runtimes
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // heartbeats
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // loadRuntimeDefaults
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // playbooks query
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // worker pool status
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // recent_events

      const result = await service.getFleetStatus(TENANT_ID);

      expect(result.global_max_runtimes).toBe(10);
      expect(result.total_running).toBe(0);
      expect(result.worker_pools).toEqual([]);
      expect(result.recent_events).toEqual([]);
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

  describe('validateRuntimeConfig', () => {
    it('passes through valid config unchanged', () => {
      const result = service.validateRuntimeConfig(
        PLAYBOOK_ID,
        { pool_mode: 'warm', max_runtimes: 2, pull_policy: 'always' },
      );

      expect(result.pool_mode).toBe('warm');
      expect(result.max_runtimes).toBe(2);
      expect(result.pull_policy).toBe('always');
    });

    it('defaults invalid pool_mode to warm', () => {
      const result = service.validateRuntimeConfig(
        PLAYBOOK_ID,
        { pool_mode: 'hot' } as never,
      );

      expect(result.pool_mode).toBe('warm');
    });

    it('defaults invalid max_runtimes to 1', () => {
      const result = service.validateRuntimeConfig(
        PLAYBOOK_ID,
        { max_runtimes: -5 },
      );

      expect(result.max_runtimes).toBe(1);
    });

    it('defaults non-integer max_runtimes to 1', () => {
      const result = service.validateRuntimeConfig(
        PLAYBOOK_ID,
        { max_runtimes: 2.5 },
      );

      expect(result.max_runtimes).toBe(1);
    });

    it('defaults zero max_runtimes to 1', () => {
      const result = service.validateRuntimeConfig(
        PLAYBOOK_ID,
        { max_runtimes: 0 },
      );

      expect(result.max_runtimes).toBe(1);
    });

    it('defaults invalid pull_policy to if-not-present', () => {
      const result = service.validateRuntimeConfig(
        PLAYBOOK_ID,
        { pull_policy: 'sometimes' } as never,
      );

      expect(result.pull_policy).toBe('if-not-present');
    });

    it('logs warnings for invalid values', () => {
      const mockLogger = { warn: vi.fn() };
      const loggedService = new FleetService(pool as never, mockLogger);

      loggedService.validateRuntimeConfig(
        PLAYBOOK_ID,
        { pool_mode: 'hot', max_runtimes: -1, pull_policy: 'sometimes' } as never,
      );

      expect(mockLogger.warn).toHaveBeenCalledTimes(3);
    });
  });

  describe('getFleetStatus recent_events', () => {
    it('includes recent fleet events in status response', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ config_value: '5' }], rowCount: 1 }); // global_max
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // heartbeats
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // loadRuntimeDefaults
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // playbooks query
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // worker pool status
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
      pool.query.mockResolvedValueOnce({ rows: [{ config_value: '5' }], rowCount: 1 });
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
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
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // global_max
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // heartbeats
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // loadRuntimeDefaults
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // playbooks query
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // worker pool status
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // recent_events

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
