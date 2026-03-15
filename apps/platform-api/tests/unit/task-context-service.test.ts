import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/document-reference-service.js', () => ({
  listTaskDocuments: vi.fn(async () => []),
}));

vi.mock('../../src/services/orchestrator-task-context.js', () => ({
  buildOrchestratorTaskContext: vi.fn(async () => null),
}));

import { buildTaskContext } from '../../src/services/task-context-service.js';

describe('buildTaskContext active stage semantics', () => {
  it('keeps continuous workflow active stages work-item driven', async () => {
    const queries: string[] = [];
    const db = {
      query: vi.fn(async (sql: string) => {
        queries.push(sql);
        if (sql.includes('FROM workflows p')) {
          return {
            rows: [{
              id: 'workflow-1',
              name: 'Continuous workflow',
              lifecycle: 'ongoing',
              context: {},
              git_branch: 'main',
              parameters: {},
              resolved_config: {},
              instruction_config: {},
              metadata: {},
              playbook_id: 'playbook-1',
              playbook_name: 'Continuous playbook',
              playbook_outcome: 'Ship changes',
              playbook_definition: {
                lifecycle: 'ongoing',
                stages: [
                  { name: 'build', goal: 'Build changes' },
                  { name: 'review', goal: 'Review changes' },
                ],
              },
              project_spec_version: null,
            }],
          };
        }
        if (sql.includes('SELECT DISTINCT wi.stage_name')) {
          return { rows: [{ stage_name: 'build' }] };
        }
        return { rows: [] };
      }),
    };

    const context = await buildTaskContext(db as never, 'tenant-1', {
      id: 'task-1',
      workflow_id: 'workflow-1',
      depends_on: [],
    });

    expect((context.workflow as Record<string, unknown>).active_stages).toEqual(['build']);
    expect(context.workflow).not.toHaveProperty('current_stage');
    expect(
      queries.some(
        (sql) => sql.includes('FROM workflow_stages') && sql.includes('ORDER BY position ASC'),
      ),
    ).toBe(false);
  });

  it('keeps standard workflow current stage and gate-aware active stages', async () => {
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM workflows p')) {
          return {
            rows: [{
              id: 'workflow-2',
              name: 'Standard workflow',
              lifecycle: 'planned',
              context: {},
              git_branch: 'release',
              parameters: {},
              resolved_config: {},
              instruction_config: {},
              metadata: {},
              playbook_id: 'playbook-2',
              playbook_name: 'Standard playbook',
              playbook_outcome: 'Ship milestone',
              playbook_definition: {
                lifecycle: 'planned',
                stages: [
                  { name: 'design', goal: 'Design work' },
                  { name: 'review', goal: 'Review work' },
                ],
              },
              project_spec_version: null,
            }],
          };
        }
        if (sql.includes('SELECT DISTINCT stage_name')) {
          return { rows: [{ stage_name: 'review' }] };
        }
        if (sql.includes('FROM workflow_stages') && sql.includes('ORDER BY position ASC')) {
          return {
            rows: [
              {
                id: 'stage-1',
                name: 'design',
                position: 0,
                goal: 'Design work',
                guidance: null,
                human_gate: false,
                status: 'completed',
                is_active: false,
                gate_status: 'not_requested',
                iteration_count: 0,
                summary: null,
                started_at: null,
                completed_at: null,
                open_work_item_count: 0,
                total_work_item_count: 0,
              },
              {
                id: 'stage-2',
                name: 'review',
                position: 1,
                goal: 'Review work',
                guidance: null,
                human_gate: true,
                status: 'active',
                is_active: true,
                gate_status: 'awaiting_approval',
                iteration_count: 0,
                summary: null,
                started_at: null,
                completed_at: null,
                open_work_item_count: 0,
                total_work_item_count: 0,
              },
            ],
          };
        }
        return { rows: [] };
      }),
    };

    const context = await buildTaskContext(db as never, 'tenant-1', {
      id: 'task-2',
      workflow_id: 'workflow-2',
      depends_on: [],
    });

    expect((context.workflow as Record<string, unknown>).active_stages).toEqual(['review']);
    expect((context.workflow as Record<string, unknown>).current_stage).toBe('review');
  });

  it('injects checkpoint-driven workflow context for specialist tasks', async () => {
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM workflows p')) {
          return {
            rows: [{
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
                checkpoints: [
                  { name: 'implementation', goal: 'Implement the requested change', human_gate: false },
                  { name: 'verification', goal: 'Verify the change', human_gate: true },
                ],
                review_rules: [{ from_role: 'developer', reviewed_by: 'reviewer', required: true }],
                handoff_rules: [{ from_role: 'developer', to_role: 'reviewer', required: true }],
              },
              project_spec_version: null,
            }],
          };
        }
        if (sql.includes('SELECT DISTINCT stage_name')) {
          return { rows: [{ stage_name: 'implementation' }] };
        }
        if (sql.includes('FROM workflow_stages') && sql.includes('ORDER BY position ASC')) {
          return {
            rows: [{
              id: 'stage-1',
              name: 'implementation',
              position: 0,
              goal: 'Implement the requested change',
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
            }],
          };
        }
        if (sql.includes('FROM workflow_work_items') && sql.includes('AND id = $2')) {
          return {
            rows: [{
              id: 'wi-1',
              stage_name: 'implementation',
              current_checkpoint: 'implementation',
              column_id: 'review',
              title: 'Implement auth',
              goal: 'Ship the auth change',
              acceptance_criteria: [],
              owner_role: 'developer',
              next_expected_actor: 'reviewer',
              next_expected_action: 'review',
              rework_count: 1,
              latest_handoff_completion: 'partial',
              unresolved_findings: ['Investigate auth edge cases'],
              review_focus: ['Auth edge cases'],
              known_risks: ['Refresh token expiry handling'],
              priority: 2,
              notes: null,
            }],
          };
        }
        if (sql.includes('FROM task_handoffs')) {
          return {
            rows: [{
              id: 'handoff-1',
              summary: 'Implementation is ready for review.',
              completion: 'partial',
              changes: [{ path: 'src/auth.ts', summary: 'Refined token refresh handling' }],
              decisions: ['Keep refresh token rotation server-side'],
              remaining_items: ['Validate refresh expiry edge case'],
              blockers: ['Waiting on production token sample'],
              artifact_ids: ['artifact-1'],
              review_focus: ['Auth edge cases'],
              known_risks: ['Refresh token expiry handling'],
              successor_context: 'Focus on auth edge cases.',
              role: 'developer',
              stage_name: 'implementation',
              role_data: { module: 'auth' },
              created_at: new Date('2026-03-15T00:00:00Z'),
            }],
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
      role_config: { system_prompt: 'Role prompt' },
      input: { instructions: 'Review the implementation.' },
    });

    const workflowLayer = ((context.instruction_layers as Record<string, any>).workflow ??
      {}) as Record<string, any>;
    expect(workflowLayer.content).toContain('## Workflow Mode: planned');
    expect(workflowLayer.content).toContain('## Process Instructions');
    expect(workflowLayer.content).toContain('Developer implements, reviewer reviews');
    expect(workflowLayer.content).toContain('## Current Checkpoint');
    expect(workflowLayer.content).toContain('implementation');
    expect(workflowLayer.content).toContain('## Board Position');
    expect(workflowLayer.content).toContain('## Board Position\nLane: In Review');
    expect(workflowLayer.content).toContain('## Review Expectations');
    expect(workflowLayer.content).toContain('Review required from reviewer');
    expect(workflowLayer.content).toContain('reviewer should review the current output before completion.');
    expect(workflowLayer.content).toContain('## Output Protocol');
    expect(workflowLayer.content).toContain('Commit and push');
    expect(workflowLayer.content).toContain('## Predecessor Context');
    expect(workflowLayer.content).toContain('Implementation is ready for review.');
    expect((context.task as Record<string, unknown>).work_item).toEqual(
      expect.objectContaining({
        latest_handoff_completion: 'partial',
        unresolved_findings: ['Investigate auth edge cases'],
        review_focus: ['Auth edge cases'],
        known_risks: ['Refresh token expiry handling'],
      }),
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
  });

  it('injects board-driven workflow context when no checkpoints are defined', async () => {
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM workflows p')) {
          return {
            rows: [{
              id: 'workflow-4',
              name: 'Ongoing workflow',
              lifecycle: 'ongoing',
              context: {},
              git_branch: null,
              parameters: {},
              resolved_config: {},
              instruction_config: {},
              metadata: {},
              playbook_id: 'playbook-4',
              playbook_name: 'Ops queue',
              playbook_outcome: 'Keep queue moving',
              playbook_definition: {
                lifecycle: 'ongoing',
                process_instructions: 'Triage incoming work and keep the queue moving.',
                board: {
                  entry_column_id: 'inbox',
                  columns: [
                    { id: 'inbox', label: 'Inbox' },
                    { id: 'active', label: 'Active' },
                    { id: 'done', label: 'Done', is_terminal: true },
                  ],
                },
                checkpoints: [],
                stages: [],
              },
              project_spec_version: null,
            }],
          };
        }
        if (sql.includes('SELECT DISTINCT wi.stage_name')) {
          return { rows: [] };
        }
        if (sql.includes('FROM workflow_work_items') && sql.includes('AND id = $2')) {
          return {
            rows: [{
              id: 'wi-2',
              stage_name: null,
              current_checkpoint: null,
              column_id: 'active',
              title: 'Investigate alert',
              goal: 'Clear the incident',
              acceptance_criteria: [],
              owner_role: 'developer',
              next_expected_actor: null,
              next_expected_action: null,
              rework_count: 0,
              priority: 1,
              notes: null,
            }],
          };
        }
        return { rows: [] };
      }),
    };

    const context = await buildTaskContext(db as never, 'tenant-1', {
      id: 'task-4',
      workflow_id: 'workflow-4',
      work_item_id: 'wi-2',
      role: 'developer',
      is_orchestrator_task: false,
      depends_on: [],
      role_config: { system_prompt: 'Role prompt' },
      input: { instructions: 'Investigate the incident.' },
    });

    const workflowLayer = ((context.instruction_layers as Record<string, any>).workflow ??
      {}) as Record<string, any>;
    expect(workflowLayer.content).toContain('## Workflow Mode: ongoing');
    expect(workflowLayer.content).toContain('## Progress Model');
    expect(workflowLayer.content).toContain('Board-driven');
    expect(workflowLayer.content).toContain('Use board lane posture');
    expect(workflowLayer.content).toContain('## Board Position\nLane: Active');
    expect(workflowLayer.content).toContain('Upload required artifacts before completion or escalation');
  });
});
