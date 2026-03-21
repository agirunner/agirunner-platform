import { parsePlaybookDefinition } from '../orchestration/playbook-model.js';

interface InstructionLayerDocument {
  content: string;
  format: 'markdown';
}

interface WorkflowContextLike {
  lifecycle?: unknown;
  active_stages?: unknown;
  current_stage?: unknown;
  variables?: unknown;
  playbook?: unknown;
  playbook_definition?: unknown;
}

interface WorkflowInstructionLayerInput {
  isOrchestratorTask: boolean;
  role?: string;
  workflow?: WorkflowContextLike | null;
  workspace?: Record<string, unknown> | null;
  taskInput?: Record<string, unknown> | null;
  workItem?: Record<string, unknown> | null;
  predecessorHandoff?: Record<string, unknown> | null;
  orchestratorContext?: Record<string, unknown> | null;
}

export function buildWorkflowInstructionLayer(
  input: WorkflowInstructionLayerInput,
): InstructionLayerDocument | null {
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
  const workflowInstructionContext = input.isOrchestratorTask
    ? mergeOrchestratorWorkflowContext(workflow, input.orchestratorContext)
    : workflow;
  const activationAnchor = input.isOrchestratorTask
    ? readOrchestratorActivationAnchor(input.orchestratorContext)
    : { workItemId: null, stageName: null };
  const focusedWorkItem = input.isOrchestratorTask
    ? selectFocusedWorkItem(input.orchestratorContext, activationAnchor)
    : asRecord(input.workItem);
  const stageName =
    activationAnchor.stageName
    ?? readString(focusedWorkItem.stage_name)
    ?? deriveSoleActiveStageName(workflow)
    ?? readString(workflow.current_stage)
    ?? null;
  const checkpoint = definition.checkpoints.find((entry) => entry.name === stageName) ?? null;
  const boardColumn = definition.board.columns.find((entry) => entry.id === readString(focusedWorkItem.column_id));
  const repoBacked = isRepositoryBacked(input.workspace, workflow, input.taskInput);
  const sections = input.isOrchestratorTask
    ? buildOrchestratorSections({
        lifecycle,
        definition,
        workflow: workflowInstructionContext,
        checkpoint,
        boardColumn,
        focusedWorkItem,
        activeStages: readStringArray(workflowInstructionContext.active_stages),
        pendingDispatches: readPendingDispatches(input.orchestratorContext),
        repoBacked,
      })
    : buildSpecialistSections({
        lifecycle,
        definition,
        repoBacked,
      });

  if (sections.length === 0) {
    return null;
  }

  return {
    format: 'markdown',
    content: sections.join('\n\n'),
  };
}

function deriveSoleActiveStageName(workflow: Record<string, unknown>) {
  const activeStages = readStringArray(workflow.active_stages);
  return activeStages.length === 1 ? activeStages[0] : null;
}

