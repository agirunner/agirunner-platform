import { describe, expect, it } from 'vitest';

import {
  describeActorPrimaryLabel,
  sortActorKindRecords,
} from './log-actor-presentation.js';
import { toActorItems } from './log-filters.support.js';

describe('log actor presentation', () => {
  it('uses only actor kinds present in the current filter values', () => {
    const items = toActorItems({
      data: [
        {
          actor_kind: 'specialist_agent',
        },
      ],
    });

    expect(items).toEqual([{ id: 'specialist_agent', label: 'Specialist Agent' }]);
  });

  it('sorts actor kinds in operator-facing order', () => {
    const sorted = sortActorKindRecords([
      { actor_kind: 'platform_system', actor_id: null, actor_name: null, count: 2 },
      { actor_kind: 'operator', actor_id: null, actor_name: null, count: 9 },
      { actor_kind: 'specialist_task_execution', actor_id: null, actor_name: null, count: 4 },
      { actor_kind: 'specialist_agent', actor_id: null, actor_name: null, count: 5 },
      { actor_kind: 'orchestrator_agent', actor_id: null, actor_name: null, count: 3 },
    ]);

    expect(sorted.map((item) => item.actor_kind)).toEqual([
      'orchestrator_agent',
      'specialist_agent',
      'specialist_task_execution',
      'operator',
      'platform_system',
    ]);
  });

  it('uses the canonical actor kind label directly', () => {
    expect(
      describeActorPrimaryLabel({ actor_kind: 'operator', actor_id: null, actor_name: null }),
    ).toBe('Operator');
    expect(
      describeActorPrimaryLabel({
        actor_kind: 'orchestrator_agent',
        actor_id: null,
        actor_name: null,
      }),
    ).toBe(
      'Orchestrator agent',
    );
  });
});
