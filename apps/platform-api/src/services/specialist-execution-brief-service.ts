import { createHash } from 'node:crypto';

import { parsePlaybookDefinition } from '../orchestration/playbook-model.js';
import {
  summarizeRemoteMcpToolNames,
  type SpecialistRoleCapabilities,
} from './specialist-capability-service.js';
import { roleConfigOwnsRepositorySurface } from './tool-tag-service.js';

interface ExecutionBriefRef {
  reason: string;
}

interface MemoryRef extends ExecutionBriefRef {
  key: string;
  summary: string | null;
}

interface ArtifactRef extends ExecutionBriefRef {
  artifact_id: string;
  logical_path: string;
  title: string | null;
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
  likely_relevant_files: string[];
  verification_commands: string[];
  relevant_memory_refs: MemoryRef[];
  relevant_artifact_refs: ArtifactRef[];
  remote_mcp_servers: Array<{
    name: string;
    description: string;
    tool_names: string[];
  }>;
  execution_environment_contract: {
    name: string | null;
    image: string | null;
    shell: string | null;
    package_manager: string | null;
    verified_baseline_commands: string[];
    agent_hint: string | null;
  } | null;
  rendered_markdown: string;
}

interface SpecialistExecutionBriefInput {
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
  const stageName = readString(workItem.stage_name) ?? readString(workflow.current_stage);
  const stage = definition.stages.find((entry) => entry.name === stageName) ?? null;
  const boardColumn = definition.board.columns.find((entry) => entry.id === readString(workItem.column_id)) ?? null;
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
    predecessor_handoff_summary: Object.keys(predecessorHandoff).length === 0
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
      ? 'Repository-backed task. Use Specialist Execution tools for repository, filesystem, shell, web fetch, and artifact upload work. The image already includes repo checkout and git, but optional runtimes such as python3, bash, jq, or language-specific CLIs may be absent; probe them first or install them before chaining them into commands.'
      : 'Non-repository task. Base completion on artifacts, outputs, and recorded evidence.',
    likely_relevant_files: likelyRelevantFiles,
    verification_commands: normalizeStrings(taskInput.verification_commands),
    relevant_memory_refs: relevantMemoryRefs,
    relevant_artifact_refs: relevantArtifactRefs,
    remote_mcp_servers: summarizeRemoteMcpServers(specialistCapabilities),
    execution_environment_contract: executionEnvironmentContractFrom(executionEnvironmentSnapshot),
    rendered_markdown: '',
  };
  brief.refresh_key = hashCanonicalJson(refreshInputsFrom(brief, workItem, predecessorHandoff));
  brief.rendered_markdown = renderBrief(brief);
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
    lines.push(`${actor} is expected to assess the current output before the work item moves forward.`);
  } else if (action === 'approve') {
    lines.push('A human approval step is currently active for this work item.');
  } else if (action === 'handoff' && actor) {
    lines.push(`Prepare a clear successor handoff for ${actor}.`);
  } else if (action === 'rework' && actor) {
    lines.push(`The current output is in rework for ${actor}. Address the requested changes directly.`);
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

function renderBrief(brief: SpecialistExecutionBrief): string {
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
  lines.push('', '## Path Discipline');
  lines.push(pathDisciplineGuidance(brief.repo_status_summary.startsWith('Repository-backed task.')));
  if (brief.execution_environment_contract?.agent_hint) {
    lines.push('', '## Execution Environment Contract');
    lines.push(brief.execution_environment_contract.agent_hint);
    lines.push(
      'Use the declared shell and interpreter contract when invoking scripts. Do not force sh ./script on a bash-oriented script; inspect the shebang or script contents first and install the required interpreter when it is missing.',
    );
  }
  if (brief.remote_mcp_servers.length > 0) {
    lines.push('', '## Remote MCP Servers');
    lines.push(
      ...brief.remote_mcp_servers.map((server) =>
        `- ${server.name}: ${server.description} Tools: ${server.tool_names.join(', ')}`.trim(),
      ),
    );
  }
  if (brief.repo_status_summary) {
    lines.push('', '## Execution Surface');
    lines.push(brief.repo_status_summary);
  }
  return lines.join('\n');
}

function pathDisciplineGuidance(repoBacked: boolean) {
  if (repoBacked) {
    return 'For repository-backed tasks, the repo root is already the base path. Tool arguments must be repo-relative: use workflow_cli/__main__.py, tests/test_cli.py, or README.md; never repo/workflow_cli/__main__.py, repo/tests/test_cli.py, repo/README.md, or /tmp/workspace paths. If a discovered or copied repository path starts with repo/, strip that leading repo/ segment before calling any file tool. Read task context files from `/workspace/context/...`, never `context/...` or `repo/context/...`. If you write task-local working files such as `output/...`, upload or persist the real deliverable and cite artifact ids, logical paths, repo-relative deliverables, memory keys, or workflow/task ids in the final handoff instead of that task-local path.';
  }
  return 'For non-repository tasks, use workspace-relative paths for tool work only, never host-local or /tmp/workspace paths. If you write task-local working files such as `output/...`, upload or persist the real deliverable and cite artifact ids, logical paths, memory keys, or workflow/task ids in the final handoff instead of that task-local path.';
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
    likely_relevant_files: brief.likely_relevant_files,
    verification_commands: brief.verification_commands,
    relevant_memory_refs: brief.relevant_memory_refs.map((entry) => entry.key),
    relevant_artifact_refs: brief.relevant_artifact_refs.map((entry) => entry.artifact_id),
    remote_mcp_servers: brief.remote_mcp_servers,
  };
}

