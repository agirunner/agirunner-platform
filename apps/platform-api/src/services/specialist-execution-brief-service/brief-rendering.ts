import type { SpecialistExecutionBrief } from './brief-shaping.js';
import { readNonNegativeInteger } from './brief-selection.js';

export function renderBrief(
  brief: SpecialistExecutionBrief,
  workItem: Record<string, unknown>,
): string {
  const lines: string[] = [];
  if (brief.workflow_brief.goal || brief.workflow_brief.launch_inputs.length > 0) {
    lines.push('## Workflow Brief');
    if (brief.workflow_brief.goal) {
      lines.push(`Goal: ${brief.workflow_brief.goal}`);
    }
    if (brief.workflow_brief.launch_inputs.length > 0) {
      lines.push('Launch inputs:');
      for (const entry of brief.workflow_brief.launch_inputs) {
        lines.push(`- ${entry.key}: ${entry.value}`);
      }
    }
  }
  lines.push('## Current Focus');
  lines.push(`Lifecycle: ${brief.current_focus.lifecycle}`);
  if (brief.current_focus.stage_name) lines.push(`Stage: ${brief.current_focus.stage_name}`);
  if (brief.current_focus.stage_goal) lines.push(`Stage goal: ${brief.current_focus.stage_goal}`);
  if (brief.current_focus.board_position) lines.push(`Board position: ${brief.current_focus.board_position}`);
  if (brief.goal || brief.acceptance_criteria.length > 0) {
    lines.push('', '## Task Contract');
    if (brief.goal) {
      lines.push(`Goal: ${brief.goal}`);
    }
    if (brief.acceptance_criteria.length > 0) {
      lines.push('Acceptance criteria:');
      lines.push(...brief.acceptance_criteria.map((line) => `- ${line}`));
    }
  }
  if (brief.predecessor_handoff_summary?.summary) {
    lines.push('', '## Predecessor Context');
    lines.push(`Summary: ${brief.predecessor_handoff_summary.summary}`);
    if (brief.predecessor_handoff_summary.successor_context) {
      lines.push(`Focus: ${brief.predecessor_handoff_summary.successor_context}`);
    }
  }
  if (brief.likely_relevant_files.length > 0) {
    lines.push('', '## Likely Relevant Files');
    lines.push(...brief.likely_relevant_files.map((path) => `- ${path}`));
  }
  if (brief.assessment_output_expectations.length > 0) {
    lines.push('', '## Completion Expectations');
    lines.push(...brief.assessment_output_expectations.map((line) => `- ${line}`));
  }
  if (brief.operator_visibility) {
    lines.push('', '## Operator Visibility');
    if (brief.operator_visibility.mode) {
      lines.push(`Live visibility mode: ${brief.operator_visibility.mode}`);
    }
    if (brief.operator_visibility.workflow_id) {
      lines.push(`Workflow id: ${brief.operator_visibility.workflow_id}`);
    }
    if (brief.operator_visibility.work_item_id) {
      lines.push(`Work item id: ${brief.operator_visibility.work_item_id}`);
    }
    if (brief.operator_visibility.task_id) {
      lines.push(`Task id: ${brief.operator_visibility.task_id}`);
    }
    if (brief.operator_visibility.execution_context_id) {
      lines.push(`Execution context id: ${brief.operator_visibility.execution_context_id}`);
    }
    lines.push(
      'Every operator record write must include a unique request_id. Reuse a request_id only for an intentional retry of the same write.',
    );
    if (brief.operator_visibility.task_id) {
      const reworkCount = readNonNegativeInteger(workItem.rework_count);
      lines.push(
        'submit_handoff is the required completion write on this task. record_operator_brief never satisfies that contract.',
      );
      lines.push(
        `Use request_id values with the pattern handoff:${brief.operator_visibility.task_id}:r${reworkCount}:<handoff-slug> for submit_handoff writes on this task. Include the current rework count so later rework attempts do not collide. Reuse the same request_id only for an intentional retry of that exact same handoff payload.`,
      );
      lines.push(
        'workflow_id, work_item_id, and task_id are never top-level submit_handoff fields. Those ids come from current task context and execution linkage, not from handoff payload guesswork.',
      );
    }
    lines.push(
      'Enhanced live visibility streams automatically from execution output. Do not add reporting steps just to keep the console moving.',
    );
    lines.push(
      'If you do not already have the exact scoped workflow_id, work_item_id, or task_id from this contract, omit those optional ids and let the runtime derive canonical linkage from execution_context_id. Never guess them.',
    );
    lines.push(
      'Operator briefs and live-console phase lines are console text, not audit logs: keep them human-readable, use titles and roles when available, and never dump tool chatter, phases, JSON, UUIDs, or lines like "Ran File Read", "tool_failure", or "executed 2 tools".',
    );
    if (
      brief.operator_visibility.milestone_briefs_required &&
      brief.operator_visibility.record_operator_brief_tool
    ) {
      if (brief.operator_visibility.operator_brief_request_id_prefix) {
        lines.push(
          `Use ${brief.operator_visibility.operator_brief_request_id_prefix} as the stable request_id prefix for ${brief.operator_visibility.record_operator_brief_tool} writes in this execution context.`,
        );
      }
      lines.push(
        `Use ${brief.operator_visibility.record_operator_brief_tool} for material handoff or milestone summaries when the platform requests them.`,
      );
      lines.push(
        `If this task reaches a meaningful completion, handoff, approval, or output checkpoint without the required ${brief.operator_visibility.record_operator_brief_tool}, completion will be rejected recoverably until you emit it.`,
      );
      lines.push(
        'Use brief_kind "milestone" for in-flight progress or handoff summaries. Use brief_kind "terminal" only for the final workflow outcome summary.',
      );
      lines.push(
        `${brief.operator_visibility.record_operator_brief_tool} payload must include short_brief and detailed_brief_json objects.`,
      );
      lines.push('short_brief must include a headline.');
      lines.push(
        'record_operator_brief requires short_brief.headline plus detailed_brief_json.headline and status_kind, and must never be called with only linked_target_ids or an empty brief shell.',
      );
      lines.push(
        'If payload.linked_deliverables uses the shorthand path form, every entry must include both label and path. Path-only shorthand entries are invalid.',
      );
      lines.push(
        'Brief headlines and summaries must stay human-readable, describe the real workflow progress, and use titles instead of UUIDs or internal handles whenever titles exist.',
      );
      lines.push(
        'detailed_brief_json must include headline and status_kind and should carry the fuller summary and sections.',
      );
      lines.push(
        'Example: { payload: { short_brief: { headline: "Rollback review is ready for approval." }, detailed_brief_json: { headline: "Rollback review is ready for approval.", status_kind: "in_progress", summary: "Rollback handling is ready for approval.", sections: { validation: ["Verified the rollback path against the current implementation."] } } } }',
      );
    }
  }
  lines.push('', '## Path Discipline');
  lines.push(pathDisciplineGuidance(brief.repo_status_summary.startsWith('Repository-backed task.')));
  lines.push(
    'If uploaded artifacts support the deliverable or handoff, include their UUIDs in submit_handoff.artifact_ids so downstream work can resolve the exact persisted artifact without guessing.',
  );
  lines.push(
    'artifact_read and artifact_document_read are keyed by artifact id. If you only know a logical path, resolve the artifact id from artifact_list or the provided artifact references first. Prefer artifact_document_read for readable text artifacts.',
  );
  lines.push(
    'Do not arbitrarily cap artifact_list, file_list, memory/history, or similar discovery reads to 20 entries. Omit limit unless you intentionally need a smaller window, and request a larger page when completeness matters.',
  );
  if (brief.execution_environment_contract?.agent_hint) {
    lines.push('', '## Execution Environment Contract');
    lines.push(brief.execution_environment_contract.agent_hint);
    lines.push(
      'Use the declared shell and interpreter contract when invoking scripts. Do not force sh ./script on a bash-oriented script; inspect the shebang or script contents first and install the required interpreter when it is missing.',
    );
  }
  if (brief.repository_runtime_guidance) {
    lines.push('', '## Repository Runtime Guidance');
    lines.push(
      `Preferred verification methods: ${brief.repository_runtime_guidance.preferred_verification_methods.join(', ')}`,
    );
    for (const rule of brief.repository_runtime_guidance.failure_recovery_contracts) {
      lines.push(repositoryFailureRecoveryGuidance(rule));
    }
    lines.push(`Avoid: ${brief.repository_runtime_guidance.avoid_patterns.join(', ')}`);
    if (brief.repository_runtime_guidance.runtime_recheck_required) {
      lines.push(
        'Before inventing fallback probes, re-check the repo-native command surface and direct module/runtime path that the execution environment already supports.',
      );
    }
  }
  if (brief.remote_mcp_servers.length > 0) {
    lines.push('', '## Remote MCP Servers');
    lines.push(
      ...brief.remote_mcp_servers.map(
        (server) =>
          `- ${server.name}: ${server.description} Verified capabilities: ${formatCapabilityCounts(server.capability_summary)}.`.trim(),
      ),
    );
  }
  if (brief.repo_status_summary) {
    lines.push('', '## Execution Surface');
    lines.push(brief.repo_status_summary);
  }
  return lines.join('\n');
}

