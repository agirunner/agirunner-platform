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
  it('redacts secret-like predecessor handoff content before attaching task context', async () => {
    const db = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM workflows p')) {
          return {
            rows: [
              {
                id: 'workflow-secret',
                name: 'Planned workflow',
                lifecycle: 'planned',
                context: {},
                git_branch: null,
                parameters: {},
                resolved_config: {},
                instruction_config: {},
                metadata: {},
                playbook_id: 'playbook-secret',
                playbook_name: 'SDLC',
                playbook_outcome: 'Ship a reviewed change',
                playbook_definition: {
                  lifecycle: 'planned',
                  process_instructions: 'Developer implements, reviewer reviews',
                  stages: [{ name: 'implementation', goal: 'Implement the work' }],
                  board: {
                    columns: [{ id: 'in_review', label: 'In Review', is_terminal: false }],
                    entry_column_id: 'in_review',
                  },
                },
                workspace_spec_version: null,
              },
            ],
          };
        }
        if (sql.includes('FROM workflow_work_items wi')) {
          return {
            rows: [
              {
                id: 'work-item-secret',
                workflow_id: 'workflow-secret',
                parent_work_item_id: null,
                title: 'Review authentication flow',
                summary: null,
                description: null,
                stage_name: 'implementation',

                current_lane: 'in_review',
                state: 'in_progress',
                assigned_role: 'reviewer',
                ownership_mode: 'single',
                metadata: {},
                latest_handoff_completion: 'partial',
                focus_areas: ['sk-review-focus'],
                known_risks: ['Bearer risk-secret'],
                unresolved_findings: [],
                active_task_count: 1,
                open_task_count: 1,
                completed_task_count: 0,
                created_at: new Date('2026-03-17T12:00:00Z'),
                updated_at: new Date('2026-03-17T12:00:00Z'),
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
                id: 'stage-secret',
                name: 'implementation',
                position: 0,
                goal: 'Implement the work',
                guidance: null,
                human_gate: false,
                status: 'active',
                is_active: true,
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
        if (
          sql.includes('FROM task_handoffs') &&
          sql.includes('AND work_item_id = $3') &&
          Array.isArray(params) &&
          params[2] === 'work-item-secret'
        ) {
          return {
            rows: [
              {
                id: 'handoff-secret',
                workflow_id: 'workflow-secret',
                work_item_id: 'work-item-secret',
                task_id: 'task-developer',
                role: 'developer',
                stage_name: 'implementation',
                sequence: 2,
                summary: 'sk-handoff-secret',
                completion: 'partial',
                changes: [{ api_key: 'sk-handoff-secret' }],
                decisions: [{ authorization: 'Bearer handoff-secret' }],
                remaining_items: ['sk-handoff-secret'],
                blockers: [{ token: 'sk-handoff-secret' }],
                focus_areas: ['sk-handoff-secret'],
                known_risks: ['Bearer handoff-secret'],
                successor_context: 'Bearer handoff-secret',
                role_data: { api_key: 'sk-handoff-secret' },
                artifact_ids: ['artifact-secret'],
                created_at: new Date('2026-03-17T12:00:00Z'),
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('FROM task_handoffs') && sql.includes('ORDER BY created_at DESC')) {
          return {
            rows: [
              {
                id: 'handoff-secret',
                workflow_id: 'workflow-secret',
                work_item_id: 'work-item-secret',
                task_id: 'task-developer',
                role: 'developer',
                stage_name: 'implementation',
                sequence: 2,
                summary: 'sk-handoff-secret',
                completion: 'partial',
                changes: [{ api_key: 'sk-handoff-secret' }],
                decisions: [],
                remaining_items: [],
                blockers: [],
                focus_areas: [],
                known_risks: [],
                successor_context: 'Bearer handoff-secret',
                role_data: { api_key: 'sk-handoff-secret' },
                artifact_ids: ['artifact-secret'],
                created_at: new Date('2026-03-17T12:00:00Z'),
              },
            ],
          };
        }
        return { rows: [] };
      }),
    };

    const context = await buildTaskContext(db as never, 'tenant-1', {
      id: 'task-reviewer-secret',
      workflow_id: 'workflow-secret',
      work_item_id: 'work-item-secret',
      stage_name: 'implementation',
      role: 'reviewer',
      is_orchestrator_task: false,
      depends_on: [],
      role_config: { system_prompt: 'Role prompt' },
      input: { instructions: 'Review the implementation.' },
    });

    expect((context.task as Record<string, unknown>).predecessor_handoff).toEqual(
      expect.objectContaining({
        id: 'handoff-secret',
        summary: 'redacted://task-context-secret',
        changes: [{ api_key: 'redacted://task-context-secret' }],
        decisions: [{ authorization: 'redacted://task-context-secret' }],
        remaining_items: ['redacted://task-context-secret'],
        blockers: [{ token: 'redacted://task-context-secret' }],
        focus_areas: ['redacted://task-context-secret'],
        known_risks: ['redacted://task-context-secret'],
        successor_context: 'redacted://task-context-secret',
        role_data: { api_key: 'redacted://task-context-secret' },
      }),
    );
    expect((context.task as Record<string, unknown>).recent_handoffs).toEqual([
      expect.objectContaining({
        id: 'handoff-secret',
        summary: 'redacted://task-context-secret',
        successor_context: 'redacted://task-context-secret',
      }),
    ]);
  });

});
