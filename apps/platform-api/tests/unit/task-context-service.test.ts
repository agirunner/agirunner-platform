import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/document-reference-service.js', () => ({
  listTaskDocuments: vi.fn(async () => []),
}));

vi.mock('../../src/services/orchestrator-task-context.js', () => ({
  buildOrchestratorTaskContext: vi.fn(async () => null),
}));

import {
  buildTaskContext,
  summarizeTaskContextAttachments,
} from '../../src/services/task-context-service.js';

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
              workspace_spec_version: null,
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
              workspace_spec_version: null,
            }],
          };
        }
        if (sql.includes('SELECT DISTINCT wi.stage_name')) {
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

  it('includes the assigned role description in the specialist role instruction layer', async () => {
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM workflows p')) {
          return {
            rows: [{
              id: 'workflow-role',
              name: 'Workflow role',
              lifecycle: 'planned',
              context: {},
              git_branch: 'main',
              parameters: {},
              resolved_config: {},
              instruction_config: {},
              metadata: {},
              playbook_id: 'playbook-role',
              playbook_name: 'Role playbook',
              playbook_outcome: 'Ship work',
              playbook_definition: {
                lifecycle: 'planned',
                process_instructions: 'Implement the requested change.',
                board: {
                  columns: [
                    { id: 'planned', label: 'Planned' },
                    { id: 'done', label: 'Done', is_terminal: true },
                  ],
                },
                stages: [
                  { name: 'implementation', goal: 'Build the change' },
                ],
              },
              workspace_spec_version: null,
            }],
          };
        }
        if (sql.includes('SELECT DISTINCT wi.stage_name')) {
          return { rows: [{ stage_name: 'implementation' }] };
        }
        if (sql.includes('FROM role_definitions rd')) {
          return {
            rows: [{
              name: 'developer',
              description: 'Implements the requested change.',
              escalation_target: 'human',
              allowed_tools: ['shell', 'web_fetch'],
              skills: [
                {
                  id: 'skill-1',
                  name: 'Structured Search',
                  slug: 'structured-search',
                  summary: 'Search deliberately.',
                  content: 'Always open with a search plan before using remote research tools.',
                  sort_order: 0,
                },
              ],
              remote_mcp_servers: [
                {
                  id: 'mcp-1',
                  name: 'Tavily Search',
                  slug: 'tavily-search',
                  description: 'Web search and lightweight research.',
                  endpoint_url: 'https://mcp.tavily.com/mcp/{tenant}',
                  auth_mode: 'parameterized',
                  verified_transport: 'streamable_http',
                  verification_contract_version: 'remote-mcp-v1',
                  verified_capability_summary: {
                    tool_count: 2,
                    resource_count: 1,
                    prompt_count: 0,
                  },
                  discovered_tools_snapshot: [
                    { original_name: 'search', description: 'Search the web' },
                    { original_name: 'research', description: 'Research deeply' },
                  ],
                  discovered_resources_snapshot: [
                    { uri: 'docs://guides/getting-started', name: 'Getting Started' },
                  ],
                  discovered_prompts_snapshot: [],
                  parameters: [],
                },
              ],
            }],
          };
        }
        return { rows: [] };
      }),
    };

    const context = await buildTaskContext(db as never, 'tenant-1', {
      id: 'task-role',
      workflow_id: 'workflow-role',
      depends_on: [],
      role: 'developer',
      role_config: {
        description: 'Implements the requested change.',
        instructions: 'Write the code and verify it before handoff.',
      },
    });

    const roleLayer = ((context.instruction_layers as Record<string, any>).role ?? {});
    expect(roleLayer.content).toContain('Role description: Implements the requested change.');
    expect(roleLayer.content).toContain('Write the code and verify it before handoff.');
    expect(roleLayer.content).toContain('## Specialist Skills');
    expect(roleLayer.content).toContain('### Structured Search');
    expect(roleLayer.content).toContain(
      'Always open with a search plan before using remote research tools.',
    );
    expect(roleLayer.content).toContain('## Remote MCP Servers Available');
    expect(roleLayer.content).toContain('Tavily Search');
    expect(roleLayer.content).toContain('Verified capabilities: 2 tools, 1 resource, 0 prompts.');
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
                stages: [
                  { name: 'design', goal: 'Design the work' },
                  { name: 'implementation', goal: 'Build the work' },
                ],
              },
              workspace_spec_version: null,
            }],
          };
        }
        if (sql.includes('SELECT DISTINCT wi.stage_name')) {
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

  it('includes workflow input packets in the workflow context', async () => {
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM workflows p')) {
          return {
            rows: [{
              id: 'workflow-packets',
              name: 'Packet workflow',
              lifecycle: 'planned',
              context: {},
              git_branch: 'main',
              parameters: {},
              resolved_config: {},
              instruction_config: {},
              metadata: {},
              playbook_id: 'playbook-packets',
              playbook_name: 'Packet playbook',
              playbook_outcome: 'Ship work',
              playbook_definition: {
                lifecycle: 'planned',
                stages: [{ name: 'implementation', goal: 'Build it' }],
              },
              workspace_spec_version: null,
            }],
          };
        }
        if (sql.includes('SELECT DISTINCT wi.stage_name')) {
          return { rows: [{ stage_name: 'implementation' }] };
        }
        if (sql.includes('FROM workflow_input_packets')) {
          return {
            rows: [{
              id: 'packet-1',
              work_item_id: null,
              packet_kind: 'supplemental',
              source: 'operator',
              summary: 'Added a deployment checklist',
              structured_inputs: { environment: 'staging' },
              metadata: {},
              created_at: new Date('2026-03-27T10:00:00.000Z'),
            }],
          };
        }
        if (sql.includes('FROM workflow_input_packet_files')) {
          return {
            rows: [{
              id: 'packet-file-1',
              packet_id: 'packet-1',
              file_name: 'checklist.txt',
              description: 'Deployment checklist',
              content_type: 'text/plain',
              size_bytes: 42,
              created_at: new Date('2026-03-27T10:00:00.000Z'),
            }],
          };
        }
        return { rows: [] };
      }),
    };

    const context = await buildTaskContext(db as never, 'tenant-1', {
      id: 'task-packets',
      workflow_id: 'workflow-packets',
      depends_on: [],
    });

    const workflow = context.workflow as Record<string, unknown>;
    expect(workflow).toHaveProperty('input_packets');
    expect(workflow.input_packets).toEqual([
      expect.objectContaining({
        id: 'packet-1',
        packet_kind: 'supplemental',
        files: [
          expect.objectContaining({
            id: 'packet-file-1',
            file_name: 'checklist.txt',
          }),
        ],
      }),
    ]);
  });

  it('injects stage-driven workflow context for specialist tasks', async () => {
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
                stages: [
                  { name: 'implementation', goal: 'Implement the requested change' },
                  { name: 'verification', goal: 'Verify the change' },
                ],
              },
              workspace_spec_version: null,
            }],
          };
        }
        if (sql.includes('SELECT DISTINCT wi.stage_name')) {
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
              focus_areas: ['Auth edge cases'],
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
      role_config: { system_prompt: 'Role prompt', tools: ['file_read', 'git_diff', 'submit_handoff'] },
      input: { instructions: 'Review the implementation.' },
    });

    const workflowLayer = ((context.instruction_layers as Record<string, any>).workflow ??
      {}) as Record<string, any>;
    expect(workflowLayer.content).toContain('## Workflow Mode: planned');
    expect(workflowLayer.content).toContain('## Process Instructions');
    expect(workflowLayer.content).toContain('Developer implements, reviewer reviews');
    expect(workflowLayer.content).toContain('## Output Protocol');
    expect(workflowLayer.content).toContain('commit and push required changes before completion or escalation');
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
    expect((context.task as Record<string, any>).work_item).not.toHaveProperty('current_checkpoint');
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
                stages: [
                  { name: 'requirements', goal: 'Clarify requirements' },
                  { name: 'design', goal: 'Produce a technical design' },
                ],
              },
              workspace_spec_version: null,
            }],
          };
        }
        if (sql.includes('SELECT DISTINCT wi.stage_name')) {
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
              focus_areas: [],
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
                stages: [
                  { name: 'verification', goal: 'Validate approved changes' },
                  { name: 'release', goal: 'Confirm release readiness' },
                ],
              },
              workspace_spec_version: null,
            }],
          };
        }
        if (sql.includes('SELECT DISTINCT wi.stage_name')) {
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
              focus_areas: [],
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
              focus_areas: ['Use this evidence for release approval'],
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
              focus_areas: [],
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
    expect(((context as Record<string, any>).execution_brief ?? {}).rendered_markdown).toContain(
      'QA validated the approved branch successfully.',
    );
    expect(((context as Record<string, any>).execution_brief ?? {}).rendered_markdown).not.toContain(
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
                stages: [
                  { name: 'verification', goal: 'Validate approved changes' },
                  { name: 'release', goal: 'Confirm release readiness' },
                ],
              },
              workspace_spec_version: null,
            }],
          };
        }
        if (sql.includes('SELECT DISTINCT wi.stage_name')) {
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
              focus_areas: [],
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
              focus_areas: ['Sibling branch A only'],
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

  it('includes recent ancestor handoffs when a work item follows a single-parent lineage', async () => {
    const db = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM workflows p')) {
          return {
            rows: [{
              id: 'workflow-lineage',
              name: 'PRD lineage workflow',
              lifecycle: 'planned',
              context: {},
              git_branch: null,
              parameters: {},
              resolved_config: {},
              instruction_config: {},
              metadata: {},
              playbook_id: 'playbook-lineage',
              playbook_name: 'PRD',
              playbook_outcome: 'Finalize the PRD',
              playbook_definition: {
                lifecycle: 'planned',
                stages: [
                  { name: 'requirements', goal: 'Draft the PRD' },
                  { name: 'technical-review', goal: 'Review the PRD' },
                  { name: 'approval', goal: 'Finalize the PRD' },
                ],
              },
              workspace_spec_version: null,
            }],
          };
        }
        if (sql.includes('SELECT DISTINCT wi.stage_name')) {
          return { rows: [{ stage_name: 'approval' }] };
        }
        if (sql.includes('FROM workflow_stages') && sql.includes('ORDER BY ws.position ASC')) {
          return { rows: [] };
        }
        if (sql.includes('FROM workflow_work_items') && sql.includes('AND id = $2')) {
          return {
            rows: [{
              id: 'wi-approval',
              stage_name: 'approval',
              column_id: 'active',
              title: 'Finalize the PRD',
              goal: 'Finalize the PRD',
              acceptance_criteria: [],
              owner_role: 'product-manager',
              next_expected_actor: 'product-manager',
              next_expected_action: 'revise_prd',
              rework_count: 0,
              latest_handoff_completion: null,
              unresolved_findings: [],
              focus_areas: [],
              known_risks: [],
              priority: 1,
              notes: null,
            }],
          };
        }
        if (sql.includes('COUNT(*)::int AS sibling_count')) {
          return { rows: [{ sibling_count: 1 }], rowCount: 1 };
        }
        if (
          sql.includes('FROM workflow_work_items') &&
          sql.includes('parent_work_item_id') &&
          !sql.includes('COUNT(*)::int AS sibling_count')
        ) {
          if (Array.isArray(params) && params[2] === 'wi-approval') {
            return { rows: [{ parent_work_item_id: 'wi-review' }], rowCount: 1 };
          }
          if (Array.isArray(params) && params[2] === 'wi-review') {
            return { rows: [{ parent_work_item_id: 'wi-requirements' }], rowCount: 1 };
          }
          if (Array.isArray(params) && params[2] === 'wi-requirements') {
            return { rows: [{ parent_work_item_id: null }], rowCount: 1 };
          }
        }
        if (
          sql.includes('FROM task_handoffs') &&
          sql.includes('AND work_item_id = $3') &&
          Array.isArray(params) &&
          params[2] === 'wi-approval'
        ) {
          return { rows: [], rowCount: 0 };
        }
        if (
          sql.includes('FROM task_handoffs') &&
          sql.includes('AND work_item_id = $3') &&
          Array.isArray(params) &&
          params[2] === 'wi-review'
        ) {
          return {
            rows: [{
              id: 'handoff-review-1',
              work_item_id: 'wi-review',
              task_id: 'task-architect-1',
              role: 'architect',
              stage_name: 'technical-review',
              summary: 'Technical review requires PRD revisions.',
              completion: 'full',
              changes: ['Uploaded technical review findings'],
              decisions: ['Reuse the existing spend pipeline'],
              remaining_items: ['Revise the PRD'],
              blockers: [],
              focus_areas: ['Budget semantics'],
              known_risks: ['Attribution drift'],
              successor_context: 'Revise the PRD before approval.',
              role_data: {},
              artifact_ids: ['artifact-review-1'],
              created_at: new Date('2026-03-16T02:00:00Z'),
            }],
            rowCount: 1,
          };
        }
        if (
          sql.includes('FROM task_handoffs') &&
          sql.includes('AND work_item_id = $3') &&
          Array.isArray(params) &&
          params[2] === 'wi-requirements'
        ) {
          return {
            rows: [{
              id: 'handoff-prd-1',
              work_item_id: 'wi-requirements',
              task_id: 'task-pm-1',
              role: 'product-manager',
              stage_name: 'requirements',
              summary: 'Initial PRD draft ready.',
              completion: 'full',
              changes: ['Uploaded the baseline PRD'],
              decisions: ['Threshold is configurable'],
              remaining_items: [],
              blockers: [],
              focus_areas: [],
              known_risks: [],
              successor_context: 'Use the baseline PRD as the revision source.',
              role_data: {},
              artifact_ids: ['artifact-prd-1'],
              created_at: new Date('2026-03-16T01:00:00Z'),
            }],
            rowCount: 1,
          };
        }
        return { rows: [] };
      }),
    };

    const context = await buildTaskContext(db as never, 'tenant-1', {
      id: 'task-approval-1',
      workflow_id: 'workflow-lineage',
      work_item_id: 'wi-approval',
      role: 'product-manager',
      is_orchestrator_task: false,
      depends_on: [],
      role_config: { system_prompt: 'Role prompt' },
      input: { instructions: 'Finalize the PRD.' },
    });

    expect((context.task as Record<string, unknown>).predecessor_handoff).toEqual(
      expect.objectContaining({
        id: 'handoff-review-1',
        artifact_ids: ['artifact-review-1'],
        work_item_id: 'wi-review',
      }),
    );
    expect((context.task as Record<string, unknown>).recent_handoffs).toEqual([
      expect.objectContaining({
        id: 'handoff-review-1',
        work_item_id: 'wi-review',
      }),
      expect.objectContaining({
        id: 'handoff-prd-1',
        artifact_ids: ['artifact-prd-1'],
        work_item_id: 'wi-requirements',
      }),
    ]);
    expect((context.task as Record<string, unknown>).predecessor_handoff_resolution).toEqual(
      expect.objectContaining({
        source: 'parent_work_item',
        source_work_item_id: 'wi-review',
        parent_work_item_id: 'wi-review',
        sibling_count: 1,
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
                stages: [{ name: 'implementation', goal: 'Implement the work' }],
                board: {
                  columns: [{ id: 'in_review', label: 'In Review', is_terminal: false }],
                  entry_column_id: 'in_review',
                },
              },
              workspace_spec_version: null,
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
            }],
          };
        }
        if (sql.includes('SELECT DISTINCT wi.stage_name')) {
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
              focus_areas: ['sk-handoff-secret'],
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
              focus_areas: [],
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

  it('injects board-driven workflow context when no stages are defined', async () => {
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
                stages: [],
              },
              workspace_spec_version: null,
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
    expect(workflowLayer.content).toContain('Stage-and-board driven');
    expect(workflowLayer.content).toContain('Upload required artifacts before completion or escalation');
    expect(workflowLayer.content).not.toContain('## Board Position');
    expect(((context as Record<string, any>).execution_brief ?? {}).current_focus).toEqual(
      expect.objectContaining({
        board_position: 'Active',
      }),
    );
  });

  it('attaches filtered workspace memory and compact workspace indexes to specialist task context', async () => {
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM workspaces')) {
          return {
            rows: [{
              id: 'workspace-ctx-1',
              name: 'Hello World',
              description: 'Test workspace',
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
                stages: [{ name: 'implementation', goal: 'Implement the change' }],
              },
              workspace_spec_version: null,
            }],
          };
        }
        if (sql.includes('SELECT DISTINCT wi.stage_name')) {
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
              focus_areas: [],
              known_risks: [],
              priority: 1,
              notes: null,
            }],
          };
        }
        if (sql.includes("FROM events") && sql.includes("entity_type = 'workspace'")) {
          return {
            rows: [
              {
                id: 11,
                type: 'workspace.memory_updated',
                actor_type: 'agent',
                actor_id: 'agent:key',
                created_at: '2026-03-16T08:00:00.000Z',
                data: { key: 'shared_note' },
              },
              {
                id: 12,
                type: 'workspace.memory_updated',
                actor_type: 'agent',
                actor_id: 'agent:key',
                created_at: '2026-03-16T08:01:00.000Z',
                data: { key: 'release_note', workflow_id: 'workflow-ctx-1' },
              },
              {
                id: 13,
                type: 'workspace.memory_updated',
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
                id: 'artifact-requirements',
                logical_path: 'docs/requirements.md',
                task_id: 'task-pm-1',
                content_type: 'text/markdown',
                created_at: '2026-03-16T09:00:00.000Z',
                total_count: 2,
              },
              {
                id: 'artifact-design',
                logical_path: 'docs/design.md',
                task_id: 'task-arch-1',
                content_type: 'text/markdown',
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
      workspace_id: 'workspace-ctx-1',
      workflow_id: 'workflow-ctx-1',
      work_item_id: 'wi-ctx-1',
      role: 'developer',
      is_orchestrator_task: false,
      depends_on: [],
      role_config: { system_prompt: 'Role prompt' },
      input: { instructions: 'Implement the task.' },
    });

    const workspace = context.workspace as Record<string, unknown>;
    expect(workspace.memory).toEqual({
      shared_note: 'visible',
      release_note: 'visible in workflow',
    });
    expect(workspace.memory_index).toEqual({
      keys: ['release_note', 'shared_note'],
      total: 2,
      more_available: false,
    });
    expect(workspace.artifact_index).toEqual({
      items: [
        {
          artifact_id: 'artifact-requirements',
          logical_path: 'docs/requirements.md',
          task_id: 'task-pm-1',
          content_type: 'text/markdown',
          created_at: '2026-03-16T09:00:00.000Z',
        },
        {
          artifact_id: 'artifact-design',
          logical_path: 'docs/design.md',
          task_id: 'task-arch-1',
          content_type: 'text/markdown',
          created_at: '2026-03-16T09:30:00.000Z',
        },
      ],
      total: 2,
      more_available: false,
    });
  });

  it('derives predecessor handoff and work item context for orchestrator tasks from activation events', async () => {
    const db = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM workflows p')) {
          return {
            rows: [{
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
            }],
          };
        }
        if (sql.includes('SELECT DISTINCT wi.stage_name')) {
          return { rows: [{ stage_name: 'implementation' }] };
        }
        if (sql.includes('FROM workflow_stages') && sql.includes('ORDER BY ws.position ASC')) {
          return {
            rows: [{
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
            }],
          };
        }
        if (sql.includes('FROM workflow_work_items') && sql.includes('AND id = $2')) {
          expect(params?.[1]).toBe('wi-design');
          return {
            rows: [{
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
            }],
          };
        }
        if (
          sql.includes('FROM task_handoffs') &&
          sql.includes('AND work_item_id = $3') &&
          Array.isArray(params)
        ) {
          expect(params[2]).toBe('wi-design');
          return {
            rows: [{
              id: 'handoff-design-1',
              workflow_id: 'workflow-activation',
              work_item_id: 'wi-design',
              task_id: 'task-architect-1',
              role: 'architect',
              stage_name: 'design',
              sequence: 1,
              summary: 'Technical design is approved and ready for implementation.',
              completion: 'complete',
              changes: [{ path: 'docs/design.md', summary: 'Added approved implementation plan' }],
              decisions: ['Use the approved service boundary'],
              remaining_items: [],
              blockers: [],
              focus_areas: ['Validate implementation against the design'],
              known_risks: ['Implementation drift'],
              successor_context: 'Create the implementation work item from this design.',
              role_data: { document: 'docs/design.md' },
              artifact_ids: ['artifact-design-1'],
              created_at: new Date('2026-03-18T00:00:00Z'),
            }],
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

  it('uses the activation-event work item when an orchestrator task only has a stage name on the row', async () => {
    const db = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM workflows p')) {
          return {
            rows: [{
              id: 'workflow-approval',
              name: 'Approval workflow',
              lifecycle: 'planned',
              context: {},
              git_branch: 'main',
              parameters: {},
              resolved_config: {},
              instruction_config: {},
              metadata: {},
              playbook_id: 'playbook-approval',
              playbook_name: 'Approval playbook',
              playbook_outcome: 'Approve the PRD',
              playbook_definition: {
                lifecycle: 'planned',
                stages: [
                  { name: 'requirements', goal: 'Draft the PRD' },
                  { name: 'technical-review', goal: 'Review the PRD' },
                  { name: 'approval', goal: 'Approve the PRD' },
                ],
              },
              workspace_spec_version: null,
            }],
          };
        }
        if (sql.includes('SELECT DISTINCT wi.stage_name')) {
          return { rows: [{ stage_name: 'approval' }] };
        }
        if (sql.includes('FROM workflow_stages') && sql.includes('ORDER BY ws.position ASC')) {
          return {
            rows: [{
              id: 'stage-approval',
              name: 'approval',
              position: 2,
              goal: 'Approve the PRD',
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
          expect(params?.[1]).toBe('wi-approval');
          return {
            rows: [{
              id: 'wi-approval',
              stage_name: 'approval',
              column_id: 'planned',
              title: 'Finalize PRD for approval',
              goal: 'Prepare the final PRD for approval',
              acceptance_criteria: [],
              owner_role: 'product-manager',
              next_expected_actor: 'product-manager',
              next_expected_action: 'Finalize the PRD and submit approval handoff',
              rework_count: 0,
              latest_handoff_completion: 'full',
              unresolved_findings: [],
              focus_areas: ['Validate final PRD language'],
              known_risks: ['Attribution drift'],
              priority: 'high',
              notes: null,
            }],
          };
        }
        if (
          sql.includes('FROM task_handoffs') &&
          sql.includes('AND work_item_id = $3') &&
          Array.isArray(params)
        ) {
          expect(params[2]).toBe('wi-approval');
          return {
            rows: [{
              id: 'handoff-approval-1',
              workflow_id: 'workflow-approval',
              work_item_id: 'wi-approval',
              task_id: 'task-pm-approval-1',
              role: 'product-manager',
              stage_name: 'approval',
              sequence: 1,
              summary: 'Final PRD is ready for approval.',
              completion: 'full',
              changes: ['Updated requirements/prd.md'],
              decisions: ['Approval review can begin'],
              remaining_items: [],
              blockers: [],
              focus_areas: ['Validate final PRD language'],
              known_risks: ['Attribution drift'],
              successor_context: 'Request the approval gate with the final PRD.',
              role_data: {},
              artifact_ids: ['artifact-prd-final-1'],
              created_at: new Date('2026-03-18T12:00:00Z'),
            }],
          };
        }
        return { rows: [] };
      }),
    };

    const context = await buildTaskContext(db as never, 'tenant-1', {
      id: 'task-orchestrator-approval-1',
      workflow_id: 'workflow-approval',
      stage_name: 'approval',
      is_orchestrator_task: true,
      depends_on: [],
      input: {
        activation_reason: 'queued_events',
        events: [
          {
            type: 'task.handoff_submitted',
            reason: 'task.handoff_submitted',
            work_item_id: 'wi-approval',
            stage_name: 'approval',
            payload: {
              task_id: 'task-pm-approval-1',
              work_item_id: 'wi-approval',
              stage_name: 'approval',
            },
          },
        ],
      },
    });

    expect((context.task as Record<string, unknown>).context_anchor).toEqual({
      source: 'activation_event',
      event_type: 'task.handoff_submitted',
      work_item_id: 'wi-approval',
      stage_name: 'approval',
      triggering_task_id: 'task-pm-approval-1',
    });
    expect((context.task as Record<string, unknown>).work_item).toEqual(
      expect.objectContaining({
        id: 'wi-approval',
        stage_name: 'approval',
      }),
    );
    expect((context.task as Record<string, unknown>).predecessor_handoff).toEqual(
      expect.objectContaining({
        id: 'handoff-approval-1',
        work_item_id: 'wi-approval',
        task_id: 'task-pm-approval-1',
      }),
    );
    expect((context.task as Record<string, unknown>).predecessor_handoff_resolution).toEqual(
      expect.objectContaining({
        source: 'local_work_item',
        source_work_item_id: 'wi-approval',
      }),
    );
  });

  it('marks orchestrator checkpoints in attachment summaries', () => {
    const summary = summarizeTaskContextAttachments({
      task: {
        predecessor_handoff: null,
        predecessor_handoff_resolution: null,
        context_anchor: null,
        recent_handoffs: [],
        work_item: {},
      },
      workspace: {
        memory_index: {},
        artifact_index: {},
      },
      instruction_layers: {},
      documents: [],
      orchestrator: {
        last_activation_checkpoint: {
          activation_id: 'activation-7',
        },
      },
    });

    expect(summary.orchestrator_checkpoint_present).toBe(true);
  });
});
