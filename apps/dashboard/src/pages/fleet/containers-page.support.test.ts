import { describe, expect, it } from 'vitest';

import {
  advanceSessionContainerRows,
  hasPendingField,
  hasRecentlyChangedField,
  isRecentlyChangedRow,
  isPendingChangeRow,
  mergeLiveContainerSessionRows,
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
    image: 'agirunner-runtime-execution:local',
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
});
