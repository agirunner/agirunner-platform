import { createHash } from 'node:crypto';

import { parsePlaybookDefinition } from '../../orchestration/playbook-model.js';
import { type SpecialistRoleCapabilities } from '../specialist/specialist-capability-service.js';
import {
  asRecord,
  compactWorkflowBriefVariables,
  isRepositoryBacked,
  normalizeStrings,
  readGateField,
  readNumber,
  readString,
  readStringArray,
  selectLikelyRelevantFiles,
  selectRelevantArtifactRefs,
  selectRelevantMemoryRefs,
  summarizeRemoteMcpServers,
} from './brief-selection.js';
import { renderBrief } from './brief-rendering.js';

interface OperatorVisibilityContract {
  mode: string | null;
  workflow_id: string | null;
  work_item_id: string | null;
  task_id: string | null;
  execution_context_id: string | null;
  source_kind: string | null;
  record_operator_brief_tool: string | null;
  turn_update_scope: string | null;
  eligible_turn_guidance: string | null;
  operator_brief_request_id_prefix: string | null;
  milestone_briefs_required: boolean;
}

interface RepositoryRuntimeGuidance {
  language_family: 'javascript_typescript';
  preferred_verification_methods: string[];
  avoid_patterns: string[];
  runtime_recheck_required: boolean;
}

export interface SpecialistExecutionBrief {
  refresh_key: string;
  workflow_brief: {
    goal: string | null;
    launch_inputs: Array<{ key: string; value: string }>;
    omitted_input_count: number;
  };
  goal: string | null;
  acceptance_criteria: string[];
  current_focus: {
    lifecycle: 'planned' | 'ongoing';
    stage_name: string | null;
    stage_goal: string | null;
    board_position: string | null;
    next_expected_actor: string | null;
    next_expected_action: string | null;
  };
  predecessor_handoff_summary: {
    id: string | null;
    role: string | null;
    summary: string | null;
    successor_context: string | null;
  } | null;
  work_item_continuity_summary: {
    latest_handoff_completion: string | null;
    latest_handoff_resolution: string | null;
    unresolved_findings: string[];
    focus_areas: string[];
    known_risks: string[];
  };
  assessment_output_expectations: string[];
  repo_status_summary: string;
  repository_runtime_guidance: RepositoryRuntimeGuidance | null;
  likely_relevant_files: string[];
  verification_commands: string[];
  relevant_memory_refs: Array<{ key: string; summary: string | null; reason: string }>;
  relevant_artifact_refs: Array<{
    artifact_id: string;
    logical_path: string;
    title: string | null;
    reason: string;
  }>;
  remote_mcp_servers: Array<{
    name: string;
    description: string;
    capability_summary: {
      tool_count: number;
      resource_count: number;
      prompt_count: number;
    };
  }>;
  execution_environment_contract: {
    name: string | null;
    image: string | null;
    shell: string | null;
    package_manager: string | null;
    verified_baseline_commands: string[];
    agent_hint: string | null;
  } | null;
  operator_visibility: OperatorVisibilityContract | null;
  rendered_markdown: string;
}

export interface SpecialistExecutionBriefInput {
  role?: string | null;
  workflow?: Record<string, unknown> | null;
  workspace?: Record<string, unknown> | null;
  workItem?: Record<string, unknown> | null;
  predecessorHandoff?: Record<string, unknown> | null;
  taskInput?: Record<string, unknown> | null;
  roleConfig?: Record<string, unknown> | null;
  specialistCapabilities?: SpecialistRoleCapabilities | null;
  executionEnvironmentSnapshot?: Record<string, unknown> | null;
}