function summarizeRemoteMcpServers(capabilities: SpecialistRoleCapabilities | null) {
  if (!capabilities) {
    return [];
  }
  return capabilities.remoteMcpServers.map((server) => ({
    name: server.name,
    description: server.description,
    tool_names: summarizeRemoteMcpToolNames(server.discoveredToolsSnapshot),
  }));
}

function selectLikelyRelevantFiles(predecessorHandoff: Record<string, unknown>) {
  const changes = Array.isArray(predecessorHandoff.changes) ? predecessorHandoff.changes : [];
  return [...new Set(
    changes
      .map((entry) => readString(asRecord(entry).path))
      .filter((entry): entry is string => Boolean(entry)),
  )].sort();
}

function selectRelevantMemoryRefs(workspace: Record<string, unknown>, hints: Array<string | null | undefined>): MemoryRef[] {
  const memory = asRecord(workspace.memory);
  const keys = readStringArray(asRecord(workspace.memory_index).keys);
  const tokens = buildHintTokens(hints);
  return keys
    .map((key) => ({
      key,
      score: scoreMatch([key, summarizeValue(memory[key])], tokens),
      summary: summarizeValue(memory[key]),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.key.localeCompare(right.key))
    .slice(0, 5)
    .map(({ key, summary }) => ({
      key,
      summary,
      reason: `Matched current task context on "${bestReasonToken([key, summary], tokens)}".`,
    }));
}

function selectRelevantArtifactRefs(workspace: Record<string, unknown>, hints: Array<string | null | undefined>): ArtifactRef[] {
  const items = Array.isArray(asRecord(workspace.artifact_index).items)
    ? asRecord(workspace.artifact_index).items as unknown[]
    : [];
  const tokens = buildHintTokens(hints);
  return items
    .map((entry): { artifact_id: string; logical_path: string; title: string | null; score: number } => {
      const record = asRecord(entry);
      const logicalPath = readString(record.logical_path) ?? '';
      return {
        artifact_id: readString(record.artifact_id) ?? '',
        logical_path: logicalPath,
        title: logicalPath || null,
        score: scoreMatch([logicalPath], tokens),
      };
    })
    .filter((entry) => entry.artifact_id.length > 0 && entry.score > 0)
    .sort((left, right) => right.score - left.score || left.logical_path.localeCompare(right.logical_path))
    .slice(0, 5)
    .map((entry): ArtifactRef => ({
      artifact_id: entry.artifact_id,
      logical_path: entry.logical_path,
      title: entry.title,
      reason: `Matched current task context on "${bestReasonToken([entry.logical_path], tokens)}".`,
    }));
}

function compactWorkflowBriefVariables(variables: Record<string, unknown>) {
  const preferredGoalKeys = new Set(['goal', 'objective', 'outcome', 'brief', 'deliverable']);
  const visibleEntries = Object.entries(variables)
    .filter(([key, value]) => shouldExposeWorkflowVariable(key, value))
    .map(([key, value]) => ({ key, value: formatWorkflowVariable(value) }))
    .filter((entry): entry is { key: string; value: string } => entry.value !== null);
  const goalEntry = visibleEntries.find((entry) => preferredGoalKeys.has(entry.key));
  const nonGoalEntries = visibleEntries.filter((entry) => !preferredGoalKeys.has(entry.key));
  return {
    goal: goalEntry?.value ?? null,
    launch_inputs: nonGoalEntries.slice(0, 8),
    omitted_input_count: Math.max(nonGoalEntries.length - 8, 0),
  };
}

function readGateField(workItem: Record<string, unknown>, key: string) {
  const direct = readString(workItem[key]);
  if (direct) {
    return direct;
  }
  const metadata = asRecord(workItem.metadata);
  const stageGate = asRecord(metadata.stage_gate);
  return readString(metadata[key]) ?? readString(stageGate[key]);
}

function buildHintTokens(hints: Array<string | null | undefined>) {
  const stopWords = new Set([
    'the',
    'and',
    'for',
    'with',
    'that',
    'this',
    'from',
    'into',
    'before',
    'after',
    'should',
    'current',
    'task',
    'work',
    'note',
    'notes',
    'docs',
    'doc',
    'src',
  ]);
  return [...new Set(
    hints
      .flatMap((value) => String(value ?? '').toLowerCase().split(/[^a-z0-9]+/))
      .filter((token) => token.length >= 4 && !stopWords.has(token)),
  )];
}

function scoreMatch(values: Array<string | null>, tokens: string[]) {
  const haystack = values.filter(Boolean).join(' ').toLowerCase();
  return tokens.reduce((score, token) => (haystack.includes(token) ? score + 1 : score), 0);
}

function bestReasonToken(values: Array<string | null>, tokens: string[]) {
  const haystack = values.filter(Boolean).join(' ').toLowerCase();
  return tokens.find((token) => haystack.includes(token)) ?? 'task';
}

function shouldExposeWorkflowVariable(key: string, value: unknown) {
  if (isSecretLikeKey(key) || isSecretLikeValue(value)) return false;
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return typeof value === 'number' || typeof value === 'boolean';
}

function isRepositoryBacked(
  workspace: Record<string, unknown>,
  workflow: Record<string, unknown>,
  taskInput: Record<string, unknown>,
  roleConfig: Record<string, unknown>,
) {
  if (!roleConfigOwnsRepositorySurface(roleConfig)) {
    return false;
  }
  const repository = asRecord(taskInput.repository);
  return Boolean(
    readString(workspace.repository_url)
      ?? readString(asRecord(workflow.variables).repository_url)
      ?? readString(repository.repository_url),
  );
}

function formatWorkflowVariable(value: unknown) {
  if (typeof value === 'string') return truncateInlineValue(value.trim(), 240);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

function normalizeStrings(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : [];
}

function summarizeValue(value: unknown) {
  if (typeof value === 'string' && value.trim().length > 0) return truncateInlineValue(value.trim(), 160);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

function isSecretLikeKey(key: string) {
  return /(secret|token|password|api[_-]?key|credential|authorization|private[_-]?key|known_hosts|webhook_url)/i.test(key);
}

function isSecretLikeValue(value: unknown) {
  if (typeof value !== 'string') return false;
  return /(?:^enc:v\d+:|^secret:|^redacted:\/\/|^Bearer\s+\S+|^sk-[A-Za-z0-9_-]+|^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$)/i.test(value.trim());
}

function truncateInlineValue(value: string, maxLength: number) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function hashCanonicalJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
