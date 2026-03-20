import { describe, expect, it } from 'vitest';

import { buildSpecialistExecutionBrief } from '../../src/services/specialist-execution-brief-service.js';

describe('buildSpecialistExecutionBrief', () => {
  it('builds a specialist workflow brief with task-scoped context and selected refs', () => {
    const brief = buildSpecialistExecutionBrief({
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
            process_instructions: 'Developer implements and reviewer validates before release.',
            board: {
              columns: [
                { id: 'review', label: 'In Review' },
                { id: 'done', label: 'Done', is_terminal: true },
              ],
            },
            checkpoints: [
              { name: 'implementation', goal: 'Build the refresh-token fix' },
            ],
            review_rules: [
              { from_role: 'developer', reviewed_by: 'reviewer', checkpoint: 'implementation', required: true },
            ],
          },
        },
      },
      workspace: {
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
        next_expected_action: 'review',
        latest_handoff_completion: 'partial',
        unresolved_findings: ['Check release note wording.'],
        review_focus: ['Refresh-token expiry path'],
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
    });

    expect(brief).not.toBeNull();
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
    expect(brief?.predecessor_handoff_summary).toEqual(
      expect.objectContaining({
        role: 'developer',
        summary: 'Implementation is ready for review and release-note validation.',
      }),
    );
    expect(brief?.likely_relevant_files).toEqual(['docs/release-notes.md', 'src/auth/refresh.ts']);
    expect(brief?.relevant_memory_refs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'release_note',
        }),
      ]),
    );
    expect(brief?.relevant_artifact_refs).toEqual([
      expect.objectContaining({
        artifact_id: 'artifact-release',
        logical_path: 'docs/release-notes.md',
      }),
    ]);
    expect(brief?.rendered_markdown).toContain('## Workflow Brief');
    expect(brief?.rendered_markdown).not.toContain('git_token_secret_ref');
    expect(brief?.rendered_markdown).not.toContain('secret:GITHUB_TOKEN');
  });
});