export function pathDisciplineGuidance(repoBacked: boolean) {
  if (repoBacked) {
    return 'For repository-backed tasks, the repo root is already the base path. Tool arguments must be repo-relative: use workflow_cli/__main__.py, tests/test_cli.py, or README.md; never repo/workflow_cli/__main__.py, repo/tests/test_cli.py, repo/README.md, or /tmp/workspace paths. If a discovered or copied repository path starts with repo/, strip that leading repo/ segment before calling any file tool. If task input, predecessor handoff, or linked deliverables name an exact repo-relative path, treat that path as authoritative. Read that exact path first, and if it is missing, use file_list, glob, grep, or git discovery to find the current equivalent before trying alternate filenames. If the current repository file set is unknown, start with file_list, glob, grep, or git discovery before the first direct repo file_read. Do not probe guessed filenames just to learn whether they exist. When a file is already modified or you already changed it earlier in this task, never paraphrase old_text from memory. Copy the exact current snippet from the latest file_read before using file_edit. If you need multiple prose, bullet, or table edits in an already-modified file, prefer one fresh file_write over a chain of fragile file_edit calls. Read task context files from `/workspace/context/...`, never `context/...`, `repo/context/...`, or `/tmp/workspace/...` paths. Prefer file_read, file_list, glob, or grep for context files instead of shelling them directly. If an ad hoc script needs to import repository files, write that script inside the repo or use absolute/file-URL imports. Do not put importable scripts in `/tmp` and then use `./src/...` or other repo-relative imports, because those imports resolve relative to the script file, not your shell cwd. If you write task-local working files such as `output/...`, upload or persist the real deliverable and cite artifact ids, logical paths, repo-relative deliverables, memory keys, or workflow/task ids in the final handoff instead of that task-local path.';
  }
  return 'For non-repository tasks, use workspace-relative paths for tool work only, never host-local or /tmp/workspace paths. If you write task-local working files such as `output/...`, upload or persist the real deliverable and cite artifact ids, logical paths, memory keys, or workflow/task ids in the final handoff instead of that task-local path.';
}

export function formatCapabilityCounts(value: {
  tool_count: number;
  resource_count: number;
  prompt_count: number;
}): string {
  return [
    pluralizeCapability(value.tool_count, 'tool'),
    pluralizeCapability(value.resource_count, 'resource'),
    pluralizeCapability(value.prompt_count, 'prompt'),
  ].join(', ');
}

function pluralizeCapability(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

function repositoryFailureRecoveryGuidance(rule: string): string {
  switch (rule) {
    case 'investigate_failed_commands_before_retry':
      return 'If a command fails, inspect the error before retrying. Determine whether the command is wrong, the path or input is wrong, the dependency or runtime is missing, or the repo expects a different entrypoint.';
    case 'prefer_repo_native_commands_before_ad_hoc_probes':
      return 'Prefer repo-native scripts, tests, build commands, or documented entrypoints before inventing ad hoc probes, source rewrites, or fragile one-off commands.';
    case 'check_runtime_or_dependency_availability':
      return 'If a command appears unavailable, verify whether the needed interpreter, package manager, dependency, or CLI is missing and install or invoke the correct tool before escalating.';
    default:
      return `Failure-recovery rule: ${rule}`;
  }
}
