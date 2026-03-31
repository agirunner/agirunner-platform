import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/services/document-reference/document-reference-service.js', () => ({
  listTaskDocuments: vi.fn(async () => []),
}));

vi.mock('../../../src/services/orchestrator-task-context/orchestrator-task-context.js', () => ({
  buildOrchestratorTaskContext: vi.fn(async () => null),
}));

import {
  buildTaskContext,
  summarizeTaskContextAttachments,
} from '../../../src/services/task-context-service/task-context-service.js';

describe('buildTaskContext active stage semantics', () => {
  it('injects stage-driven workflow context for specialist tasks', async () => {
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM workflows p')) {
          return {
            rows: [
              {
                id: 'workflow-3',
                name: 'Planned workflow',
                lifecycle: 'planned',
                context: {},
                git_branch: 'main',
                parameters: { repository_url: 'https://github.com/agirunner/example.git' },
                resolved_config: {},
                instruction_config: {},
                metadata: {},
                playbook_id: 'playbook-3',
                playbook_name: 'Planned playbook',
                playbook_outcome: 'Ship reviewed change',
                playbook_definition: {
                  lifecycle: 'planned',
                  process_instructions:
                    'Developer implements, reviewer reviews, and QA validates before completion.',
                  board: {
                    entry_column_id: 'active',
                    columns: [
                      { id: 'active', label: 'Active' },
                      { id: 'review', label: 'In Review' },
                      { id: 'done', label: 'Done', is_terminal: true },
                    ],
                  },
                  stages: [
                    { name: 'implementation', goal: 'Implement the requested change' },
                    { name: 'verification', goal: 'Verify the change' },
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
                id: 'stage-1',
                name: 'implementation',
                position: 0,
                goal: 'Implement the requested change',
                guidance: null,
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
        if (sql.includes('FROM workflow_work_items') && sql.includes('AND id = $2')) {
          return {
            rows: [
              {
                id: 'wi-1',
                stage_name: 'implementation',

                column_id: 'review',
                title: 'Implement auth',
                goal: 'Ship the auth change',
                acceptance_criteria: [],
                owner_role: 'developer',
                next_expected_actor: 'reviewer',
                next_expected_action: 'assess',
                rework_count: 1,
                latest_handoff_completion: 'partial',
                unresolved_findings: ['Investigate auth edge cases'],
                focus_areas: ['Auth edge cases'],
                known_risks: ['Refresh token expiry handling'],
                priority: 2,
                notes: null,
              },
            ],
          };
        }
        if (sql.includes('FROM task_handoffs')) {
          return {
            rows: [
              {
                id: 'handoff-1',
                summary: 'Implementation is ready for review.',
                completion: 'partial',
                changes: [{ path: 'src/auth.ts', summary: 'Refined token refresh handling' }],
                decisions: ['Keep refresh token rotation server-side'],
                remaining_items: ['Validate refresh expiry edge case'],
                blockers: ['Waiting on production token sample'],
                artifact_ids: ['artifact-1'],
                focus_areas: ['Auth edge cases'],
                known_risks: ['Refresh token expiry handling'],
                successor_context: 'Focus on auth edge cases.',
                role: 'developer',
                stage_name: 'implementation',
                role_data: { module: 'auth' },
                created_at: new Date('2026-03-15T00:00:00Z'),
              },
            ],
          };
        }
        return { rows: [] };
      }),
    };

    const context = await buildTaskContext(db as never, 'tenant-1', {
      id: 'task-3',
      workflow_id: 'workflow-3',
      work_item_id: 'wi-1',
      role: 'reviewer',
      is_orchestrator_task: false,
      depends_on: [],
      role_config: {
        system_prompt: 'Role prompt',
        tools: ['file_read', 'git_diff', 'submit_handoff'],
      },
      input: { instructions: 'Review the implementation.' },
    });

    const workflowLayer = ((context.instruction_layers as Record<string, any>).workflow ??
      {}) as Record<string, any>;
    expect(workflowLayer.content).toContain('## Workflow Mode: planned');
    expect(workflowLayer.content).toContain('## Process Instructions');
    expect(workflowLayer.content).toContain('Developer implements, reviewer reviews');
    expect(workflowLayer.content).toContain('## Output Protocol');
    expect(workflowLayer.content).toContain(
      'commit and push required changes before completion or escalation',
    );
    expect(workflowLayer.content).not.toContain('## Current Stage');
    expect(workflowLayer.content).not.toContain('## Board Position');
    expect(workflowLayer.content).not.toContain('## Review Expectations');
    expect(workflowLayer.content).not.toContain('## Predecessor Context');
    const executionBrief = (context as Record<string, any>).execution_brief;
    expect(executionBrief).toEqual(
      expect.objectContaining({
        refresh_key: expect.stringMatching(/^[a-f0-9]{64}$/),
        current_focus: expect.objectContaining({
          stage_name: 'implementation',
          board_position: 'In Review',
        }),
        predecessor_handoff_summary: expect.objectContaining({
          summary: 'Implementation is ready for review.',
        }),
      }),
    );
    expect(executionBrief.rendered_markdown).toContain('## Workflow Brief');
    expect(executionBrief.rendered_markdown).toContain('## Current Focus');
    expect(executionBrief.rendered_markdown).toContain('## Predecessor Context');
    expect((context.task as Record<string, unknown>).work_item).toEqual(
      expect.objectContaining({
        stage_name: 'implementation',
        latest_handoff_completion: 'partial',
        unresolved_findings: ['Investigate auth edge cases'],
        focus_areas: ['Auth edge cases'],
        known_risks: ['Refresh token expiry handling'],
      }),
    );
    expect((context.task as Record<string, any>).work_item).not.toHaveProperty(
      'current_checkpoint',
    );
    expect((context.task as Record<string, unknown>).predecessor_handoff).toEqual(
      expect.objectContaining({
        id: 'handoff-1',
        completion: 'partial',
        changes: [{ path: 'src/auth.ts', summary: 'Refined token refresh handling' }],
        decisions: ['Keep refresh token rotation server-side'],
        remaining_items: ['Validate refresh expiry edge case'],
        blockers: ['Waiting on production token sample'],
        artifact_ids: ['artifact-1'],
        summary: 'Implementation is ready for review.',
        successor_context: 'Focus on auth edge cases.',
        role: 'developer',
        stage_name: 'implementation',
        role_data: { module: 'auth' },
      }),
    );
    expect((context.task as Record<string, unknown>).recent_handoffs).toEqual([
      expect.objectContaining({
        id: 'handoff-1',
        role: 'developer',
        summary: 'Implementation is ready for review.',
      }),
    ]);
  });

});
