import { describe, expect, it } from 'vitest';

import {
  describeActorPrimaryLabel,
  sortActorKindRecords,
} from './log-actor-presentation.js';
import { toActorItems } from './log-filters.support.js';

describe('log actor presentation', () => {
  it('always includes operator and container-style actor kinds in filter items', () => {
    const items = toActorItems({
      data: [
        {
          actor_kind: 'specialist_agent',
          actor_id: null,
          actor_name: null,
          count: 12,
          latest_role: 'developer',
          latest_workflow_id: 'wf-1',
          latest_workflow_name: 'Customer migration',
          latest_workflow_label: 'Customer migration',
        },
      ],
    });

    expect(items.map((item) => item.id)).toEqual([
      'orchestrator_agent',
      'specialist_agent',
      'specialist_task_execution',
      'operator',
      'platform_system',
    ]);
    expect(items.map((item) => item.label)).toEqual([
      'Orchestrator agent',
      'Specialist agent',
      'Specialist task execution',
      'Operator',
      'System',
    ]);
  });

  it('sorts actor kinds in operator-facing order', () => {
    const sorted = sortActorKindRecords([
      { actor_kind: 'platform_system', count: 2 },
      { actor_kind: 'operator', count: 9 },
      { actor_kind: 'specialist_task_execution', count: 4 },
      { actor_kind: 'specialist_agent', count: 5 },
      { actor_kind: 'orchestrator_agent', count: 3 },
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
    expect(describeActorPrimaryLabel({ actor_kind: 'operator' })).toBe('Operator');
    expect(describeActorPrimaryLabel({ actor_kind: 'orchestrator_agent' })).toBe(
      'Orchestrator agent',
    );
  });
});