function buildOrchestratorSections(params: {
  lifecycle: 'planned' | 'ongoing';
  definition: ReturnType<typeof parsePlaybookDefinition>;
  workflow: Record<string, unknown>;
  checkpoint: { name: string; goal: string; human_gate?: boolean } | null;
  boardColumn?: { label: string } | null;
  focusedWorkItem: Record<string, unknown>;
  activeStages: string[];
  pendingDispatches: Array<{ work_item_id: string; stage_name: string | null; actor: string; action: string; title: string | null }>;
  repoBacked: boolean;
}) {
  const sections = [
    `## Workflow Mode: ${params.lifecycle}\n${workflowModeGuidance(params.lifecycle)}`,
    buildWorkflowBriefSection(params.workflow),
    `## Process Instructions\n${params.definition.process_instructions}`,
    `## Progress Model\n${progressModelGuidance(params.definition)}`,
  ];

  if (params.checkpoint) {
    sections.push(
      `## Current Stage\n${params.checkpoint.name}\nGoal: ${params.checkpoint.goal}\nHuman gate: ${params.checkpoint.human_gate ? 'yes' : 'no'}`,
    );
    const successorCheckpoint = nextCheckpointName(params.definition, params.checkpoint.name);
    if (params.lifecycle === 'planned') {
      sections.push(`## Stage Routing\n${formatStageRouting(params.checkpoint.name, successorCheckpoint)}`);
    }
  } else if (params.boardColumn) {
    sections.push(`## Current Board Focus\n${params.boardColumn.label}`);
  }

  if (params.lifecycle === 'ongoing' && params.activeStages.length > 0) {
    sections.push(`## Active Stages\n${params.activeStages.join(', ')}`);
  }

  const roleCatalog = readOrchestratorRoleCatalog(params.workflow);
  if (roleCatalog.length > 0) {
    sections.push(`## Available Roles\n${formatRoleCatalog(roleCatalog)}`);
  }

  sections.push(`## Rule Results\n${formatRuleResults(params.definition, params.checkpoint?.name ?? null, params.focusedWorkItem)}`);
  if (params.pendingDispatches.length > 0) {
    sections.push(`## Pending Dispatches\n${formatPendingDispatches(params.pendingDispatches)}`);
  }
  if (params.lifecycle === 'planned') {
    sections.push(`## Handoff Semantics\n${formatPlannedHandoffSemantics()}`);
  }
  sections.push(
    '## Activation Discipline\nAfter you dispatch required specialist work, request a gate, or detect active subordinate work with no new routing decision to make, finish this activation and wait for the next workflow event. Do not poll running tasks in a loop. If no subordinate work is active and the workflow should progress, perform the workflow mutation now. A recommendation without the required workflow mutation does not complete the activation.',
  );

  const orchestrator = params.definition.orchestrator ?? {};
  const parallelLines = [
    `Max active tasks: ${orchestrator.max_active_tasks ?? 'not set'}`,
    `Max per work item: ${orchestrator.max_active_tasks_per_work_item ?? 'not set'}`,
    `Parallel work items: ${orchestrator.allow_parallel_work_items === false ? 'disabled' : 'enabled'}`,
  ];
  sections.push(`## Parallelism\n${parallelLines.join('\n')}`);

  sections.push(`## Output Protocol\n${outputProtocol(params.repoBacked, true)}`);
  return sections.filter((section) => section.trim().length > 0);
}

function buildSpecialistSections(params: {
  lifecycle: 'planned' | 'ongoing';
  definition: ReturnType<typeof parsePlaybookDefinition>;
  repoBacked: boolean;
}) {
  const sections = [
    `## Workflow Mode: ${params.lifecycle}\n${workflowModeGuidance(params.lifecycle)}`,
    `## Process Instructions\n${params.definition.process_instructions}`,
    `## Progress Model\n${progressModelGuidance(params.definition)}`,
    `## Output Protocol\n${outputProtocol(params.repoBacked, false)}`,
  ];

  return sections.filter((section) => section.trim().length > 0);
}

function buildWorkflowBriefSection(workflow: Record<string, unknown>) {
  const brief = compactWorkflowBriefVariables(asRecord(workflow.variables));
  if (!brief.goal && brief.inputs.length === 0) {
    return '';
  }

  const lines: string[] = [];
  if (brief.goal) {
    lines.push(`Goal: ${brief.goal}`);
  }
  if (brief.inputs.length > 0) {
    lines.push('Launch inputs:');
    lines.push(...brief.inputs.map((entry) => `- ${entry.key}: ${entry.value}`));
  }
  if (brief.omittedCount > 0) {
    lines.push(`- ...and ${brief.omittedCount} more launch inputs`);
  }
  return `## Workflow Brief\n${lines.join('\n')}`;
}

