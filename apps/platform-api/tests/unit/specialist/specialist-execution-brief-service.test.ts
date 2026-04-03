import { posix } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildSpecialistExecutionBrief } from '../../../src/services/specialist-execution-brief-service/specialist-execution-brief-service.js';

const taskWorkspaceRoot = posix.join('/', 'tmp', 'workspace');

describe('buildSpecialistExecutionBrief', () => {
  function buildInput() {
    return {
      role: 'reviewer',
      workflow: {
        lifecycle: 'planned',
        live_visibility: {
          mode: 'enhanced',
          workflow_id: 'workflow-1',
          work_item_id: 'wi-1',
          task_id: 'task-review-1',
          execution_context_id: 'task-review-1',
          source_kind: 'specialist',
          record_operator_brief_tool: 'record_operator_brief',
          milestone_briefs_required: true,
        },
        variables: {
          goal: 'Ship the authentication refresh-token fix.',
          release_target: 'v2.4.0',
        },
        playbook: {
          definition: {
            lifecycle: 'planned',
            process_instructions:
              'Developer implements, reviewer inspects the output, and the orchestrator invokes explicit approvals or escalations only when needed.',
            board: {
              columns: [
                { id: 'review', label: 'In Review' },
                { id: 'done', label: 'Done', is_terminal: true },
              ],
            },
            stages: [{ name: 'implementation', goal: 'Build the refresh-token fix' }],
          },
        },
      },
      workspace: {
        description: 'Primary workspace for auth fixes.',
        repository_url: 'https://github.com/example/auth-service',
        memory: {
          release_note: 'Mention the refresh-token expiry fix in release notes.',
          unrelated_note: 'Not relevant here.',
        },
        memory_index: {
          keys: ['release_note', 'unrelated_note'],
          total: 2,
          more_available: false,
        },
        artifact_index: {
          items: [
            {
              artifact_id: 'artifact-release',
              logical_path: 'docs/release-notes.md',
              task_id: 'task-pm-1',
              content_type: 'text/markdown',
              created_at: '2026-03-20T00:00:00.000Z',
            },
            {
              artifact_id: 'artifact-unrelated',
              logical_path: 'docs/brainstorming.md',
              task_id: 'task-pm-2',
              content_type: 'text/markdown',
              created_at: '2026-03-20T00:00:00.000Z',
            },
          ],
          total: 2,
          more_available: false,
        },
      },
      workItem: {
        id: 'wi-1',
        stage_name: 'implementation',
        column_id: 'review',
        title: 'Review the refresh-token fix',
        goal: 'Review the refresh-token implementation before release',
        acceptance_criteria: ['Reviewer confirms the fix and flags any regressions.'],
        next_expected_actor: 'reviewer',
        next_expected_action: 'assess',
        latest_handoff_completion: 'partial',
        unresolved_findings: ['Check release note wording.'],
        focus_areas: ['Refresh-token expiry path'],
        rework_count: 0,
        priority: 1,
        metadata: {},
      },
      predecessorHandoff: {
        id: 'handoff-1',
        role: 'developer',
        summary: 'Implementation is ready for review and release-note validation.',
        successor_context: 'Focus on refresh-token expiry handling and release notes.',
        changes: [
          { path: 'src/auth/refresh.ts', summary: 'Adjust expiry handling.' },
          { path: 'docs/release-notes.md', summary: 'Document the fix.' },
        ],
      },
      taskInput: {
        description: 'Review the implementation and confirm the release-note update.',
      },
      executionEnvironmentSnapshot: {
        id: 'env-1',
        name: 'Node LTS Base',
        image: 'node:22-bookworm-slim',
        agent_hint: [
          'Execution environment: Node LTS Base',
          'Image: node:22-bookworm-slim',
          'Package manager: apt-get',
          'Shell: /bin/sh',
          'Verified baseline commands: sh, cat, grep, node, npm',
        ].join('\n'),
        verified_metadata: {
          package_manager: 'apt-get',
          shell: '/bin/sh',
          detected_runtimes: ['node', 'npm'],
        },
        tool_capabilities: {
          verified_baseline_commands: ['sh', 'cat', 'grep', 'node', 'npm'],
        },
      },
      roleConfig: {
        tools: ['file_read', 'git_diff', 'submit_handoff'],
      },
      specialistCapabilities: {
        name: 'Reviewer',
        description: 'Reviews work and records findings.',
        escalationTarget: null,
        allowedTools: ['file_read', 'git_diff', 'submit_handoff'],
        skills: [],
        remoteMcpServers: [
          {
            id: 'mcp-1',
            name: 'Tavily Search',
            slug: 'tavily-search',
            description: 'Web search and lightweight research.',
            endpointUrl: 'https://mcp.tavily.com/mcp/{tenant}',
            callTimeoutSeconds: 300,
            authMode: 'parameterized' as const,
            verifiedTransport: 'streamable_http' as const,
            verificationContractVersion: 'remote-mcp-v1',
            verifiedCapabilitySummary: {
              tool_count: 2,
              resource_count: 1,
              prompt_count: 0,
            },
            discoveredToolsSnapshot: [
              { original_name: 'search', description: 'Search the web' },
              { original_name: 'research', description: 'Research deeply' },
            ],
            discoveredResourcesSnapshot: [
              { uri: 'docs://guides/getting-started', name: 'Getting Started' },
            ],
            discoveredPromptsSnapshot: [],
            oauthConfig: null,
            oauthCredentials: null,
            parameters: [],
          },
        ],
      },
    };
  }

  it('builds a specialist brief from stages, continuity, and actual next-step state', () => {
    const brief = buildSpecialistExecutionBrief(buildInput());
    const rendered = brief?.rendered_markdown ?? '';

    expect(brief).not.toBeNull();
    expect(brief?.refresh_key).toMatch(/^[a-f0-9]{64}$/);
    expect(brief?.workflow_brief.goal).toBe('Ship the authentication refresh-token fix.');
    expect(brief?.workflow_brief.launch_inputs).toEqual([
      { key: 'release_target', value: 'v2.4.0' },
    ]);
    expect(brief?.current_focus).toEqual(
      expect.objectContaining({
        stage_name: 'implementation',
        stage_goal: 'Build the refresh-token fix',
        board_position: 'In Review',
      }),
    );
    expect(brief?.assessment_output_expectations).toEqual(
      expect.arrayContaining([
        'Expected review actor: reviewer.',
        'reviewer should assess the current output before the work item moves forward.',
      ]),
    );
    expect(brief?.likely_relevant_files).toEqual(['docs/release-notes.md', 'src/auth/refresh.ts']);
    expect(brief?.relevant_memory_refs).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: 'release_note' })]),
    );
    expect(brief?.relevant_artifact_refs).toEqual([
      expect.objectContaining({
        artifact_id: 'artifact-release',
        logical_path: 'docs/release-notes.md',
      }),
    ]);
    expect(brief?.repository_runtime_guidance).toEqual({
      preferred_verification_methods: ['repo_native_commands', 'declared_runtime_commands'],
      failure_recovery_contracts: [
        'investigate_failed_commands_before_retry',
        'prefer_repo_native_commands_before_ad_hoc_probes',
        'verify_repo_entrypoints_before_project_commands',
        'check_runtime_or_dependency_availability',
      ],
      avoid_patterns: ['ad_hoc_source_rewrite_eval'],
      runtime_recheck_required: true,
    });
    expect(rendered).toContain('## Workflow Brief');
    expect(rendered).toContain('## Completion Expectations');
    expect(rendered).toContain('## Operator Visibility');
    expect(rendered).toContain('## Path Discipline');
    expect(rendered).toContain('## Execution Environment Contract');
    expect(rendered).toContain('## Remote MCP Servers');
    expect(rendered).toContain('## Execution Surface');
    expect(rendered).toContain('Live visibility mode: enhanced');
    expect(rendered).toContain('Workflow id: workflow-1');
    expect(rendered).toContain('Work item id: wi-1');
    expect(rendered).toContain('Task id: task-review-1');
    expect(rendered).toContain('Execution context id: task-review-1');
    expect(rendered).toContain('handoff:task-review-1:r0:<handoff-slug>');
    expect(rendered).toContain(taskWorkspaceRoot);
    expect(rendered).toContain('/workspace/context/...');
    expect(rendered).toContain('Repository-backed task.');
    expect(rendered).toContain('Execution environment: Node LTS Base');
    expect(rendered).toContain('Package manager: apt-get');
    expect(rendered).toContain('Shell: /bin/sh');
    expect(rendered).toContain('Verified baseline commands: sh, cat, grep, node, npm');
    expect(rendered).toContain('Tavily Search');
    expect(rendered).toContain('Verified capabilities: 2 tools, 1 resource, 0 prompts.');
    expect(rendered).not.toContain('git_token_secret_ref');
  });

  it('changes refresh_key when predecessor handoff changes', () => {
    const base = buildInput();
    const initial = buildSpecialistExecutionBrief(base);
    const updated = buildSpecialistExecutionBrief({
      ...base,
      predecessorHandoff: {
        ...base.predecessorHandoff,
        id: 'handoff-2',
        summary: 'Implementation is ready for review with an updated release note.',
      },
    });

    expect(initial?.refresh_key).not.toBe(updated?.refresh_key);
  });

  it('renders handoff request_id guidance with the current rework count', () => {
    const brief = buildSpecialistExecutionBrief({
      ...buildInput(),
      workItem: {
        ...buildInput().workItem,
        rework_count: 3,
      },
    });

    expect(brief?.rendered_markdown).toContain(
      'handoff:task-review-1:r3:<handoff-slug>',
    );
  });

  it('renders the task contract goal and acceptance criteria', () => {
    const brief = buildSpecialistExecutionBrief({
      ...buildInput(),
      taskInput: {
        description: 'Document the bounded fix recommendation or advisory patch package.',
      },
      workItem: {
        ...buildInput().workItem,
        goal: 'Produce the smallest safe fix or advisory patch package for release review.',
        acceptance_criteria: [
          'Implement the smallest safe fix available in the seeded repository or document an advisory patch package when the real worker path is unavailable.',
        ],
      },
    });

    expect(brief?.rendered_markdown).toContain('## Task Contract');
    expect(brief?.rendered_markdown).toContain(
      'Goal: Document the bounded fix recommendation or advisory patch package.',
    );
    expect(brief?.rendered_markdown).toContain(
      'Implement the smallest safe fix available in the seeded repository or document an advisory patch package when the real worker path is unavailable.',
    );
  });

  it('changes refresh_key when active workflow controls change', () => {
    const base = buildInput();
    const initial = buildSpecialistExecutionBrief(base);
    const updated = buildSpecialistExecutionBrief({
      ...base,
      workItem: {
        ...base.workItem,
        next_expected_action: 'approve',
        metadata: {
          stage_gate: {
            gate_status: 'changes_requested',
            gate_decision_feedback: 'Clarify the release-note wording before approval.',
            gate_decided_at: '2026-03-20T12:00:00.000Z',
          },
        },
      },
    });

    expect(initial?.refresh_key).not.toBe(updated?.refresh_key);
  });

  it('keeps refresh_key stable when unrelated workspace fields change', () => {
    const base = buildInput();
    const initial = buildSpecialistExecutionBrief(base);
    const updated = buildSpecialistExecutionBrief({
      ...base,
      workspace: {
        ...base.workspace,
        description: 'Renamed workspace description that should not affect the brief.',
      },
    });

    expect(initial?.refresh_key).toBe(updated?.refresh_key);
  });

  it('treats repo-connected tasks with runtime-only tools as non-repository work', () => {
    const brief = buildSpecialistExecutionBrief({
      ...buildInput(),
      roleConfig: {
        tools: ['memory_read', 'memory_write', 'submit_handoff', 'read_predecessor_handoff'],
      },
    } as any);

    expect(brief).not.toBeNull();
    expect(brief?.repo_status_summary).toBe(
      'Non-repository task. Base completion on artifacts, outputs, and recorded evidence.',
    );
    expect(brief?.assessment_output_expectations).toContain(
      'Required artifacts must be uploaded before completion or escalation.',
    );
    expect(brief?.repository_runtime_guidance).toBeNull();
    expect(brief?.rendered_markdown).not.toContain('Use task sandbox tools');
  });
});
