import { describe, expect, it } from 'vitest';

import { buildSpecialistExecutionBrief } from '../../src/services/specialist-execution-brief-service.js';

describe('buildSpecialistExecutionBrief', () => {
  function buildInput() {
    return {
      role: 'reviewer',
      workflow: {
        lifecycle: 'planned',
        variables: {
          goal: 'Ship the authentication refresh-token fix.',
          release_target: 'v2.4.0',
          git_token_secret_ref: 'secret:GITHUB_TOKEN',
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
            stages: [
              { name: 'implementation', goal: 'Build the refresh-token fix' },
            ],
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
      roleConfig: {
        tools: ['file_read', 'git_diff', 'submit_handoff'],
      },
    };
  }

  it('builds a specialist brief from stages, continuity, and actual next-step state', () => {
    const brief = buildSpecialistExecutionBrief(buildInput());

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
        'reviewer is expected to assess the current output before the work item moves forward.',
      ]),
    );
    expect(brief?.likely_relevant_files).toEqual(['docs/release-notes.md', 'src/auth/refresh.ts']);
    expect(brief?.relevant_memory_refs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'release_note' }),
      ]),
    );
    expect(brief?.relevant_artifact_refs).toEqual([
      expect.objectContaining({
        artifact_id: 'artifact-release',
        logical_path: 'docs/release-notes.md',
      }),
    ]);
    expect(brief?.rendered_markdown).toContain('## Workflow Brief');
    expect(brief?.rendered_markdown).toContain(
      'Repository-backed task. Use task sandbox tools for repository, filesystem, shell, web fetch, and artifact upload work.',
    );
    expect(brief?.rendered_markdown).not.toContain('git_token_secret_ref');
    expect(brief?.rendered_markdown).not.toContain('secret:GITHUB_TOKEN');
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
    expect(brief?.rendered_markdown).not.toContain('Use task sandbox tools');
  });
});
