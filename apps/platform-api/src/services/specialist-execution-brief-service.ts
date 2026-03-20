import { createHash } from 'node:crypto';

import { parsePlaybookDefinition } from '../orchestration/playbook-model.js';

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
    unresolved_findings: string[];
    review_focus: string[];
    known_risks: string[];
  };
  review_output_expectations: string[];
  repo_status_summary: string;
  likely_relevant_files: string[];
  verification_commands: string[];
  relevant_memory_refs: MemoryRef[];
  relevant_artifact_refs: ArtifactRef[];
  rendered_markdown: string;
}

interface SpecialistExecutionBriefInput {
  role?: string | null;
  workflow?: Record<string, unknown> | null;
  workspace?: Record<string, unknown> | null;
  workItem?: Record<string, unknown> | null;
  predecessorHandoff?: Record<string, unknown> | null;
  taskInput?: Record<string, unknown> | null;
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
  const stageName = readString(workItem.stage_name) ?? readString(workflow.current_stage);
  const checkpoint = definition.checkpoints.find((entry) => entry.name === stageName) ?? null;
  const boardColumn = definition.board.columns.find((entry) => entry.id === readString(workItem.column_id)) ?? null;
  const workflowBrief = compactWorkflowBriefVariables(asRecord(workflow.variables));
  const reviewOutputExpectations = buildReviewOutputExpectations(
    definition,
    checkpoint?.name ?? null,
    workItem,
    input.role ?? null,
    isRepositoryBacked(workspace, workflow, taskInput),
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
    ...readStringArray(workItem.review_focus),
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
    refresh_key: hashCanonicalJson({
      handoff_id: readString(predecessorHandoff.id),
      handoff_summary: readString(predecessorHandoff.summary),
      continuity: continuitySummaryFrom(workItem),
      relevant_memory_refs: relevantMemoryRefs.map((entry) => entry.key),
      relevant_artifact_refs: relevantArtifactRefs.map((entry) => entry.artifact_id),
    }),
    workflow_brief: workflowBrief,
    goal: readString(taskInput.description) ?? readString(workItem.goal) ?? workflowBrief.goal,
    acceptance_criteria: normalizeStrings(workItem.acceptance_criteria),
    current_focus: {
      lifecycle,
      stage_name: checkpoint?.name ?? stageName ?? null,
      stage_goal: checkpoint?.goal ?? null,
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
    review_output_expectations: reviewOutputExpectations,
    repo_status_summary: isRepositoryBacked(workspace, workflow, taskInput)
      ? 'Repository-backed task. Use the real repository state as the source of truth.'
      : 'Non-repository task. Base completion on artifacts, outputs, and recorded evidence.',
    likely_relevant_files: likelyRelevantFiles,
    verification_commands: normalizeStrings(taskInput.verification_commands),
    relevant_memory_refs: relevantMemoryRefs,
    relevant_artifact_refs: relevantArtifactRefs,
    rendered_markdown: '',
  };
  brief.rendered_markdown = renderBrief(brief);
  return brief;
}

function buildReviewOutputExpectations(
  definition: ReturnType<typeof parsePlaybookDefinition>,
  checkpointName: string | null,
  workItem: Record<string, unknown>,
  role: string | null,
  repoBacked: boolean,
): string[] {
  const roleName = role ?? readString(workItem.owner_role);
  const lines: string[] = [];
  const incomingReviewRule = definition.review_rules.find(
    (entry) => entry.reviewed_by === roleName && ruleAppliesToCheckpoint(entry.checkpoint, checkpointName),
  );
  if (incomingReviewRule && incomingReviewRule.required !== false && roleName) {
    lines.push(`Review required from ${roleName}.`);
    lines.push(`${roleName} should review the current output before completion.`);
  } else {
    const outgoingReviewRule = definition.review_rules.find(
      (entry) => entry.from_role === roleName && ruleAppliesToCheckpoint(entry.checkpoint, checkpointName),
    );
    if (outgoingReviewRule && outgoingReviewRule.required !== false) {
      lines.push(`Review required from ${outgoingReviewRule.reviewed_by}.`);
      lines.push(`${outgoingReviewRule.reviewed_by} should review the current output before completion.`);
    }
  }
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
  return lines.join('\n');
}

function continuitySummaryFrom(workItem: Record<string, unknown>) {
  return {
    latest_handoff_completion: readString(workItem.latest_handoff_completion),
    unresolved_findings: readStringArray(workItem.unresolved_findings),
    review_focus: readStringArray(workItem.review_focus),
    known_risks: readStringArray(workItem.known_risks),
  };
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

function isRepositoryBacked(workspace: Record<string, unknown>, workflow: Record<string, unknown>, taskInput: Record<string, unknown>) {
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

function ruleAppliesToCheckpoint(ruleCheckpoint: string | undefined, checkpointName: string | null) {
  if (!ruleCheckpoint) return true;
  return checkpointName === ruleCheckpoint;
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

function hashCanonicalJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
