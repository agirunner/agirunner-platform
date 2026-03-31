import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/services/document-reference-service.js', () => ({
  listTaskDocuments: vi.fn(async () => []),
}));

vi.mock('../../../src/services/orchestrator-task-context.js', () => ({
  buildOrchestratorTaskContext: vi.fn(async () => null),
}));

import {
  buildTaskContext,
  summarizeTaskContextAttachments,
} from '../../../src/services/task-context-service.js';

describe('buildTaskContext active stage semantics', () => {
  it('derives predecessor handoff and work item context for orchestrator tasks from activation events', async () => {
    const db = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM workflows p')) {
          return {
            rows: [
              {
                id: 'workflow-activation',
                name: 'Activation workflow',
                lifecycle: 'planned',
                context: {},
                git_branch: 'main',
                parameters: {},
                resolved_config: {},
                instruction_config: {},
                metadata: {},
                playbook_id: 'playbook-activation',
                playbook_name: 'SDLC',
                playbook_outcome: 'Ship a reviewed change',
                playbook_definition: {
                  lifecycle: 'planned',
                  stages: [
                    { name: 'design', goal: 'Produce a technical design' },
                    { name: 'implementation', goal: 'Build the approved design' },
                  ],
                },
                workspace_spec_version: null,
              },
            ],
          };
        }
        if (sql.includes('SELECT DISTINCT wi.stage_name')) {
          return { rows: [{ stage_name: 'implementation' }] };
        }
        if (sql.includes('FROM workflow_stages') && sql.includes('ORDER BY ws.position ASC')) {
          return {
            rows: [
              {
                id: 'stage-implementation',
                name: 'implementation',
                position: 1,
                goal: 'Build the approved design',
                guidance: null,
                human_gate: false,
                status: 'active',
                gate_status: 'not_requested',
                iteration_count: 0,
                summary: null,
                started_at: null,
                completed_at: null,
                open_work_item_count: 1,
                total_work_item_count: 1,
              },
            ],
          };
        }
        if (sql.includes('FROM workflow_work_items') && sql.includes('AND id = $2')) {
          expect(params?.[1]).toBe('wi-design');
          return {
            rows: [
              {
                id: 'wi-design',
                stage_name: 'design',
                column_id: 'active',
                title: 'Design hello world',
                goal: 'Produce the design for hello world',
                acceptance_criteria: [],
                owner_role: 'architect',
                next_expected_actor: 'developer',
                next_expected_action: 'implement',
                rework_count: 0,
                latest_handoff_completion: 'complete',
                unresolved_findings: [],
                focus_areas: ['Preserve the approved design contract'],
                known_risks: ['Implementation drift'],
                priority: 1,
                notes: null,
              },
            ],
          };
        }
        if (
          sql.includes('FROM task_handoffs') &&
          sql.includes('AND work_item_id = $3') &&
          Array.isArray(params)
        ) {
          expect(params[2]).toBe('wi-design');
          return {
            rows: [
              {
                id: 'handoff-design-1',
                workflow_id: 'workflow-activation',
                work_item_id: 'wi-design',
                task_id: 'task-architect-1',
                role: 'architect',
                stage_name: 'design',
                sequence: 1,
                summary: 'Technical design is approved and ready for implementation.',
                completion: 'complete',
                changes: [
                  { path: 'docs/design.md', summary: 'Added approved implementation plan' },
                ],
                decisions: ['Use the approved service boundary'],
                remaining_items: [],
                blockers: [],
                focus_areas: ['Validate implementation against the design'],
                known_risks: ['Implementation drift'],
                successor_context: 'Create the implementation work item from this design.',
                role_data: { document: 'docs/design.md' },
                artifact_ids: ['artifact-design-1'],
                created_at: new Date('2026-03-18T00:00:00Z'),
              },
            ],
          };
        }
        return { rows: [] };
      }),
    };

    const context = await buildTaskContext(db as never, 'tenant-1', {
      id: 'task-orchestrator-1',
      workflow_id: 'workflow-activation',
      is_orchestrator_task: true,
      depends_on: [],
      input: {
        activation_reason: 'queued_events',
        events: [
          {
            type: 'task.handoff_submitted',
            reason: 'task.handoff_submitted',
            work_item_id: 'wi-design',
            stage_name: 'design',
            payload: {
              task_id: 'task-architect-1',
              work_item_id: 'wi-design',
              stage_name: 'design',
            },
          },
        ],
      },
    });

    expect((context.task as Record<string, unknown>).context_anchor).toEqual({
      source: 'activation_event',
      event_type: 'task.handoff_submitted',
      work_item_id: 'wi-design',
      stage_name: 'design',
      triggering_task_id: 'task-architect-1',
    });
    expect((context.task as Record<string, unknown>).work_item).toEqual(
      expect.objectContaining({
        id: 'wi-design',
        stage_name: 'design',
      }),
    );
    expect((context.task as Record<string, unknown>).predecessor_handoff).toEqual(
      expect.objectContaining({
        id: 'handoff-design-1',
        work_item_id: 'wi-design',
        task_id: 'task-architect-1',
        role: 'architect',
      }),
    );
    expect((context.task as Record<string, unknown>).predecessor_handoff_resolution).toEqual(
      expect.objectContaining({
        source: 'local_work_item',
        source_work_item_id: 'wi-design',
      }),
    );
  });

});
