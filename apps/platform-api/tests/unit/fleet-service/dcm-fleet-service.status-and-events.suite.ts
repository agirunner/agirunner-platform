import { beforeEach, describe, expect, it } from 'vitest';

import { FleetService } from '../../../src/services/fleet-service.js';
import {
  createMockPool,
  createRuntimeTargetDefaultRows,
  PLAYBOOK_ID,
  TENANT_ID,
} from './support.js';

describe('FleetService DCM status and event flows', () => {
  let pool: ReturnType<typeof createMockPool>;
  let service: FleetService;

  beforeEach(() => {
    pool = createMockPool();
    service = new FleetService(pool as never);
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
          { runtime_id: '00000000-0000-0000-0000-000000000020', tenant_id: TENANT_ID, playbook_id: null, playbook_name: 'Specialist Agents', pool_kind: 'specialist', state: 'executing', task_id: null },
          { runtime_id: '00000000-0000-0000-0000-000000000021', tenant_id: TENANT_ID, playbook_id: null, playbook_name: 'Specialist Agents', pool_kind: 'specialist', state: 'idle', task_id: null },
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
            playbook_name: 'Specialist Agents',
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
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

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
      expect(heartbeatParams).toEqual([TENANT_ID, 'Specialist Agents', 90]);
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

      await service.listFleetEvents(TENANT_ID, { runtime_id: '00000000-0000-0000-0000-000000000020' });

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
        runtime_id: '00000000-0000-0000-0000-000000000020',
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

