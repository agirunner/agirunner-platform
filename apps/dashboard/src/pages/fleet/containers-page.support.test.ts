import { describe, expect, it } from 'vitest';

import {
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
    activity_state: 'in_progress',
    presence: 'running',
    inactive_at: null,
    ...overrides,
  };
}

describe('mergeLiveContainerSessionRows', () => {
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
      presence: 'inactive',
      inactive_at: '2026-03-21T18:31:00.000Z',
      cpu_limit: '1',
      memory_limit: '768m',
      workflow_name: 'Fix login bug',
      task_title: 'Investigate auth timeout',
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
      presence: 'running',
      inactive_at: null,
    });
  });
});