function compactWorkflowBriefVariables(variables: Record<string, unknown>) {
  const preferredGoalKeys = new Set(['goal', 'objective', 'outcome', 'brief', 'deliverable']);
  const visibleEntries = Object.entries(variables)
    .filter(([key, value]) => shouldExposeWorkflowVariable(key, value))
    .map(([key, value]) => ({ key, value: formatWorkflowVariable(value) }))
    .filter((entry): entry is { key: string; value: string } => entry.value !== null);

  const goalEntry = visibleEntries.find((entry) => preferredGoalKeys.has(entry.key));
  const nonGoalEntries = visibleEntries.filter((entry) => !preferredGoalKeys.has(entry.key));
  const maxInputs = 8;

  return {
    goal: goalEntry?.value ?? null,
    inputs: nonGoalEntries.slice(0, maxInputs),
    omittedCount: Math.max(nonGoalEntries.length - maxInputs, 0),
  };
}

function shouldExposeWorkflowVariable(key: string, value: unknown) {
  if (isSecretLikeKey(key) || isSecretLikeValue(value)) {
    return false;
  }
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }
  return typeof value === 'number' || typeof value === 'boolean';
}

function formatWorkflowVariable(value: unknown) {
  if (typeof value === 'string') {
    return truncateInlineValue(value.trim(), 240);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return null;
}

function truncateInlineValue(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1)}…`;
}

function mergeOrchestratorWorkflowContext(
  workflow: Record<string, unknown>,
  orchestratorContext: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const orchestratorWorkflow = asRecord(asRecord(orchestratorContext).workflow);
  if (Object.keys(orchestratorWorkflow).length === 0) {
    return workflow;
  }
  return {
    ...workflow,
    role_definitions: orchestratorWorkflow.role_definitions ?? workflow.role_definitions ?? null,
  };
}

function readOrchestratorRoleCatalog(
  workflow: Record<string, unknown>,
): Array<{ name: string; description: string | null }> {
  const directRoleDefinitions = Array.isArray(workflow.role_definitions)
    ? workflow.role_definitions
    : [];
  const playbookRoleDefinitions = Array.isArray(asRecord(workflow.playbook).role_definitions)
    ? asRecord(workflow.playbook).role_definitions as unknown[]
    : [];
  const roleEntries = directRoleDefinitions.length > 0
    ? directRoleDefinitions
    : playbookRoleDefinitions;
  return roleEntries
    .map((entry) => asRecord(entry))
    .map((entry) => ({
      name: readString(entry.name) ?? '',
      description: readString(entry.description),
    }))
    .filter((entry) => entry.name.length > 0);
}

function readPendingDispatches(
  orchestratorContext: Record<string, unknown> | null | undefined,
): Array<{ work_item_id: string; stage_name: string | null; actor: string; action: string; title: string | null }> {
  const pendingDispatches = Array.isArray(asRecord(asRecord(orchestratorContext).board).pending_dispatches)
    ? asRecord(asRecord(orchestratorContext).board).pending_dispatches as unknown[]
    : [];
  return pendingDispatches
    .map((entry) => asRecord(entry))
    .map((entry) => ({
      work_item_id: readString(entry.work_item_id) ?? '',
      stage_name: readString(entry.stage_name),
      actor: readString(entry.actor) ?? '',
      action: readString(entry.action) ?? '',
      title: readString(entry.title),
    }))
    .filter((entry) => entry.work_item_id.length > 0 && entry.actor.length > 0 && entry.action.length > 0);
}

function formatRoleCatalog(
  roles: Array<{ name: string; description: string | null }>,
): string {
  return roles
    .map((role) => `- ${role.name}: ${role.description ?? 'No description configured.'}`)
    .join('\n');
}

function formatPendingDispatches(
  pendingDispatches: Array<{ work_item_id: string; stage_name: string | null; actor: string; action: string; title: string | null }>,
): string {
  const lines = pendingDispatches.map((entry) => {
    const workItemLabel = entry.stage_name
      ? `work item ${entry.work_item_id} (${entry.stage_name})`
      : `work item ${entry.work_item_id}`;
    const titleSuffix = entry.title ? ` titled "${entry.title}"` : '';
    return `- Dispatch ${entry.actor} for ${entry.action} on ${workItemLabel}${titleSuffix}.`;
  });
  if (pendingDispatches.some((entry) => entry.action === 'review')) {
    lines.push('A predecessor task remaining in output_pending_review is expected while required review is pending and does not block dispatching the listed reviewer task.');
  }
  lines.push('If a pending dispatch is listed and no matching specialist task is already open, create that task in this activation.');
  return lines.join('\n');
}

function isSecretLikeKey(key: string) {
  return /(secret|token|password|api[_-]?key|credential|authorization|private[_-]?key|known_hosts|webhook_url)/i.test(key);
}

function isSecretLikeValue(value: unknown) {
  if (typeof value !== 'string') {
    return false;
  }
  return /(?:^enc:v\d+:|^secret:|^redacted:\/\/|^Bearer\s+\S+|^sk-[A-Za-z0-9_-]+|^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$)/i.test(value.trim());
}

function workflowModeGuidance(lifecycle: 'planned' | 'ongoing') {
  if (lifecycle === 'ongoing') {
    return 'This workflow stays open and accepts work over time. Prioritize per-work-item continuity and backlog health over any single global checkpoint.';
  }
  return 'This workflow is bounded. Move work through the required checkpoints, close finished predecessor work items when routing to successor checkpoint work, and finish only after mandatory reviews and approvals are satisfied.';
}

function progressModelGuidance(
  definition: ReturnType<typeof parsePlaybookDefinition>,
) {
  if (definition.checkpoints.length > 0) {
    return 'Checkpoint-driven. Use the active checkpoint goal, mandatory rules, and board lane posture together when deciding the next action.';
  }
  return 'Board-driven. Use board lane posture and work-item continuity to drive progression because this playbook does not define explicit checkpoints.';
}

function outputProtocol(repoBacked: boolean, orchestrator: boolean) {
  if (repoBacked) {
    return orchestrator
      ? 'Repository-backed workflow. Inspect files, diffs, and git state before deciding. Once required work is dispatched or active subordinate work is already in flight, finish the activation and wait for the next event instead of polling.'
      : 'Repository-backed workflow. Read predecessor context first, inspect the repository before changing it, and Commit and push required work before completion or escalation.';
  }
  return orchestrator
    ? 'Non-repository workflow. Evaluate artifacts and task outputs directly, and require clear uploaded evidence before accepting completion. Once required work is dispatched or active subordinate work is already in flight, finish the activation and wait for the next event instead of polling.'
    : 'Non-repository task. Base your completion on artifacts, outputs, and recorded evidence. Upload required artifacts before completion or escalation and leave a clear structured handoff for the next step.';
}

function formatRuleResults(
  definition: ReturnType<typeof parsePlaybookDefinition>,
  checkpointName: string | null,
  workItem: Record<string, unknown>,
) {
  const lines: string[] = [];
  const nextActor = readString(workItem.next_expected_actor);
  const nextAction = readString(workItem.next_expected_action);
  if (nextActor) {
    lines.push(`Next expected actor: ${nextActor}`);
  }
  if (nextAction) {
    lines.push(`Next expected action: ${nextAction}`);
  }
  const reworkCount = readNumber(workItem.rework_count);
  if (reworkCount !== null) {
    lines.push(`Current rework count: ${reworkCount}`);
  }
  if (requiresHumanApproval(definition, checkpointName)) {
    lines.push('Human approval required before completion.');
  }
  for (const rule of definition.review_rules.filter((entry) => ruleAppliesToCheckpoint(entry.checkpoint, checkpointName, definition))) {
    if (rule.required === false) {
      continue;
    }
    lines.push(`Required review: ${rule.from_role} -> ${rule.reviewed_by}`);
  }
  if (definition.lifecycle !== 'planned') {
    for (const rule of definition.handoff_rules.filter((entry) => ruleAppliesToCheckpoint(entry.checkpoint, checkpointName, definition))) {
      if (rule.required === false) {
        continue;
      }
      lines.push(`Required handoff: ${rule.from_role} -> ${rule.to_role}`);
    }
  }
  for (const rule of definition.approval_rules.filter((entry) => approvalRuleAppliesToCheckpoint(entry, checkpointName))) {
    if (rule.required === false) {
      continue;
    }
    if (rule.on === 'completion') {
      lines.push('Human approval: required before completion');
      continue;
    }
    lines.push(`Human approval: required at checkpoint "${rule.checkpoint}"`);
  }
  return lines.join('\n') || 'No mandatory routing is pending.';
}

function formatPlannedHandoffSemantics() {
  return [
    'Planned-workflow handoff rules describe the structured handoff that must exist before successor-stage routing.',
    'They do not authorize dispatching successor-role tasks on the current stage work item.',
    'Create or move successor work into the next stage before dispatching successor-role specialists.',
  ].join('\n');
}

function formatReviewExpectations(
  definition: ReturnType<typeof parsePlaybookDefinition>,
  checkpointName: string | null,
  workItem: Record<string, unknown>,
  role: string | null,
) {
  const lines: string[] = [];
  const roleName = role ?? readString(workItem.owner_role);
  const incomingReviewRule = definition.review_rules.find(
    (entry) => entry.reviewed_by === roleName && ruleAppliesToCheckpoint(entry.checkpoint, checkpointName, definition),
  );
  if (incomingReviewRule && incomingReviewRule.required !== false && roleName) {
    lines.push(`Review required from ${roleName}`);
    lines.push(`Mandatory review: ${roleName} should review the current output before completion.`);
  } else {
    const outgoingReviewRule = definition.review_rules.find(
      (entry) => entry.from_role === roleName && ruleAppliesToCheckpoint(entry.checkpoint, checkpointName, definition),
    );
    if (outgoingReviewRule && outgoingReviewRule.required !== false) {
      lines.push(`Review required from ${outgoingReviewRule.reviewed_by}`);
      lines.push(`Mandatory review: ${outgoingReviewRule.reviewed_by} should review the current output before completion.`);
    }
  }
  if (readString(workItem.next_expected_actor)) {
    lines.push(`Next expected actor: ${readString(workItem.next_expected_actor)}`);
  }
  if (readString(workItem.next_expected_action)) {
    lines.push(`Next expected action: ${readString(workItem.next_expected_action)}`);
  }
  if (requiresHumanApproval(definition, checkpointName)) {
    lines.push('Human approval is required before completion.');
  }
  const reworkCount = readNumber(workItem.rework_count);
  if (reworkCount !== null) {
    lines.push(`Current rework count: ${reworkCount}`);
  }
  return lines.join('\n') || 'No mandatory review or approval is pending.';
}

function requiresHumanApproval(
  definition: ReturnType<typeof parsePlaybookDefinition>,
  checkpointName: string | null,
) {
  return definition.approval_rules.some((entry) => approvalRuleAppliesToCheckpoint(entry, checkpointName));
}

function formatStageRouting(
  currentStageName: string,
  successorStageName: string | null,
) {
  if (!successorStageName) {
    return [
      `Current stage: ${currentStageName}`,
      'This is the final planned stage. After the stage deliverable is accepted and any required human approval is satisfied, complete the release work item and then complete the workflow.',
    ].join('\n');
  }

  return [
    `Current stage: ${currentStageName}`,
    `Successor stage after acceptance: ${successorStageName}`,
    `Creating successor work in "${successorStageName}" and closing the accepted predecessor work item is itself the forward-routing mutation for this planned workflow.`,
    `If the platform already reports "${successorStageName}" as current after you route successor work, treat any repeated advance_stage request for "${currentStageName}" -> "${successorStageName}" as unnecessary and do not issue it again.`,
    `When you create successor work in a planned workflow, set stage_name to "${successorStageName}" and close the predecessor work item instead of leaving successor work anchored to "${currentStageName}".`,
    'Only create successor checkpoint work for the immediate next stage after the predecessor checkpoint has a full handoff or approved gate and no actively running tasks; output_pending_review is the only allowed carryover, and only for a required review checkpoint.',
    'Before you create successor specialist tasks in a planned workflow, create or move the successor work item into the successor stage first.',
    'Planned-workflow tasks must stay attached to a work item in the same stage as the task itself.',
  ].join('\n');
}

function nextCheckpointName(
  definition: ReturnType<typeof parsePlaybookDefinition>,
  checkpointName: string | null,
) {
  if (!checkpointName) {
    return null;
  }
  const checkpointIndex = definition.checkpoints.findIndex((entry) => entry.name === checkpointName);
  if (checkpointIndex < 0) {
    return null;
  }
  return definition.checkpoints[checkpointIndex + 1]?.name ?? null;
}

function ruleAppliesToCheckpoint(
  ruleCheckpoint: string | undefined,
  checkpointName: string | null,
  _definition: ReturnType<typeof parsePlaybookDefinition>,
) {
  if (!ruleCheckpoint) {
    return true;
  }
  return checkpointName === ruleCheckpoint;
}

function approvalRuleAppliesToCheckpoint(
  rule: { on: 'checkpoint' | 'completion'; checkpoint?: string | undefined; required?: boolean | undefined },
  checkpointName: string | null,
) {
  if (rule.required === false) {
    return false;
  }
  if (rule.on === 'completion') {
    return true;
  }
  return Boolean(checkpointName) && rule.checkpoint === checkpointName;
}

function selectFocusedWorkItem(
  orchestratorContext: Record<string, unknown> | null | undefined,
  activationAnchor: { workItemId: string | null; stageName: string | null },
) {
  const context = asRecord(orchestratorContext);
  const board = asRecord(context.board);
  const workItems = Array.isArray(board.work_items)
    ? board.work_items.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry))
    : [];
  if (activationAnchor.workItemId) {
    const matched = workItems.find((entry) => readString(entry.id) === activationAnchor.workItemId);
    if (matched) {
      return matched;
    }
  }
  if (activationAnchor.stageName) {
    const stageMatches = workItems.filter((entry) => readString(entry.stage_name) === activationAnchor.stageName);
    const stagedMatch = stageMatches.find((entry) => readString(entry.next_expected_actor) || readString(entry.next_expected_action));
    if (stagedMatch) {
      return stagedMatch;
    }
    if (stageMatches[0]) {
      return stageMatches[0];
    }
  }
  return workItems.find((entry) => readString(entry.next_expected_actor) || readString(entry.next_expected_action))
    ?? workItems[0]
    ?? {};
}

function readOrchestratorActivationAnchor(
  orchestratorContext: Record<string, unknown> | null | undefined,
) {
  const context = asRecord(orchestratorContext);
  const activation = asRecord(context.activation);
  const activationEvents = Array.isArray(activation.events)
    ? activation.events
    : [];
  const payloadSources = [
    activation.payload,
    ...activationEvents.map((event) => asRecord(event).payload),
  ].map(asRecord);

  for (const payload of payloadSources) {
    const workItemId = readString(payload.work_item_id);
    const stageName = readString(payload.stage_name);
    if (workItemId || stageName) {
      return { workItemId, stageName };
    }
  }

  return { workItemId: null, stageName: null };
}

function isRepositoryBacked(
  workspace: Record<string, unknown> | null | undefined,
  workflow: Record<string, unknown>,
  taskInput?: Record<string, unknown> | null,
) {
  const repository = asRecord(asRecord(taskInput).repository);
  return Boolean(
    readString(asRecord(workspace).repository_url)
      ?? readString(asRecord(workflow.variables).repository_url)
      ?? readString(repository.repository_url),
  );
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
