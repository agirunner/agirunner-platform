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
        (sql) => sql.includes('FROM workflow_stages') && sql.includes('ORDER BY ws.position ASC'),
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
        if (sql.includes('FROM workflow_stages') && sql.includes('ORDER BY ws.position ASC')) {
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

  it('derives standard workflow current stage from open work items instead of stale stored stage status', async () => {
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM workflows p')) {
          return {
            rows: [{
              id: 'workflow-derivation',
              name: 'Derived workflow',
              lifecycle: 'planned',
              context: {},
              git_branch: 'main',
              parameters: {},
              resolved_config: {},
              instruction_config: {},
              metadata: {},
              playbook_id: 'playbook-derived',
              playbook_name: 'Derived playbook',
              playbook_outcome: 'Deliver the change',
              playbook_definition: {
                lifecycle: 'planned',
                checkpoints: [
                  { name: 'design', goal: 'Design the work' },
                  { name: 'implementation', goal: 'Build the work' },
                ],
              },
              project_spec_version: null,
            }],
          };
        }
        if (sql.includes('SELECT DISTINCT stage_name')) {
          return { rows: [{ stage_name: 'implementation' }] };
        }
        if (sql.includes('JOIN workflows w') && sql.includes('ORDER BY ws.position ASC')) {
          return {
            rows: [
              {
                id: 'stage-design',
                lifecycle: 'planned',
                name: 'design',
                position: 0,
                goal: 'Design the work',
                guidance: null,
                human_gate: false,
                status: 'active',
                gate_status: 'not_requested',
                iteration_count: 0,
                summary: null,
                started_at: null,
                completed_at: null,
                open_work_item_count: 0,
                total_work_item_count: 1,
                first_work_item_at: null,
                last_completed_work_item_at: new Date('2026-03-16T00:00:00Z'),
              },
              {
                id: 'stage-implementation',
                lifecycle: 'planned',
                name: 'implementation',
                position: 1,
                goal: 'Build the work',
                guidance: null,
                human_gate: false,
                status: 'pending',
                gate_status: 'not_requested',
                iteration_count: 0,
                summary: null,
                started_at: null,
                completed_at: null,
                open_work_item_count: 1,
                total_work_item_count: 1,
                first_work_item_at: new Date('2026-03-16T00:05:00Z'),
                last_completed_work_item_at: null,
              },
            ],
          };
        }
        return { rows: [] };
      }),
    };

    const context = await buildTaskContext(db as never, 'tenant-1', {
      id: 'task-derived',
      workflow_id: 'workflow-derivation',
      depends_on: [],
    });

    expect((context.workflow as Record<string, unknown>).active_stages).toEqual(['implementation']);
    expect((context.workflow as Record<string, unknown>).current_stage).toBe('implementation');
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
        if (sql.includes('FROM workflow_stages') && sql.includes('ORDER BY ws.position ASC')) {
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
              current_checkpoint: 'legacy-implementation',
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
        current_checkpoint: 'implementation',
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
    expect((context.task as Record<string, unknown>).recent_handoffs).toEqual([
      expect.objectContaining({
        id: 'handoff-1',
        role: 'developer',
        summary: 'Implementation is ready for review.',
      }),
    ]);
  });

  it('returns no predecessor handoff when a new work item has no local or linked predecessor history', async () => {
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM workflows p')) {
          return {
            rows: [{
              id: 'workflow-5',
              name: 'Planned workflow',
              lifecycle: 'planned',
              context: {},
              git_branch: null,
              parameters: {},
              resolved_config: {},
              instruction_config: {},
              metadata: {},
              playbook_id: 'playbook-5',
              playbook_name: 'SDLC',
              playbook_outcome: 'Ship a reviewed change',
              playbook_definition: {
                lifecycle: 'planned',
                process_instructions: 'Product defines requirements, architect designs, developer implements, reviewer reviews, QA validates.',
                board: {
                  entry_column_id: 'planned',
                  columns: [
                    { id: 'planned', label: 'Planned' },
                    { id: 'active', label: 'Active' },
                    { id: 'done', label: 'Done', is_terminal: true },
                  ],
                },
                checkpoints: [
                  { name: 'requirements', goal: 'Clarify requirements', human_gate: true },
                  { name: 'design', goal: 'Produce a technical design', human_gate: false },
                ],
                handoff_rules: [{ from_role: 'product-manager', to_role: 'architect', required: true }],
              },
              project_spec_version: null,
            }],
          };
        }
        if (sql.includes('SELECT DISTINCT stage_name')) {
          return { rows: [{ stage_name: 'design' }] };
        }
        if (sql.includes('FROM workflow_stages') && sql.includes('ORDER BY ws.position ASC')) {
          return {
            rows: [{
              id: 'stage-1',
              name: 'design',
              position: 1,
              goal: 'Produce a technical design',
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
              id: 'wi-design',
              stage_name: 'design',
              current_checkpoint: 'design',
              column_id: 'active',
              title: 'Design hello world',
              goal: 'Produce the design for hello world',
              acceptance_criteria: [],
              owner_role: 'architect',
              next_expected_actor: 'architect',
              next_expected_action: 'design',
              rework_count: 0,
              latest_handoff_completion: null,
              unresolved_findings: [],
              review_focus: [],
              known_risks: [],
              priority: 1,
              notes: null,
            }],
          };
        }
        if (sql.includes('FROM task_handoffs') && sql.includes('AND work_item_id = $3')) {
          return { rows: [] };
        }
        return { rows: [] };
      }),
    };

    const context = await buildTaskContext(db as never, 'tenant-1', {
      id: 'task-architect-1',
      workflow_id: 'workflow-5',
      work_item_id: 'wi-design',
      role: 'architect',
      is_orchestrator_task: false,
      depends_on: [],
      role_config: { system_prompt: 'Role prompt' },
      input: { instructions: 'Create the design.' },
    });

    expect((context.task as Record<string, unknown>).predecessor_handoff).toBeNull();
    expect(((context.instruction_layers as Record<string, any>).workflow ?? {}).content).not.toContain(
      'Requirements approved for hello world.',
    );
  });

  it('prefers the parent-linked predecessor handoff over a later unrelated workflow handoff', async () => {
    const db = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM workflows p')) {
          return {
            rows: [{
              id: 'workflow-6',
              name: 'Planned workflow',
              lifecycle: 'planned',
              context: {},
              git_branch: 'release-branch',
              parameters: {},
              resolved_config: {},
              instruction_config: {},
              metadata: {},
              playbook_id: 'playbook-6',
              playbook_name: 'SDLC',
              playbook_outcome: 'Ship a reviewed change',
              playbook_definition: {
                lifecycle: 'planned',
                process_instructions: 'Developer implements, reviewer reviews, QA validates, product-manager confirms release readiness.',
                board: {
                  entry_column_id: 'planned',
                  columns: [
                    { id: 'planned', label: 'Planned' },
                    { id: 'active', label: 'Active' },
                    { id: 'done', label: 'Done', is_terminal: true },
                  ],
                },
                checkpoints: [
                  { name: 'verification', goal: 'Validate approved changes' },
                  { name: 'release', goal: 'Confirm release readiness', human_gate: true },
                ],
                handoff_rules: [{ from_role: 'qa', to_role: 'product-manager', required: true }],
              },
              project_spec_version: null,
            }],
          };
        }
        if (sql.includes('SELECT DISTINCT stage_name')) {
          return { rows: [{ stage_name: 'release' }] };
        }
        if (sql.includes('FROM workflow_stages') && sql.includes('ORDER BY ws.position ASC')) {
          return {
            rows: [{
              id: 'stage-release',
              name: 'release',
              position: 1,
              goal: 'Confirm release readiness',
              guidance: null,
              human_gate: true,
              status: 'active',
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
              id: 'wi-release',
              stage_name: 'release',
              current_checkpoint: 'release',
              column_id: 'active',
              title: 'Confirm release readiness',
              goal: 'Confirm release readiness',
              acceptance_criteria: [],
              owner_role: 'product-manager',
              next_expected_actor: 'product-manager',
              next_expected_action: 'release_assess',
              rework_count: 0,
              latest_handoff_completion: null,
              unresolved_findings: [],
              review_focus: [],
              known_risks: [],
              priority: 1,
              notes: null,
            }],
          };
        }
        if (
          sql.includes('FROM task_handoffs') &&
          sql.includes('AND work_item_id = $3') &&
          Array.isArray(params) &&
          params[2] === 'wi-release'
        ) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('COUNT(*)::int AS sibling_count')) {
          return {
            rows: [{ sibling_count: 1 }],
            rowCount: 1,
          };
        }
        if (sql.includes('FROM workflow_work_items') && sql.includes('parent_work_item_id')) {
          return {
            rows: [{ parent_work_item_id: 'wi-verification' }],
            rowCount: 1,
          };
        }
        if (
          sql.includes('FROM task_handoffs') &&
          sql.includes('AND work_item_id = $3') &&
          Array.isArray(params) &&
          params[2] === 'wi-verification'
        ) {
          return {
            rows: [{
              id: 'handoff-qa',
              task_id: 'task-qa-1',
              role: 'qa',
              stage_name: 'verification',
              summary: 'QA validated the approved branch successfully.',
              completion: 'full',
              changes: [],
              decisions: ['Release can proceed'],
              remaining_items: [],
              blockers: [],
              review_focus: ['Use this evidence for release approval'],
              known_risks: [],
              successor_context: 'Use the verified QA evidence as the release input.',
              role_data: { branch: 'release-branch' },
              artifact_ids: ['artifact-qa-1'],
              created_at: new Date('2026-03-16T02:00:00Z'),
            }],
            rowCount: 1,
          };
        }
        if (sql.includes('FROM task_handoffs') && sql.includes('ORDER BY created_at DESC')) {
          return {
            rows: [{
              id: 'handoff-unrelated',
              task_id: 'task-other-1',
              role: 'architect',
              stage_name: 'design',
              summary: 'Unrelated later workflow note.',
              completion: 'full',
              changes: [],
              decisions: [],
              remaining_items: [],
              blockers: [],
              review_focus: [],
              known_risks: [],
              successor_context: 'Ignore this for release.',
              role_data: {},
              artifact_ids: [],
              created_at: new Date('2026-03-16T03:00:00Z'),
            }],
            rowCount: 1,
          };
        }
        return { rows: [] };
      }),
    };

    const context = await buildTaskContext(db as never, 'tenant-1', {
      id: 'task-release-1',
      workflow_id: 'workflow-6',
      work_item_id: 'wi-release',
      role: 'product-manager',
      is_orchestrator_task: false,
      depends_on: [],
      role_config: { system_prompt: 'Role prompt' },
      input: { instructions: 'Confirm release readiness.' },
    });

    expect((context.task as Record<string, unknown>).predecessor_handoff).toEqual(
      expect.objectContaining({
        id: 'handoff-qa',
        role: 'qa',
        summary: 'QA validated the approved branch successfully.',
        successor_context: 'Use the verified QA evidence as the release input.',
      }),
    );
    expect((context.task as Record<string, unknown>).predecessor_handoff_resolution).toEqual(
      expect.objectContaining({
        source: 'parent_work_item',
        source_work_item_id: 'wi-verification',
        parent_work_item_id: 'wi-verification',
        sibling_count: 1,
      }),
    );
    expect(((context.instruction_layers as Record<string, any>).workflow ?? {}).content).toContain(
      'QA validated the approved branch successfully.',
    );
    expect(((context.instruction_layers as Record<string, any>).workflow ?? {}).content).not.toContain(
      'Unrelated later workflow note.',
    );
  });

  it('returns no predecessor handoff when parent fallback is ambiguous across sibling work items', async () => {
    const db = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM workflows p')) {
          return {
            rows: [{
              id: 'workflow-7',
              name: 'Planned workflow',
              lifecycle: 'planned',
              context: {},
              git_branch: 'release-branch',
              parameters: {},
              resolved_config: {},
              instruction_config: {},
              metadata: {},
              playbook_id: 'playbook-7',
              playbook_name: 'SDLC',
              playbook_outcome: 'Ship a reviewed change',
              playbook_definition: {
                lifecycle: 'planned',
                process_instructions: 'QA validates and product-manager confirms release readiness.',
                board: {
                  entry_column_id: 'planned',
                  columns: [
                    { id: 'planned', label: 'Planned' },
                    { id: 'active', label: 'Active' },
                    { id: 'done', label: 'Done', is_terminal: true },
                  ],
                },
                checkpoints: [
                  { name: 'verification', goal: 'Validate approved changes' },
                  { name: 'release', goal: 'Confirm release readiness', human_gate: true },
                ],
                handoff_rules: [{ from_role: 'qa', to_role: 'product-manager', required: true }],
              },
              project_spec_version: null,
            }],
          };
        }
        if (sql.includes('SELECT DISTINCT stage_name')) {
          return { rows: [{ stage_name: 'release' }] };
        }
        if (sql.includes('FROM workflow_stages') && sql.includes('ORDER BY ws.position ASC')) {
          return {
            rows: [{
              id: 'stage-release',
              name: 'release',
              position: 1,
              goal: 'Confirm release readiness',
              guidance: null,
              human_gate: true,
              status: 'active',
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
              id: 'wi-release',
              stage_name: 'release',
              current_checkpoint: 'release',
              column_id: 'active',
              title: 'Confirm release readiness',
              goal: 'Confirm release readiness',
              acceptance_criteria: [],
              owner_role: 'product-manager',
              next_expected_actor: 'product-manager',
              next_expected_action: 'release_assess',
              rework_count: 0,
              latest_handoff_completion: null,
              unresolved_findings: [],
              review_focus: [],
              known_risks: [],
              priority: 1,
              notes: null,
            }],
          };
        }
        if (
          sql.includes('FROM task_handoffs') &&
          sql.includes('AND work_item_id = $3') &&
          Array.isArray(params) &&
          params[2] === 'wi-release'
        ) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('COUNT(*)::int AS sibling_count')) {
          return {
            rows: [{ sibling_count: 2 }],
            rowCount: 1,
          };
        }
        if (sql.includes('FROM workflow_work_items') && sql.includes('parent_work_item_id')) {
          return {
            rows: [{ parent_work_item_id: 'wi-verification' }],
            rowCount: 1,
          };
        }
        if (
          sql.includes('FROM task_handoffs') &&
          sql.includes('AND work_item_id = $3') &&
          Array.isArray(params) &&
          params[2] === 'wi-verification'
        ) {
          return {
            rows: [{
              id: 'handoff-qa',
              task_id: 'task-qa-1',
              role: 'qa',
              stage_name: 'verification',
              summary: 'QA validated sibling branch A successfully.',
              completion: 'full',
              changes: [],
              decisions: ['Branch A can proceed'],
              remaining_items: [],
              blockers: [],
              review_focus: ['Sibling branch A only'],
              known_risks: [],
              successor_context: 'Use this only for sibling branch A.',
              role_data: {},
              artifact_ids: ['artifact-qa-1'],
              created_at: new Date('2026-03-16T02:00:00Z'),
            }],
            rowCount: 1,
          };
        }
        return { rows: [] };
      }),
    };

    const context = await buildTaskContext(db as never, 'tenant-1', {
      id: 'task-release-2',
      workflow_id: 'workflow-7',
      work_item_id: 'wi-release',
      role: 'product-manager',
      is_orchestrator_task: false,
      depends_on: [],
      role_config: { system_prompt: 'Role prompt' },
      input: { instructions: 'Confirm release readiness.' },
    });

    expect((context.task as Record<string, unknown>).predecessor_handoff).toBeNull();
    expect((context.task as Record<string, unknown>).recent_handoffs).toEqual([]);
    expect((context.task as Record<string, unknown>).predecessor_handoff_resolution).toEqual(
      expect.objectContaining({
        source: 'ambiguous_parent_work_item',
        source_work_item_id: null,
        parent_work_item_id: 'wi-verification',
        sibling_count: 2,
      }),
    );
  });

  it('redacts secret-like predecessor handoff content before attaching task context', async () => {
    const db = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM workflows p')) {
          return {
            rows: [{
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
                checkpoints: [{ name: 'implementation', goal: 'Implement the work' }],
                board: {
                  columns: [{ id: 'in_review', label: 'In Review', is_terminal: false }],
                  entry_column_id: 'in_review',
                },
                review_rules: [{ role: 'reviewer', when: 'before_completion', required: true }],
                handoff_rules: [{ from_role: 'developer', to_role: 'reviewer', required: true }],
                approval_rules: [],
              },
              project_spec_version: null,
            }],
          };
        }
        if (sql.includes('FROM workflow_work_items wi')) {
          return {
            rows: [{
              id: 'work-item-secret',
              workflow_id: 'workflow-secret',
              parent_work_item_id: null,
              title: 'Review authentication flow',
              summary: null,
              description: null,
              stage_name: 'implementation',
              current_checkpoint: 'implementation',
              current_lane: 'in_review',
              state: 'in_progress',
              assigned_role: 'reviewer',
              ownership_mode: 'single',
              metadata: {},
              latest_handoff_completion: 'partial',
              review_focus: ['sk-review-focus'],
              known_risks: ['Bearer risk-secret'],
              unresolved_findings: [],
              active_task_count: 1,
              open_task_count: 1,
              completed_task_count: 0,
              created_at: new Date('2026-03-17T12:00:00Z'),
              updated_at: new Date('2026-03-17T12:00:00Z'),
            }],
          };
        }
        if (sql.includes('SELECT DISTINCT stage_name')) {
          return { rows: [{ stage_name: 'implementation' }] };
        }
        if (sql.includes('FROM workflow_stages') && sql.includes('ORDER BY ws.position ASC')) {
          return {
            rows: [{
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
            }],
          };
        }
        if (
          sql.includes('FROM task_handoffs') &&
          sql.includes('AND work_item_id = $3') &&
          Array.isArray(params) &&
          params[2] === 'work-item-secret'
        ) {
          return {
            rows: [{
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
              review_focus: ['sk-handoff-secret'],
              known_risks: ['Bearer handoff-secret'],
              successor_context: 'Bearer handoff-secret',
              role_data: { api_key: 'sk-handoff-secret' },
              artifact_ids: ['artifact-secret'],
              created_at: new Date('2026-03-17T12:00:00Z'),
            }],
            rowCount: 1,
          };
        }
        if (sql.includes('FROM task_handoffs') && sql.includes('ORDER BY created_at DESC')) {
          return {
            rows: [{
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
              review_focus: [],
              known_risks: [],
              successor_context: 'Bearer handoff-secret',
              role_data: { api_key: 'sk-handoff-secret' },
              artifact_ids: ['artifact-secret'],
              created_at: new Date('2026-03-17T12:00:00Z'),
            }],
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
        review_focus: ['redacted://task-context-secret'],
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

  it('attaches filtered project memory and compact project indexes to specialist task context', async () => {
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM projects')) {
          return {
            rows: [{
              id: 'project-ctx-1',
              name: 'Hello World',
              description: 'Test project',
              repository_url: 'https://github.com/agirunner/agirunner-test-fixtures',
              settings: {},
              memory: {
                shared_note: 'visible',
                release_note: 'visible in workflow',
                old_private_note: 'should be hidden',
              },
            }],
          };
        }
        if (sql.includes('FROM workflows p')) {
          return {
            rows: [{
              id: 'workflow-ctx-1',
              name: 'Planned workflow',
              lifecycle: 'planned',
              context: {},
              git_branch: 'main',
              parameters: {},
              resolved_config: {},
              instruction_config: {},
              metadata: {},
              playbook_id: 'playbook-ctx-1',
              playbook_name: 'SDLC',
              playbook_outcome: 'Ship the change',
              playbook_definition: {
                lifecycle: 'planned',
                process_instructions: 'Developer implements then reviewer reviews.',
                board: {
                  entry_column_id: 'planned',
                  columns: [
                    { id: 'planned', label: 'Planned' },
                    { id: 'active', label: 'Active' },
                    { id: 'review', label: 'In Review' },
                  ],
                },
                checkpoints: [{ name: 'implementation', goal: 'Implement the change' }],
              },
              project_spec_version: null,
            }],
          };
        }
        if (sql.includes('SELECT DISTINCT stage_name')) {
          return { rows: [{ stage_name: 'implementation' }] };
        }
        if (sql.includes('FROM workflow_stages') && sql.includes('ORDER BY ws.position ASC')) {
          return {
            rows: [{
              id: 'stage-implementation',
              lifecycle: 'planned',
              name: 'implementation',
              position: 0,
              goal: 'Implement the change',
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
              first_work_item_at: null,
              last_completed_work_item_at: null,
            }],
          };
        }
        if (sql.includes('FROM workflow_work_items') && sql.includes('AND id = $2')) {
          return {
            rows: [{
              id: 'wi-ctx-1',
              stage_name: 'implementation',
              current_checkpoint: 'implementation',
              column_id: 'active',
              title: 'Implement hello world',
              goal: 'Implement hello world',
              acceptance_criteria: [],
              owner_role: 'developer',
              next_expected_actor: 'developer',
              next_expected_action: 'implement',
              rework_count: 0,
              latest_handoff_completion: null,
              unresolved_findings: [],
              review_focus: [],
              known_risks: [],
              priority: 1,
              notes: null,
            }],
          };
        }
        if (sql.includes("FROM events") && sql.includes("entity_type = 'project'")) {
          return {
            rows: [
              {
                id: 11,
                type: 'project.memory_updated',
                actor_type: 'agent',
                actor_id: 'agent:key',
                created_at: '2026-03-16T08:00:00.000Z',
                data: { key: 'shared_note' },
              },
              {
                id: 12,
                type: 'project.memory_updated',
                actor_type: 'agent',
                actor_id: 'agent:key',
                created_at: '2026-03-16T08:01:00.000Z',
                data: { key: 'release_note', workflow_id: 'workflow-ctx-1' },
              },
              {
                id: 13,
                type: 'project.memory_updated',
                actor_type: 'agent',
                actor_id: 'agent:key',
                created_at: '2026-03-16T08:02:00.000Z',
                data: { key: 'old_private_note', workflow_id: 'workflow-old' },
              },
            ],
            rowCount: 3,
          };
        }
        if (sql.includes('FROM workflow_artifacts')) {
          return {
            rows: [
              {
                logical_path: 'docs/requirements.md',
                task_id: 'task-pm-1',
                created_at: '2026-03-16T09:00:00.000Z',
                total_count: 2,
              },
              {
                logical_path: 'docs/design.md',
                task_id: 'task-arch-1',
                created_at: '2026-03-16T09:30:00.000Z',
                total_count: 2,
              },
            ],
            rowCount: 2,
          };
        }
        if (sql.includes('FROM task_handoffs')) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [] };
      }),
    };

    const context = await buildTaskContext(db as never, 'tenant-1', {
      id: 'task-dev-ctx-1',
      project_id: 'project-ctx-1',
      workflow_id: 'workflow-ctx-1',
      work_item_id: 'wi-ctx-1',
      role: 'developer',
      is_orchestrator_task: false,
      depends_on: [],
      role_config: { system_prompt: 'Role prompt' },
      input: { instructions: 'Implement the task.' },
    });

    const project = context.project as Record<string, unknown>;
    expect(project.memory).toEqual({
      shared_note: 'visible',
      release_note: 'visible in workflow',
    });
    expect(project.memory_index).toEqual({
      keys: ['release_note', 'shared_note'],
      total: 2,
      more_available: false,
    });
    expect(project.artifact_index).toEqual({
      items: [
        {
          logical_path: 'docs/requirements.md',
          task_id: 'task-pm-1',
          created_at: '2026-03-16T09:00:00.000Z',
        },
        {
          logical_path: 'docs/design.md',
          task_id: 'task-arch-1',
          created_at: '2026-03-16T09:30:00.000Z',
        },
      ],
      total: 2,
      more_available: false,
    });
  });
});