export function buildSpecialistExecutionBrief(
  input: SpecialistExecutionBriefInput,
): SpecialistExecutionBrief | null {
  const workflow = asRecord(input.workflow);
  const playbook = asRecord(workflow.playbook);
  const definitionValue = playbook.definition ?? workflow.playbook_definition;
  if (!definitionValue) {
    return null;
  }

  let definition;
  try {
    definition = parsePlaybookDefinition(definitionValue);
  } catch {
    return null;
  }

  const lifecycle = workflow.lifecycle === 'ongoing' ? 'ongoing' : 'planned';
  const workItem = asRecord(input.workItem);
  const predecessorHandoff = asRecord(input.predecessorHandoff);
  const workspace = asRecord(input.workspace);
  const taskInput = asRecord(input.taskInput);
  const roleConfig = asRecord(input.roleConfig);
  const specialistCapabilities = input.specialistCapabilities ?? null;
  const executionEnvironmentSnapshot = asRecord(input.executionEnvironmentSnapshot);
  const operatorVisibility = operatorVisibilityFrom(workflow);
  const stageName = readString(workItem.stage_name) ?? readString(workflow.current_stage);
  const stage = definition.stages.find((entry) => entry.name === stageName) ?? null;
  const boardColumn =
    definition.board.columns.find((entry) => entry.id === readString(workItem.column_id)) ?? null;
  const workflowBrief = compactWorkflowBriefVariables(asRecord(workflow.variables));
  const repoBacked = isRepositoryBacked(workspace, workflow, taskInput, roleConfig);
  const assessmentOutputExpectations = buildAssessmentOutputExpectations(
    workItem,
    input.role ?? null,
    repoBacked,
  );
  const likelyRelevantFiles = selectLikelyRelevantFiles(predecessorHandoff);
  const relevantMemoryRefs = selectRelevantMemoryRefs(workspace, [
    input.role,
    workflowBrief.goal,
    ...workflowBrief.launch_inputs.map((entry) => entry.value),
    readString(workItem.title),
    readString(workItem.goal),
    readString(taskInput.description),
    readString(predecessorHandoff.summary),
    readString(predecessorHandoff.successor_context),
    ...readStringArray(workItem.focus_areas),
  ]);
  const relevantArtifactRefs = selectRelevantArtifactRefs(workspace, [
    ...likelyRelevantFiles,
    workflowBrief.goal,
    readString(workItem.goal),
    readString(taskInput.description),
    readString(predecessorHandoff.summary),
    readString(predecessorHandoff.successor_context),
  ]);
  const executionEnvironmentContract = executionEnvironmentContractFrom(executionEnvironmentSnapshot);

  const brief: SpecialistExecutionBrief = {
    refresh_key: '',
    workflow_brief: workflowBrief,
    goal: readString(taskInput.description) ?? readString(workItem.goal) ?? workflowBrief.goal,
    acceptance_criteria: normalizeStrings(workItem.acceptance_criteria),
    current_focus: {
      lifecycle,
      stage_name: stage?.name ?? stageName ?? null,
      stage_goal: stage?.goal ?? null,
      board_position: boardColumn?.label ?? null,
      next_expected_actor: readString(workItem.next_expected_actor),
      next_expected_action: readString(workItem.next_expected_action),
    },
    predecessor_handoff_summary:
      Object.keys(predecessorHandoff).length === 0
        ? null
        : {
            id: readString(predecessorHandoff.id),
            role: readString(predecessorHandoff.role),
            summary: readString(predecessorHandoff.summary),
            successor_context: readString(predecessorHandoff.successor_context),
          },
    work_item_continuity_summary: continuitySummaryFrom(workItem),
    assessment_output_expectations: assessmentOutputExpectations,
    repo_status_summary: repoBacked
      ? 'Repository-backed task. Use Specialist Execution tools for repository, filesystem, shell, web fetch, and artifact upload work. Repo checkout and git are already present. Optional runtimes such as python3, bash, jq, or language-specific CLIs may be absent; verify or install them before use.'
      : 'Non-repository task. Base completion on artifacts, outputs, and recorded evidence.',
    repository_runtime_guidance: buildRepositoryRuntimeGuidance(
      repoBacked,
      likelyRelevantFiles,
      executionEnvironmentContract?.verified_baseline_commands ?? [],
    ),
    likely_relevant_files: likelyRelevantFiles,
    verification_commands: normalizeStrings(taskInput.verification_commands),
    relevant_memory_refs: relevantMemoryRefs,
    relevant_artifact_refs: relevantArtifactRefs,
    remote_mcp_servers: summarizeRemoteMcpServers(specialistCapabilities),
    execution_environment_contract: executionEnvironmentContract,
    operator_visibility: operatorVisibility,
    rendered_markdown: '',
  };
  brief.refresh_key = hashCanonicalJson(refreshInputsFrom(brief, workItem, predecessorHandoff));
  brief.rendered_markdown = renderBrief(brief, workItem);
  return brief;
}

function buildAssessmentOutputExpectations(
  workItem: Record<string, unknown>,
  role: string | null,
  repoBacked: boolean,
): string[] {
  const lines: string[] = [];
  const actor = readString(workItem.next_expected_actor);
  const action = readString(workItem.next_expected_action);
  if (action === 'assess' && actor) {
    lines.push(`Expected review actor: ${actor}.`);
    lines.push(`${actor} should assess the current output before the work item moves forward.`);
  } else if (action === 'approve') {
    lines.push('A human approval step is active for this work item.');
  } else if (action === 'handoff' && actor) {
    lines.push(`Prepare a clear successor handoff for ${actor}.`);
  } else if (action === 'rework' && actor) {
    lines.push(`The current output is in rework for ${actor}. Address the requested changes.`);
  }
  void role;
  lines.push(
    'Submitting your handoff does not itself close the work item or workflow. The orchestrator closes workflow state only after current-subject evidence is complete and reviewed.',
  );
  lines.push(
    repoBacked
      ? 'Repository-backed output must be committed and pushed before completion or escalation.'
      : 'Required artifacts must be uploaded before completion or escalation.',
  );
  return lines;
}

