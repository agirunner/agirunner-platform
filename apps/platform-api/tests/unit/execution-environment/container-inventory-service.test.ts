import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ContainerInventoryService,
  type LiveContainerInventoryInput,
} from '../../../src/services/execution-environment/container-inventory-service.js';

function createMockPool() {
  return { query: vi.fn() };
}

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

describe('ContainerInventoryService', () => {
  let pool: ReturnType<typeof createMockPool>;
  let service: ContainerInventoryService;

  beforeEach(() => {
    pool = createMockPool();
    service = new ContainerInventoryService(pool as never);
  });

  it('replaces the tenant live snapshot and lists enriched current rows', async () => {
    const snapshot: LiveContainerInventoryInput[] = [
      {
        container_id: 'orchestrator-container-1',
        name: 'orchestrator-primary',
        kind: 'orchestrator',
        state: 'running',
        status: 'Up 8 minutes',
        image: 'agirunner-runtime:local',
        cpu_limit: '1',
        memory_limit: '512m',
        started_at: '2026-03-21T18:22:00.000Z',
        desired_state_id: '00000000-0000-0000-0000-000000000010',
        execution_backend: 'runtime_only',
      },
      {
        container_id: 'runtime-container-1',
        name: 'runtime-speciali-3262b311',
        kind: 'runtime',
        state: 'running',
        status: 'Up 4 minutes',
        image: 'agirunner-runtime:local',
        cpu_limit: '2',
        memory_limit: '1536m',
        started_at: '2026-03-21T18:24:00.000Z',
        runtime_id: 'runtime-1',
        execution_backend: 'runtime_plus_task',
      },
      {
        container_id: 'task-container-1',
        name: 'task-3d749b2c',
        kind: 'task',
        state: 'running',
        status: 'Up 90 seconds',
        image: 'debian:trixie-slim',
        cpu_limit: '1',
        memory_limit: '768m',
        started_at: '2026-03-21T18:26:00.000Z',
        runtime_id: 'runtime-1',
        task_id: '00000000-0000-0000-0000-000000000111',
        workflow_id: '00000000-0000-0000-0000-000000000222',
        execution_backend: 'runtime_plus_task',
        role_name: 'developer',
      },
    ];

    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    pool.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'orchestrator:orchestrator-primary',
          kind: 'orchestrator',
          name: 'orchestrator-primary',
          state: 'running',
          status: 'Up 8 minutes',
          image: 'agirunner-runtime:local',
          cpu_limit: '1',
          memory_limit: '512m',
          started_at: new Date('2026-03-21T18:22:00.000Z'),
          last_seen_at: new Date('2026-03-21T18:30:00.000Z'),
          execution_backend: 'runtime_only',
          role_name: 'orchestrator',
          playbook_id: null,
          playbook_name: null,
          workflow_id: '00000000-0000-0000-0000-000000000222',
          workflow_name: 'Fix login bug',
          task_id: '00000000-0000-0000-0000-000000000333',
          task_title: 'Coordinate workflow',
          stage_name: 'Intake',
          activity_state: 'claimed',
        },
        {
          id: 'runtime:runtime-1',
          kind: 'runtime',
          name: 'runtime-speciali-3262b311',
          state: 'running',
          status: 'Up 4 minutes',
          image: 'agirunner-runtime:local',
          cpu_limit: '2',
          memory_limit: '1536m',
          started_at: new Date('2026-03-21T18:24:00.000Z'),
          last_seen_at: new Date('2026-03-21T18:30:00.000Z'),
          execution_backend: 'runtime_plus_task',
          role_name: 'developer',
          playbook_id: '00000000-0000-0000-0000-000000000555',
          playbook_name: 'Bug Investigation',
          workflow_id: '00000000-0000-0000-0000-000000000222',
          workflow_name: 'Fix login bug',
          task_id: '00000000-0000-0000-0000-000000000111',
          task_title: 'Investigate auth timeout',
          stage_name: 'Implement',
          activity_state: 'executing',
        },
        {
          id: 'task:00000000-0000-0000-0000-000000000111',
          kind: 'task',
          name: 'task-3d749b2c',
          state: 'running',
          status: 'Up 90 seconds',
          image: 'debian:trixie-slim',
          cpu_limit: '1',
          memory_limit: '768m',
          started_at: new Date('2026-03-21T18:26:00.000Z'),
          last_seen_at: new Date('2026-03-21T18:30:00.000Z'),
          execution_backend: 'runtime_plus_task',
          role_name: 'developer',
          playbook_id: '00000000-0000-0000-0000-000000000555',
          playbook_name: 'Bug Investigation',
          workflow_id: '00000000-0000-0000-0000-000000000222',
          workflow_name: 'Fix login bug',
          task_id: '00000000-0000-0000-0000-000000000111',
          task_title: 'Investigate auth timeout',
          stage_name: 'Implement',
          activity_state: 'in_progress',
          execution_environment_id: 'env-default',
          execution_environment_name: 'Debian Base',
          execution_environment_image: 'debian:trixie-slim',
          execution_environment_distro: 'debian',
          execution_environment_package_manager: 'apt-get',
        },
      ],
      rowCount: 3,
    });

    await service.replaceLiveSnapshot(TENANT_ID, snapshot);
    const rows = await service.listCurrentContainers(TENANT_ID);

    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      id: 'orchestrator:orchestrator-primary',
      kind: 'orchestrator',
      cpu_limit: '1',
      memory_limit: '512m',
      workflow_name: 'Fix login bug',
    });
    expect(rows[1]).toMatchObject({
      id: 'runtime:runtime-1',
      kind: 'runtime',
      playbook_name: 'Bug Investigation',
      role_name: 'developer',
      execution_backend: 'runtime_plus_task',
    });
    expect(rows[2]).toMatchObject({
      id: 'task:00000000-0000-0000-0000-000000000111',
      kind: 'task',
      image: 'debian:trixie-slim',
      task_title: 'Investigate auth timeout',
      stage_name: 'Implement',
      execution_backend: 'runtime_plus_task',
      execution_environment_id: 'env-default',
      execution_environment_name: 'Debian Base',
      execution_environment_image: 'debian:trixie-slim',
      execution_environment_distro: 'debian',
      execution_environment_package_manager: 'apt-get',
    });

    const replaceQuery = pool.query.mock.calls[0]?.[0] as string;
    expect(replaceQuery).toContain('DELETE FROM live_container_inventory');
    expect(replaceQuery).toContain('INSERT INTO live_container_inventory');
    expect(replaceQuery).toContain('ON CONFLICT (tenant_id, container_id) DO UPDATE');
    expect(replaceQuery).toContain('execution_backend');

    const listQuery = pool.query.mock.calls[1]?.[0] as string;
    expect(listQuery).toContain('FROM live_container_inventory live');
    expect(listQuery).toContain('LEFT JOIN runtime_heartbeats rh');
    expect(listQuery).toContain('LEFT JOIN tasks t');
    expect(listQuery).toContain('t.stage_name AS stage_name');
    expect(listQuery).toContain('execution_backend');
    expect(listQuery).toContain('execution_environment_snapshot');
    expect(listQuery).toContain('LEFT JOIN workflows w');
  });

  it('deduplicates live snapshot rows by container id before replacing the tenant snapshot', async () => {
    const snapshot: LiveContainerInventoryInput[] = [
      {
        container_id: 'runtime-container-1',
        name: 'runtime-specialist-1',
        kind: 'runtime',
        state: 'running',
        status: 'Up 30 seconds',
        image: 'agirunner-runtime:old',
      },
      {
        container_id: 'runtime-container-1',
        name: 'runtime-specialist-1',
        kind: 'runtime',
        state: 'running',
        status: 'Up 45 seconds',
        image: 'agirunner-runtime:new',
      },
    ];

    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await service.replaceLiveSnapshot(TENANT_ID, snapshot);

    const params = pool.query.mock.calls[0]?.[1] as [string, string];
    const payload = JSON.parse(params[1]) as LiveContainerInventoryInput[];

    expect(payload).toHaveLength(1);
    expect(payload[0]).toMatchObject({
      container_id: 'runtime-container-1',
      status: 'Up 45 seconds',
      image: 'agirunner-runtime:new',
    });
  });

  it('joins runtime heartbeats without comparing uuid values to text container labels', async () => {
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await service.listCurrentContainers(TENANT_ID);

    const listQuery = pool.query.mock.calls[0]?.[0] as string;
    expect(listQuery).toContain('rh.runtime_id::text = live.runtime_id');
    expect(listQuery).not.toContain('rh.runtime_id = live.runtime_id');
    expect(listQuery).toContain('p.id::text AS playbook_id');
    expect(listQuery).not.toContain("COALESCE(p.id::text, NULLIF(BTRIM(live.live_playbook_id), ''))");
  });

  it('matches orchestrator containers to active agent tasks by agent instance id', async () => {
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await service.listCurrentContainers(TENANT_ID);

    const listQuery = pool.query.mock.calls[0]?.[0] as string;
    expect(listQuery).toContain('active_agent_tasks AS');
    expect(listQuery).toContain('JOIN agents a');
    expect(listQuery).toContain("live.container_id LIKE (a.metadata->>'instance_id') || '%'");
    expect(listQuery).toContain('t.id = a.current_task_id');
    expect(listQuery).toContain('active_agent_task_id');
  });

  it('does not project stale orchestrator workflow or task labels when no active orchestrator task is linked', async () => {
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await service.listCurrentContainers(TENANT_ID);

    const listQuery = pool.query.mock.calls[0]?.[0] as string;
    expect(listQuery).toContain('active_heartbeat_tasks AS');
    expect(listQuery).toContain("CASE WHEN live.kind = 'task' THEN live.live_task_id ELSE NULL END");
    expect(listQuery).toContain("CASE WHEN live.kind = 'task' THEN live.live_workflow_id ELSE NULL END");
    expect(listQuery).not.toContain('COALESCE(t.id, live.live_task_id, live.active_agent_task_id, live.active_task_id, live.heartbeat_task_id)');
    expect(listQuery).not.toContain('COALESCE(w.id, live.live_workflow_id)');
  });

  it('does not expose unmatched live playbook ids as linkable playbook ids', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'runtime:runtime-1',
          kind: 'runtime',
          name: 'runtime-specialist-1',
          state: 'running',
          status: 'Up 30 seconds',
          image: 'agirunner-runtime:local',
          cpu_limit: '1',
          memory_limit: '768m',
          started_at: new Date('2026-03-21T18:24:00.000Z'),
          last_seen_at: new Date('2026-03-21T18:30:00.000Z'),
          execution_backend: 'runtime_only',
          role_name: 'developer',
          playbook_id: null,
          playbook_name: 'Specialist',
          workflow_id: null,
          workflow_name: null,
          task_id: null,
          task_title: null,
          stage_name: null,
          activity_state: 'idle',
        },
      ],
      rowCount: 1,
    });

    const rows = await service.listCurrentContainers(TENANT_ID);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      playbook_id: null,
      playbook_name: 'Specialist',
    });
  });

  it('maps active desired-state work by container instance instead of shared desired state', async () => {
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await service.listCurrentContainers(TENANT_ID);

    const listQuery = pool.query.mock.calls[0]?.[0] as string;
    expect(listQuery).toContain('SELECT DISTINCT ON (was.container_id)');
    expect(listQuery).toContain('was.container_id,');
    expect(listQuery).toContain('ON awt.container_id = live.container_id');
    expect(listQuery).not.toContain('SELECT DISTINCT ON (was.desired_state_id)');
    expect(listQuery).not.toContain('ON awt.desired_state_id = live.desired_state_id');
  });

  it('prefers the active assigned task over heartbeat bookkeeping when resolving runtime task labels', async () => {
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await service.listCurrentContainers(TENANT_ID);

    const listQuery = pool.query.mock.calls[0]?.[0] as string;
    expect(listQuery).toContain('live.active_agent_task_id');
    expect(listQuery).toContain('live.active_task_id');
    expect(listQuery).toContain('live.heartbeat_active_task_id');
    expect(listQuery).toContain('live.live_task_id');
    expect(listQuery).toContain('live.active_agent_task_id,');
    expect(listQuery).toContain('t.id = COALESCE(');
    expect(listQuery).toContain('COALESCE(');
    expect(listQuery).not.toContain('live.heartbeat_active_task_id, live.active_task_id');
  });

  it('projects plain orchestrator task titles while keeping activation metadata separate', async () => {
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await service.listCurrentContainers(TENANT_ID);

    const listQuery = pool.query.mock.calls[0]?.[0] as string;
    expect(listQuery).toContain("t.metadata->>'activation_event_type'");
    expect(listQuery).toContain("t.metadata->>'activation_reason'");
    expect(listQuery).not.toContain('t.title AS task_title');
  });
});
