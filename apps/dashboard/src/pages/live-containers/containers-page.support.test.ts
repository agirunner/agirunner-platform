import { describe, expect, it } from 'vitest';

import {
  advanceSessionContainerRows,
  hasPendingField,
  hasRecentlyChangedField,
  isRecentlyChangedRow,
  isPendingChangeRow,
  mergeLiveContainerSessionRows,
  partitionSessionContainerRowsByFunction,
  type SessionContainerRow,
} from './containers-page.support.js';

function createRow(overrides: Partial<SessionContainerRow> = {}): SessionContainerRow {
  return {
    id: 'task:task-1',
    kind: 'task',
    container_id: 'task-container-1',
    name: 'task-3d749b2c',
    state: 'running',
    status: 'Up 90 seconds',
    image: 'debian:trixie-slim',
    cpu_limit: '1',
    memory_limit: '768m',
    started_at: '2026-03-21T18:26:00.000Z',
    last_seen_at: '2026-03-21T18:30:00.000Z',
    role_name: 'developer',
    playbook_id: 'playbook-1',
    playbook_name: 'Bug Investigation',
    workflow_id: 'workflow-1',
    workflow_name: 'Fix login bug',
    task_id: 'task-1',
    task_title: 'Investigate auth timeout',
    stage_name: 'Implement',
    activity_state: 'in_progress',
    presence: 'running',
    inactive_at: null,
    changed_at: null,
    changed_fields: [],
    pending_state: null,
    pending_flip_at: null,
    pending_fields: [],
    remembered_context: null,
    ...overrides,
  };
}