function executionEnvironmentContractFrom(snapshot: Record<string, unknown>) {
  if (Object.keys(snapshot).length === 0) {
    return null;
  }

  const verifiedMetadata = asRecord(snapshot.verified_metadata);
  const toolCapabilities = asRecord(snapshot.tool_capabilities);
  return {
    name: readString(snapshot.name),
    image: readString(snapshot.image),
    shell: readString(verifiedMetadata.shell),
    package_manager: readString(verifiedMetadata.package_manager),
    verified_baseline_commands: readStringArray(toolCapabilities.verified_baseline_commands),
    agent_hint: readString(snapshot.agent_hint),
  };
}

function buildRepositoryRuntimeGuidance(
  repoBacked: boolean,
  likelyRelevantFiles: string[],
  verifiedBaselineCommands: string[],
): RepositoryRuntimeGuidance | null {
  if (!repoBacked) {
    return null;
  }
  const hasJavaScriptOrTypeScriptSurface = likelyRelevantFiles.some((path) => /\.[cm]?[jt]sx?$/.test(path));
  const hasNodeRuntime = verifiedBaselineCommands.some((command) =>
    ['node', 'npm', 'pnpm', 'yarn', 'bun'].includes(command),
  );
  if (!hasJavaScriptOrTypeScriptSurface) {
    return null;
  }
  return {
    language_family: 'javascript_typescript',
    preferred_verification_methods: hasNodeRuntime
      ? ['repo_native_commands', 'direct_module_execution']
      : ['repo_native_commands'],
    avoid_patterns: ['ad_hoc_source_rewrite_eval'],
    runtime_recheck_required: true,
  };
}

function continuitySummaryFrom(workItem: Record<string, unknown>) {
  return {
    latest_handoff_completion: readString(workItem.latest_handoff_completion),
    latest_handoff_resolution: readString(workItem.latest_handoff_resolution),
    unresolved_findings: readStringArray(workItem.unresolved_findings),
    focus_areas: readStringArray(workItem.focus_areas),
    known_risks: readStringArray(workItem.known_risks),
  };
}

function refreshInputsFrom(
  brief: SpecialistExecutionBrief,
  workItem: Record<string, unknown>,
  predecessorHandoff: Record<string, unknown>,
) {
  return {
    workflow_brief: brief.workflow_brief,
    goal: brief.goal,
    acceptance_criteria: brief.acceptance_criteria,
    current_focus: brief.current_focus,
    predecessor_handoff_summary: brief.predecessor_handoff_summary,
    predecessor_handoff_paths: selectLikelyRelevantFiles(predecessorHandoff),
    work_item_boundary_state: {
      stage_name: readString(workItem.stage_name),
      column_id: readString(workItem.column_id),
      next_expected_actor: readString(workItem.next_expected_actor),
      next_expected_action: readString(workItem.next_expected_action),
      rework_count: readNumber(workItem.rework_count),
      priority: readNumber(workItem.priority),
      continuity: asRecord(workItem.continuity),
      gate_status: readGateField(workItem, 'gate_status'),
      gate_decision_feedback: readGateField(workItem, 'gate_decision_feedback'),
      gate_decided_at: readGateField(workItem, 'gate_decided_at'),
    },
    work_item_continuity_summary: brief.work_item_continuity_summary,
    assessment_output_expectations: brief.assessment_output_expectations,
    repository_runtime_guidance: brief.repository_runtime_guidance,
    likely_relevant_files: brief.likely_relevant_files,
    verification_commands: brief.verification_commands,
    relevant_memory_refs: brief.relevant_memory_refs.map((entry) => entry.key),
    relevant_artifact_refs: brief.relevant_artifact_refs.map((entry) => entry.artifact_id),
    remote_mcp_servers: brief.remote_mcp_servers,
    operator_visibility: brief.operator_visibility,
  };
}

function operatorVisibilityFrom(
  workflow: Record<string, unknown>,
): OperatorVisibilityContract | null {
  const liveVisibility = asRecord(workflow.live_visibility);
  if (Object.keys(liveVisibility).length === 0) {
    return null;
  }
  const executionContextId = readString(liveVisibility.execution_context_id);
  return {
    mode: readString(liveVisibility.mode),
    workflow_id: readString(liveVisibility.workflow_id),
    work_item_id: readString(liveVisibility.work_item_id),
    task_id: readString(liveVisibility.task_id),
    execution_context_id: executionContextId,
    source_kind: readString(liveVisibility.source_kind),
    record_operator_brief_tool: readString(liveVisibility.record_operator_brief_tool),
    turn_update_scope: null,
    eligible_turn_guidance: null,
    operator_brief_request_id_prefix:
      readString(liveVisibility.operator_brief_request_id_prefix) ??
      (executionContextId ? `operator-brief:${executionContextId}:` : null),
    milestone_briefs_required: Boolean(liveVisibility.milestone_briefs_required),
  };
}

function hashCanonicalJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
