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
        name: 'Alpine Base',
        image: 'alpine:3.23',
        agent_hint: [
          'Execution environment: Alpine Base',
          'Image: alpine:3.23',
          'Package manager: apk',
          'Shell: /bin/sh',
          'Verified baseline commands: sh, cat, grep',
        ].join('\n'),
        verified_metadata: {
          package_manager: 'apk',
          shell: '/bin/sh',
          detected_runtimes: [],
        },
        tool_capabilities: {
          verified_baseline_commands: ['sh', 'cat', 'grep'],
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
      expect.arrayContaining([expect.objectContaining({ key: 'release_note' })]),
    );
    expect(brief?.relevant_artifact_refs).toEqual([
      expect.objectContaining({
        artifact_id: 'artifact-release',
        logical_path: 'docs/release-notes.md',
      }),
    ]);
    expect(brief?.rendered_markdown).toContain('## Workflow Brief');
    expect(brief?.rendered_markdown).toContain('## Completion Expectations');
    expect(brief?.rendered_markdown).toContain('## Operator Visibility');
    expect(brief?.rendered_markdown).toContain('Live visibility mode: enhanced');
    expect(brief?.rendered_markdown).toContain('Workflow id: workflow-1');
    expect(brief?.rendered_markdown).toContain('Work item id: wi-1');
    expect(brief?.rendered_markdown).toContain('Task id: task-review-1');
    expect(brief?.rendered_markdown).toContain('Execution context id: task-review-1');
    expect(brief?.rendered_markdown).toContain(
      'Every operator record write must include a unique request_id.',
    );
    expect(brief?.rendered_markdown).toContain(
      'submit_handoff is the required task-completion write on this task. record_operator_brief never satisfies that completion contract.',
    );
    expect(brief?.rendered_markdown).toContain(
      'Use request_id values with the pattern handoff:task-review-1:r0:<handoff-slug> for submit_handoff writes on this task.',
    );
    expect(brief?.rendered_markdown).toContain(
      'workflow_id, work_item_id, and task_id are never top-level submit_handoff fields.',
    );
    expect(brief?.rendered_markdown).toContain('record_operator_brief');
    expect(brief?.rendered_markdown).toContain(
      'record_operator_brief payload must include short_brief and detailed_brief_json objects.',
    );
    expect(brief?.rendered_markdown).toContain('short_brief must include a headline.');
    expect(brief?.rendered_markdown).toContain(
      'record_operator_brief requires short_brief.headline plus detailed_brief_json.headline and status_kind, and must never be called with only linked_target_ids or an empty brief shell.',
    );
    expect(brief?.rendered_markdown).toContain(
      'Use brief_kind "milestone" for in-flight progress or handoff summaries. Use brief_kind "terminal" only for the final workflow outcome summary.',
    );
    expect(brief?.rendered_markdown).toContain(
      'Brief headlines and summaries must stay human-readable, describe the real workflow progress, and use titles instead of UUIDs or internal handles whenever titles exist.',
    );
    expect(brief?.rendered_markdown).toContain(
      'detailed_brief_json must include headline and status_kind and should carry the fuller human-readable summary and sections.',
    );
    expect(brief?.rendered_markdown).toContain(
      'Example: { payload: { short_brief: { headline: "Rollback review is ready for approval." }, detailed_brief_json: { headline: "Rollback review is ready for approval.", status_kind: "in_progress", summary: "Rollback handling passed review and is ready for approval.", sections: { validation: ["Verified rollback path against the current implementation."] } } } }',
    );
    expect(brief?.rendered_markdown).toContain(
      'Submitting your handoff does not itself close the work item or workflow.',
    );
    expect(brief?.rendered_markdown).toContain('## Path Discipline');
    expect(brief?.rendered_markdown).toContain(
      `Tool arguments must be repo-relative: use workflow_cli/__main__.py, tests/test_cli.py, or README.md; never repo/workflow_cli/__main__.py, repo/tests/test_cli.py, repo/README.md, or ${taskWorkspaceRoot} paths.`,
    );
    expect(brief?.rendered_markdown).toContain(
      'If a discovered or copied repository path starts with repo/, strip that leading repo/ segment before calling any file tool.',
    );
    expect(brief?.rendered_markdown).toContain(
      'If task input, predecessor handoff, or linked deliverables name an exact repo-relative path, treat that path as authoritative.',
    );
    expect(brief?.rendered_markdown).toContain(
      'Read that exact path first, and if it is missing, use file_list, glob, grep, or git discovery to find the current equivalent before trying alternate filenames.',
    );
    expect(brief?.rendered_markdown).toContain(
      'If the current repository file set is unknown, start with file_list, glob, grep, or git discovery before the first direct repo file_read.',
    );
    expect(brief?.rendered_markdown).toContain(
      'Do not probe guessed filenames just to learn whether they exist.',
    );
    expect(brief?.rendered_markdown).toContain(
      'When a file is already modified or you already changed it earlier in this task, never paraphrase old_text from memory.',
    );
    expect(brief?.rendered_markdown).toContain(
      'Copy the exact current snippet from the latest file_read before using file_edit.',
    );
    expect(brief?.rendered_markdown).toContain(
      'If you need multiple prose, bullet, or table edits in an already-modified file, prefer one fresh file_write over a chain of fragile file_edit calls.',
    );
    expect(brief?.rendered_markdown).toContain(
      'Read task context files from `/workspace/context/...`, never `context/...`, `repo/context/...`, or `/tmp/workspace/...` paths.',
    );
    expect(brief?.rendered_markdown).toContain(
      'Prefer file_read, file_list, glob, or grep for context files instead of shelling them directly.',
    );
    expect(brief?.rendered_markdown).toContain(
      'If an ad hoc script needs to import repository files, write that script inside the repo or use absolute/file-URL imports.',
    );
    expect(brief?.rendered_markdown).toContain(
      'Do not put importable scripts in `/tmp` and then use `./src/...` or other repo-relative imports, because those imports resolve relative to the script file, not your shell cwd.',
    );
    expect(brief?.rendered_markdown).toContain(
      'If you write task-local working files such as `output/...`, upload or persist the real deliverable and cite artifact ids, logical paths, repo-relative deliverables, memory keys, or workflow/task ids in the final handoff instead of that task-local path.',
    );
    expect(brief?.rendered_markdown).toContain(
      'If uploaded artifacts support the deliverable or handoff, include their UUIDs in submit_handoff.artifact_ids',
    );
    expect(brief?.rendered_markdown).toContain(
      'artifact_read and artifact_document_read are keyed by artifact id.',
    );
    expect(brief?.rendered_markdown).toContain(
      'Prefer artifact_document_read for readable text artifacts.',
    );
    expect(brief?.rendered_markdown).toContain(
      'Do not arbitrarily cap artifact_list, file_list, memory/history, or similar discovery reads to 20 entries.',
    );
    expect(brief?.rendered_markdown).toContain(
      'Repository-backed task. Use Specialist Execution tools for repository, filesystem, shell, web fetch, and artifact upload work. The image already includes repo checkout and git, but optional runtimes such as python3, bash, jq, or language-specific CLIs may be absent; probe them first or install them before chaining them into commands.',
    );
    expect(brief?.rendered_markdown).toContain('## Execution Environment Contract');
    expect(brief?.rendered_markdown).toContain('Execution environment: Alpine Base');
    expect(brief?.rendered_markdown).toContain('Package manager: apk');
    expect(brief?.rendered_markdown).toContain('Shell: /bin/sh');
    expect(brief?.rendered_markdown).toContain('Verified baseline commands: sh, cat, grep');
    expect(brief?.rendered_markdown).toContain(
      'Use the declared shell and interpreter contract when invoking scripts. Do not force sh ./script on a bash-oriented script; inspect the shebang or script contents first and install the required interpreter when it is missing.',
    );
    expect(brief?.rendered_markdown).toContain('## Remote MCP Servers');
    expect(brief?.rendered_markdown).toContain('Tavily Search');
    expect(brief?.rendered_markdown).toContain(
      'Verified capabilities: 2 tools, 1 resource, 0 prompts.',
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

  it('renders handoff request_id guidance with the current rework count', () => {
    const brief = buildSpecialistExecutionBrief({
      ...buildInput(),
      workItem: {
        ...buildInput().workItem,
        rework_count: 3,
      },
    });

    expect(brief?.rendered_markdown).toContain(
      'Use request_id values with the pattern handoff:task-review-1:r3:<handoff-slug> for submit_handoff writes on this task.',
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
    expect(brief?.rendered_markdown).not.toContain('Use task sandbox tools');
  });
});