describe('mergeLiveContainerSessionRows', () => {
  it('treats the first successful snapshot as baseline instead of highlighting every row', () => {
    const merged = mergeLiveContainerSessionRows([], [createRow()], '2026-03-21T18:29:00.000Z');

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      id: 'task:task-1',
      presence: 'running',
      changed_at: null,
      changed_fields: [],
      pending_state: null,
      pending_flip_at: null,
      pending_fields: [],
    });
    expect(isRecentlyChangedRow(merged[0], Date.parse('2026-03-21T18:29:01.000Z'))).toBe(false);
  });

  it('keeps rows seen in the current session and flips missing ones to inactive after a successful refresh', () => {
    const previous = [
      createRow(),
      createRow({
        id: 'runtime:runtime-1',
        kind: 'runtime',
        container_id: 'runtime-container-1',
        name: 'runtime-specialist-1',
        task_id: null,
        task_title: null,
      }),
    ];

    const merged = mergeLiveContainerSessionRows(
      previous,
      [createRow({ id: 'runtime:runtime-1', kind: 'runtime', container_id: 'runtime-container-1' })],
      '2026-03-21T18:31:00.000Z',
    );

    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({
      id: 'runtime:runtime-1',
      presence: 'running',
    });
    expect(merged[1]).toMatchObject({
      id: 'task:task-1',
      presence: 'running',
      inactive_at: null,
      changed_at: null,
      cpu_limit: '1',
      memory_limit: '768m',
      workflow_name: 'Fix login bug',
      task_title: 'Investigate auth timeout',
    });

    const advanced = advanceSessionContainerRows(merged, '2026-03-21T18:31:01.100Z');
    expect(advanced[1]).toMatchObject({
      id: 'task:task-1',
      presence: 'inactive',
      inactive_at: '2026-03-21T18:31:00.000Z',
      changed_at: '2026-03-21T18:31:01.000Z',
    });
  });

  it('reactivates a previously inactive row when it returns to the live API payload', () => {
    const previous = [
      createRow({
        presence: 'inactive',
        inactive_at: '2026-03-21T18:31:00.000Z',
      }),
    ];

    const merged = mergeLiveContainerSessionRows(previous, [createRow()], '2026-03-21T18:32:00.000Z');

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      id: 'task:task-1',
      presence: 'inactive',
      inactive_at: '2026-03-21T18:31:00.000Z',
      changed_at: null,
    });
    expect(isPendingChangeRow(merged[0], Date.parse('2026-03-21T18:32:00.500Z'))).toBe(true);

    const advanced = advanceSessionContainerRows(merged, '2026-03-21T18:32:01.100Z');
    expect(advanced[0]).toMatchObject({
      presence: 'running',
      inactive_at: null,
      changed_at: '2026-03-21T18:32:01.000Z',
      changed_fields: ['status'],
    });
  });

  it('marks newly observed or changed live rows as recently changed', () => {
    const previous = [
      createRow({
        changed_at: null,
      }),
    ];

    const merged = mergeLiveContainerSessionRows(
      previous,
      [
        createRow({
          task_title: 'Investigate auth timeout in review',
        }),
      ],
      '2026-03-21T18:33:00.000Z',
    );

    expect(merged[0]).toMatchObject({
      id: 'task:task-1',
      presence: 'running',
      changed_at: null,
      task_title: 'Investigate auth timeout',
    });
    expect(isPendingChangeRow(merged[0], Date.parse('2026-03-21T18:33:00.500Z'))).toBe(true);

    const advanced = advanceSessionContainerRows(merged, '2026-03-21T18:33:01.100Z');
    expect(advanced[0]).toMatchObject({
      changed_at: '2026-03-21T18:33:01.000Z',
      task_title: 'Investigate auth timeout in review',
    });
    expect(hasRecentlyChangedField(advanced[0], 'task', Date.parse('2026-03-21T18:33:01.500Z'))).toBe(true);
    expect(hasRecentlyChangedField(advanced[0], 'status', Date.parse('2026-03-21T18:33:01.500Z'))).toBe(false);
    expect(isRecentlyChangedRow(advanced[0], Date.parse('2026-03-21T18:33:01.500Z'))).toBe(true);
    expect(isRecentlyChangedRow(advanced[0], Date.parse('2026-03-21T18:33:02.200Z'))).toBe(false);
  });

  it('highlights a truly new row that appears after the baseline snapshot', () => {
    const merged = mergeLiveContainerSessionRows(
      [createRow({ id: 'runtime:runtime-1', kind: 'runtime', container_id: 'runtime-container-1' })],
      [
        createRow({ id: 'runtime:runtime-1', kind: 'runtime', container_id: 'runtime-container-1' }),
        createRow(),
      ],
      '2026-03-21T18:33:00.000Z',
    );

    expect(merged[1]).toMatchObject({
      id: 'task:task-1',
      presence: 'running',
      changed_at: '2026-03-21T18:33:00.000Z',
    });
    expect(hasRecentlyChangedField(merged[1], 'image', Date.parse('2026-03-21T18:33:00.500Z'))).toBe(true);
    expect(hasRecentlyChangedField(merged[1], 'task', Date.parse('2026-03-21T18:33:00.500Z'))).toBe(true);
    expect(isRecentlyChangedRow(merged[1], Date.parse('2026-03-21T18:33:01.000Z'))).toBe(true);
  });

  it('keeps the old row briefly before flipping visible content changes to the new state', () => {
    const merged = mergeLiveContainerSessionRows(
      [createRow()],
      [
        createRow({
          task_title: 'Implement auth timeout fix',
          stage_name: 'Review',
        }),
      ],
      '2026-03-21T18:34:00.000Z',
    );

    expect(merged[0]).toMatchObject({
      task_title: 'Investigate auth timeout',
      stage_name: 'Implement',
      presence: 'running',
      changed_at: null,
    });
    expect(isPendingChangeRow(merged[0], Date.parse('2026-03-21T18:34:00.500Z'))).toBe(true);
    expect(hasPendingField(merged[0], 'task', Date.parse('2026-03-21T18:34:00.500Z'))).toBe(true);
    expect(hasPendingField(merged[0], 'stage', Date.parse('2026-03-21T18:34:00.500Z'))).toBe(true);
    expect(hasPendingField(merged[0], 'status', Date.parse('2026-03-21T18:34:00.500Z'))).toBe(false);

    const advanced = advanceSessionContainerRows(merged, '2026-03-21T18:34:01.100Z');
    expect(advanced[0]).toMatchObject({
      task_title: 'Implement auth timeout fix',
      stage_name: 'Review',
      presence: 'running',
      changed_at: '2026-03-21T18:34:01.000Z',
    });
    expect(isPendingChangeRow(advanced[0], Date.parse('2026-03-21T18:34:01.100Z'))).toBe(false);
    expect(hasRecentlyChangedField(advanced[0], 'task', Date.parse('2026-03-21T18:34:01.500Z'))).toBe(true);
    expect(hasRecentlyChangedField(advanced[0], 'stage', Date.parse('2026-03-21T18:34:01.500Z'))).toBe(true);
    expect(isRecentlyChangedRow(advanced[0], Date.parse('2026-03-21T18:34:01.500Z'))).toBe(true);
  });

  it('keeps the old running row briefly before flipping it to inactive', () => {
    const merged = mergeLiveContainerSessionRows(
      [createRow()],
      [],
      '2026-03-21T18:35:00.000Z',
    );

    expect(merged[0]).toMatchObject({
      presence: 'running',
      inactive_at: null,
      changed_at: null,
    });
    expect(isPendingChangeRow(merged[0], Date.parse('2026-03-21T18:35:00.500Z'))).toBe(true);

    const advanced = advanceSessionContainerRows(merged, '2026-03-21T18:35:01.100Z');
    expect(advanced[0]).toMatchObject({
      presence: 'inactive',
      inactive_at: '2026-03-21T18:35:00.000Z',
      changed_at: '2026-03-21T18:35:01.000Z',
    });
    expect(hasRecentlyChangedField(advanced[0], 'status', Date.parse('2026-03-21T18:35:01.500Z'))).toBe(true);
    expect(hasRecentlyChangedField(advanced[0], 'task', Date.parse('2026-03-21T18:35:01.500Z'))).toBe(false);
    expect(isRecentlyChangedRow(advanced[0], Date.parse('2026-03-21T18:35:01.500Z'))).toBe(true);
  });

  it('preserves the last real runtime context when a runtime goes idle and then disappears', () => {
    const runtimeRow = createRow({
      id: 'runtime:runtime-1',
      kind: 'runtime',
      container_id: 'runtime-container-1',
      name: 'runtime-specialist-1',
      role_name: 'developer',
      playbook_id: 'playbook-1',
      playbook_name: 'Bug Investigation',
      workflow_id: 'workflow-1',
      workflow_name: 'Fix login bug',
      task_id: 'task-1',
      task_title: 'Investigate auth timeout',
      stage_name: 'Implement',
      activity_state: 'in_progress',
    });

    const afterIdleRefresh = mergeLiveContainerSessionRows(
      [runtimeRow],
      [
        createRow({
          id: 'runtime:runtime-1',
          kind: 'runtime',
          container_id: 'runtime-container-1',
          name: 'runtime-specialist-1',
          role_name: null,
          playbook_id: null,
          playbook_name: 'Specialist Agents',
          workflow_id: null,
          workflow_name: null,
          task_id: null,
          task_title: null,
          stage_name: null,
          activity_state: 'idle',
        }),
      ],
      '2026-03-21T18:36:00.000Z',
    );

    const idleRuntime = advanceSessionContainerRows(afterIdleRefresh, '2026-03-21T18:36:01.100Z');
    expect(idleRuntime[0]).toMatchObject({
      presence: 'running',
      role_name: null,
      playbook_name: 'Specialist Agents',
      workflow_name: null,
      task_title: null,
      stage_name: null,
      activity_state: 'idle',
    });

    const afterDisappear = mergeLiveContainerSessionRows(
      idleRuntime,
      [],
      '2026-03-21T18:37:00.000Z',
    );
    const inactiveRuntime = advanceSessionContainerRows(afterDisappear, '2026-03-21T18:37:01.100Z');
    expect(inactiveRuntime[0]).toMatchObject({
      presence: 'inactive',
      role_name: 'developer',
      playbook_name: 'Bug Investigation',
      workflow_name: 'Fix login bug',
      task_title: 'Investigate auth timeout',
      stage_name: 'Implement',
    });
  });

  it('drops inactive rows after ten seconds', () => {
    const previous = [
      createRow({
        presence: 'inactive',
        inactive_at: '2026-03-21T18:30:00.000Z',
        changed_at: '2026-03-21T18:30:01.000Z',
      }),
    ];

    const merged = mergeLiveContainerSessionRows(previous, [], '2026-03-21T18:30:11.000Z');

    expect(merged).toEqual([]);
  });

  it('keeps only the 10 most recent inactive rows in the current session', () => {
    const previous = Array.from({ length: 12 }, (_, index) =>
      createRow({
        id: `task:task-${index}`,
        container_id: `task-container-${index}`,
        name: `task-${index}`,
        task_id: `task-${index}`,
        task_title: `Task ${index}`,
        presence: 'inactive',
        inactive_at: `2026-03-21T18:11:00.${String(index).padStart(3, '0')}Z`,
        changed_at: `2026-03-21T18:11:00.${String(index + 100).padStart(3, '0')}Z`,
      }),
    );

    const merged = mergeLiveContainerSessionRows(previous, [], '2026-03-21T18:11:09.000Z');

    expect(merged).toHaveLength(10);
    expect(merged.map((row) => row.id)).toEqual([
      'task:task-11',
      'task:task-10',
      'task:task-9',
      'task:task-8',
      'task:task-7',
      'task:task-6',
      'task:task-5',
      'task:task-4',
      'task:task-3',
      'task:task-2',
    ]);
  });
});

describe('partitionSessionContainerRowsByFunction', () => {
  it('groups orchestrator workers and orchestrator execution rows together', () => {
    const rows = [
      createRow({
        id: 'orchestrator:worker-1',
        kind: 'orchestrator',
        container_id: 'orchestrator-container-1',
        name: 'orchestrator-primary',
        role_name: 'orchestrator',
      }),
      createRow({
        id: 'task:task-2',
        kind: 'task',
        container_id: 'task-container-2',
        role_name: 'orchestrator',
      }),
      createRow({
        id: 'runtime:runtime-1',
        kind: 'runtime',
        container_id: 'runtime-container-1',
        name: 'runtime-specialist-1',
        role_name: null,
      }),
      createRow({
        id: 'task:task-3',
        kind: 'task',
        container_id: 'task-container-3',
        role_name: 'developer',
      }),
    ];

    const grouped = partitionSessionContainerRowsByFunction(rows);

    expect(grouped.orchestrator.map((row) => row.id)).toEqual([
      'orchestrator:worker-1',
      'task:task-2',
    ]);
    expect(grouped.specialists.map((row) => row.id)).toEqual([
      'runtime:runtime-1',
      'task:task-3',
    ]);
  });
});
