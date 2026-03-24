import { describe, expect, it } from 'vitest';

import type { DashboardPlaybookRecord } from '../../lib/api.js';
import {
  buildPlaybookRevisionChain,
  buildPlaybookRevisionDiff,
  renderPlaybookSnapshot,
  summarizePlaybookControls,
} from './playbook-detail-support.js';

describe('playbook detail support', () => {
  it('sorts revisions newest first for the same slug', () => {
    const current = createPlaybook(3);
    const revisions = buildPlaybookRevisionChain(
      [createPlaybook(1), createPlaybook(2), current, createPlaybook(5, { slug: 'other' })],
      current,
    );

    expect(revisions.map((revision) => revision.version)).toEqual([3, 2, 1]);
  });

  it('builds structured revision diff rows for changed playbook controls', () => {
    const current = createPlaybook(3, {
      definition: {
        orchestrator: {
          max_active_tasks: 6,
          max_active_tasks_per_work_item: 2,
          allow_parallel_work_items: true,
        },
      },
    });
    const compared = createPlaybook(2, {
      description: 'Older description',
      definition: {
        orchestrator: {
          max_active_tasks: 2,
          max_active_tasks_per_work_item: 1,
          allow_parallel_work_items: false,
        },
      },
    });

    const diff = buildPlaybookRevisionDiff(current, compared);

    expect(diff.find((row) => row.label === 'Parallelism policy')).toMatchObject({
      changed: true,
    });
  });

  it('renders restore payloads and complete normalized snapshots', () => {
    const playbook = createPlaybook(4, {
      description: 'Automates delivery',
      definition: {
        roles: ['developer', 'reviewer'],
        board: {
          entry_column_id: 'active',
          columns: [
            { id: 'inbox', label: 'Inbox' },
            { id: 'active', label: 'Active', description: 'Work in progress' },
          ],
        },
        stages: [
          {
            name: 'delivery',
            goal: 'Ship the change',
            guidance: 'Require a final human check',
          },
        ],
        parameters: [
          {
            name: 'goal',
            type: 'string',
            category: 'input',
          },
        ],
      },
    });

    const summary = summarizePlaybookControls(playbook);
    const snapshot = renderPlaybookSnapshot(playbook);

    expect(summary.roles).toContain('developer');
    expect(summary.stages).toContain('delivery');
    expect(snapshot).toContain('"slug": "delivery-playbook"');
    expect(snapshot).toContain('"entry_column_id": "active"');
    expect(snapshot).toContain('"guidance": "Require a final human check"');
  });

  it('summarizes stages instead of deleted governance rules', () => {
    const playbook = createPlaybook(4, {
      definition: {
        stages: [
          {
            name: 'triage',
            goal: 'Clarify the request',
          },
          {
            name: 'delivery',
            goal: 'Ship the change',
          },
        ],
      },
    });

    const summary = summarizePlaybookControls(playbook);
    expect(summary.stages).toContain('triage');
    expect(summary.stages).toContain('delivery');
  });
});

function createPlaybook(
  version: number,
  overrides: Partial<DashboardPlaybookRecord> & {
    definition?: Record<string, unknown>;
  } = {},
): DashboardPlaybookRecord {
  const baseDefinition: Record<string, unknown> = {
    roles: ['developer'],
    board: {
      columns: [
        { id: 'inbox', label: 'Inbox' },
        { id: 'done', label: 'Done', is_terminal: true },
      ],
    },
    stages: [{ name: 'delivery', goal: 'Ship the change' }],
    lifecycle: 'ongoing',
    orchestrator: {
      max_rework_iterations: 5,
      max_active_tasks: 4,
      max_active_tasks_per_work_item: 2,
      allow_parallel_work_items: true,
    },
    parameters: [{ name: 'goal', type: 'string', required: true }],
  };

  return {
    id: `playbook-${version}`,
    name: `Delivery Playbook`,
    slug: 'delivery-playbook',
    description: 'Current description',
    outcome: 'Ship production-ready changes',
    lifecycle: 'ongoing',
    version,
    definition: mergeDefinition(baseDefinition, overrides.definition),
    created_at: '2026-03-10T12:00:00Z',
    updated_at: `2026-03-1${version}T12:00:00Z`,
    ...overrides,
  };
}

function mergeDefinition(
  base: Record<string, unknown>,
  overrides?: Record<string, unknown>,
): Record<string, unknown> {
  if (!overrides) {
    return base;
  }
  return {
    ...base,
    ...overrides,
    board: {
      ...(base.board as Record<string, unknown>),
      ...((overrides.board as Record<string, unknown> | undefined) ?? {}),
    },
    orchestrator: {
      ...(base.orchestrator as Record<string, unknown>),
      ...((overrides.orchestrator as Record<string, unknown> | undefined) ?? {}),
    },
  };
}
