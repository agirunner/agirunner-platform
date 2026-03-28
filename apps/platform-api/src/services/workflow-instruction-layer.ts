import { parsePlaybookDefinition } from '../orchestration/playbook-model.js';
import { guidedClosureContextSchema } from './guided-closure/types.js';
import { buildStageRoleCoverage } from './stage-role-coverage.js';
import { roleConfigOwnsRepositorySurface } from './tool-tag-service.js';

interface InstructionLayerDocument {
  content: string;
  format: 'markdown';
}

interface WorkflowContextLike {
  lifecycle?: unknown;
  active_stages?: unknown;
  current_stage?: unknown;
  live_visibility?: unknown;
  variables?: unknown;
  playbook?: unknown;
  playbook_definition?: unknown;
}

interface WorkflowInstructionLayerInput {
  isOrchestratorTask: boolean;
  role?: string;
  roleConfig?: Record<string, unknown> | null;
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
  const activationTransition = input.isOrchestratorTask
    ? readActivationStageTransition(input.orchestratorContext)
    : { previousStageName: null };
  const focusedWorkItem = input.isOrchestratorTask
    ? selectFocusedWorkItem(input.orchestratorContext, activationAnchor)
    : asRecord(input.workItem);
  const stageName =
    activationAnchor.stageName
    ?? readString(focusedWorkItem.stage_name)
    ?? deriveSoleActiveStageName(workflow)
    ?? readString(workflow.current_stage)
    ?? null;
  const stage = definition.stages.find((entry) => entry.name === stageName) ?? null;
  const boardColumn = definition.board.columns.find((entry) => entry.id === readString(focusedWorkItem.column_id));
  const repoBacked = input.isOrchestratorTask
    ? hasRepositoryBinding(input.workspace, workflow, input.taskInput)
    : isRepositoryBacked(input.workspace, workflow, input.taskInput, input.roleConfig);
  const currentStageHasWorkItems = input.isOrchestratorTask
    ? hasStageWorkItems(input.orchestratorContext, stageName)
    : false;
  const sections = input.isOrchestratorTask
    ? buildOrchestratorSections({
        lifecycle,
        definition,
        workflow: workflowInstructionContext,
        stage,
        boardColumn,
        focusedWorkItem,
        activeStages: readStringArray(workflowInstructionContext.active_stages),
        boardTasks: readBoardTasks(input.orchestratorContext),
        pendingDispatches: readPendingDispatches(input.orchestratorContext),
        activationTransition,
        currentStageHasWorkItems,
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
  stage: { name: string; goal: string; guidance?: string; involves?: string[] } | null;
  boardColumn?: { label: string } | null;
  focusedWorkItem: Record<string, unknown>;
  activeStages: string[];
  boardTasks: Record<string, unknown>[];
  pendingDispatches: Array<{ work_item_id: string; stage_name: string | null; actor: string; action: string; title: string | null }>;
  activationTransition: { previousStageName: string | null };
  currentStageHasWorkItems: boolean;
  repoBacked: boolean;
}) {
  const sections = [
    `## Workflow Mode: ${params.lifecycle}\n${workflowModeGuidance(params.lifecycle)}`,
    buildWorkflowBriefSection(params.workflow),
    `## Process Instructions\n${params.definition.process_instructions}`,
    `## Progress Model\n${progressModelGuidance(params.definition)}`,
  ];

  if (params.stage) {
    sections.push(
      `## Current Stage\n${params.stage.name}\nGoal: ${params.stage.goal}`,
    );
    const successorStage = nextStageName(params.definition, params.stage.name);
    if (params.lifecycle === 'planned') {
      sections.push(`## Stage Routing\n${formatStageRouting(params.stage.name, successorStage)}`);
      sections.push(`## Stage Name Contract\n${formatStageNameContract(params.definition)}`);
      const emptyStageGuidance = formatEmptyPlannedStageGuidance(
        params.definition,
        params.stage.name,
        params.activationTransition.previousStageName,
        params.currentStageHasWorkItems,
      );
      if (emptyStageGuidance) {
        sections.push(`## Successor Seeding\n${emptyStageGuidance}`);
      }
    }
  } else if (params.boardColumn) {
    sections.push(`## Current Board Focus\n${params.boardColumn.label}`);
  }

  if (params.lifecycle === 'ongoing' && params.activeStages.length > 0) {
    sections.push(`## Active Stages\n${params.activeStages.join(', ')}`);
  }

  const stageRoleCoverage = formatStageRoleCoverage(
    params.stage,
    params.focusedWorkItem,
    params.boardTasks,
  );
  if (stageRoleCoverage) {
    sections.push(`## Stage Role Coverage\n${stageRoleCoverage}`);
  }

  const roleCatalog = readOrchestratorRoleCatalog(params.workflow);
  if (roleCatalog.length > 0) {
    sections.push(`## Available Roles\n${formatRoleCatalog(roleCatalog)}`);
  }

  sections.push(`## Active Continuity\n${formatRuleResults(params.focusedWorkItem)}`);
  if (params.pendingDispatches.length > 0) {
    sections.push(`## Pending Dispatches\n${formatPendingDispatches(params.pendingDispatches)}`);
  }
  if (params.lifecycle === 'planned') {
    sections.push(`## Handoff Semantics\n${formatPlannedHandoffSemantics()}`);
  }
  sections.push(`## Closure Discipline\n${workItemClosureDiscipline(params.lifecycle)}`);
  const closureContextSection = formatClosureContext(params.workflow);
  if (closureContextSection) {
    sections.push(`## Closure Context\n${closureContextSection}`);
  }
  sections.push(`## Guided Recovery\n${guidedRecoveryGuidance()}`);
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
  const operatorVisibilitySection = formatOperatorVisibilitySection(
    asRecord(params.workflow.live_visibility),
  );
  if (operatorVisibilitySection) {
    sections.push(operatorVisibilitySection);
  }

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
    `## Completion Boundaries\n${specialistCompletionBoundaries()}`,
    `## Output Protocol\n${outputProtocol(params.repoBacked, false)}`,
  ];

  return sections.filter((section) => section.trim().length > 0);
}

function formatStageNameContract(definition: ReturnType<typeof parsePlaybookDefinition>) {
  const stageNames = definition.stages
    .map((entry) => entry.name.trim())
    .filter((name) => name.length > 0);
  if (stageNames.length === 0) {
    return 'Use only exact authored stage_name values when routing work items or tasks. Do not paraphrase or shorten stage names.';
  }
  return `Use only these exact authored stage_name values when routing work: ${stageNames.join(', ')}. Do not paraphrase, shorten, or invent alternate stage names.`;
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
  const closureContext = asRecord(asRecord(orchestratorContext).closure_context);
  if (Object.keys(orchestratorWorkflow).length === 0) {
    return Object.keys(closureContext).length > 0
      ? { ...workflow, closure_context: closureContext }
      : workflow;
  }
  return {
    ...workflow,
    role_definitions: orchestratorWorkflow.role_definitions ?? workflow.role_definitions ?? null,
    closure_context:
      Object.keys(closureContext).length > 0
        ? closureContext
        : workflow.closure_context ?? null,
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

function formatOperatorVisibilitySection(liveVisibility: Record<string, unknown>): string {
  if (Object.keys(liveVisibility).length === 0) {
    return '';
  }

  const lines: string[] = [];
  const mode = readString(liveVisibility.mode);
  const workflowId = readString(liveVisibility.workflow_id);
  const workItemId = readString(liveVisibility.work_item_id);
  const taskId = readString(liveVisibility.task_id);
  const executionContextId = readString(liveVisibility.execution_context_id);
  const recordOperatorUpdateTool = readString(liveVisibility.record_operator_update_tool);
  const recordOperatorBriefTool = readString(liveVisibility.record_operator_brief_tool);
  const sourceKind = readString(liveVisibility.source_kind) ?? 'orchestrator';
  const operatorUpdateRequestIdPrefix = readString(liveVisibility.operator_update_request_id_prefix);
  const operatorBriefRequestIdPrefix = readString(liveVisibility.operator_brief_request_id_prefix);

  if (mode) lines.push(`Live visibility mode: ${mode}`);
  if (workflowId) lines.push(`Workflow id: ${workflowId}`);
  if (workItemId) lines.push(`Work item id: ${workItemId}`);
  if (taskId) lines.push(`Task id: ${taskId}`);
  if (executionContextId) lines.push(`Execution context id: ${executionContextId}`);
  lines.push(
    'Every operator record write must include a unique request_id. Reuse a request_id only for an intentional retry of the same write.',
  );
  lines.push(
    'record_operator_brief and record_operator_update do not satisfy a required submit_handoff and do not by themselves complete a task, work item, or workflow.',
  );

  if (liveVisibility.turn_updates_required === true && recordOperatorUpdateTool) {
    if (liveVisibility.turn_update_scope === 'per_eligible_turn') {
      lines.push(`Enhanced live visibility requires exactly one ${recordOperatorUpdateTool} on every llm turn before that turn can close.`);
    }
    const eligibleTurnGuidance = readString(liveVisibility.eligible_turn_guidance);
    if (eligibleTurnGuidance) {
      lines.push(eligibleTurnGuidance);
    }
    if (operatorUpdateRequestIdPrefix) {
      lines.push(
        `Use ${operatorUpdateRequestIdPrefix} as the stable request_id prefix for ${recordOperatorUpdateTool} writes in this execution context.`,
      );
    }
    lines.push(
      `Use ${recordOperatorUpdateTool} for one tiny operator-readable headline on every llm turn.`,
    );
    lines.push(
      `If you forget the required ${recordOperatorUpdateTool}, the execution contract will send you back automatically to emit it before progress can continue.`,
    );
    lines.push(
      'If you do not have the exact scoped workflow, work-item, or task ids from the live visibility contract, omit those optional ids and let the runtime derive the canonical linkage from execution_context_id.',
    );
    lines.push(
      'Operator updates and briefs are console text, not audit logs: keep them human-readable, use titles and roles when available, and never dump tool chatter, phases, JSON, UUIDs, or lines like "Ran File Read", "tool_failure", or "executed 2 tools".',
    );
    lines.push(
      `Example: ${formatOperatorUpdateExample({
        requestIdPrefix: operatorUpdateRequestIdPrefix,
        executionContextId,
        workItemId,
        taskId,
        sourceKind,
      })}`,
    );
  }

  if (liveVisibility.milestone_briefs_required === true && recordOperatorBriefTool) {
    if (operatorBriefRequestIdPrefix) {
      lines.push(
        `Use ${operatorBriefRequestIdPrefix} as the stable request_id prefix for ${recordOperatorBriefTool} writes in this execution context.`,
      );
    }
    lines.push(
      `Use ${recordOperatorBriefTool} for material handoff or milestone summaries when the platform requests them.`,
    );
    lines.push(
      `If this task reaches a meaningful completion, handoff, approval, or output checkpoint without the required ${recordOperatorBriefTool}, completion will be rejected recoverably until you emit it.`,
    );
    lines.push(
      'Use brief_kind milestone for in-flight progress or handoff summaries and brief_kind terminal only for the final workflow outcome summary.',
    );
    lines.push(
      `${recordOperatorBriefTool} payload must include short_brief and detailed_brief_json objects.`,
    );
    lines.push('short_brief must include a headline.');
    lines.push(
      'record_operator_brief requires short_brief.headline plus detailed_brief_json.headline and status_kind, and must never be called with only linked_target_ids or an empty brief shell.',
    );
  }

  return lines.length > 0 ? `## Operator Visibility\n${lines.join('\n')}` : '';
}

function formatOperatorUpdateExample(input: {
  requestIdPrefix: string | null;
  executionContextId: string | null;
  workItemId: string | null;
  taskId: string | null;
  sourceKind: string;
}): string {
  const requestId = `${input.requestIdPrefix ?? 'operator-update:<execution_context_id>:'}route-reviewer`;
  const fields = [
    `request_id: "${requestId}"`,
    `execution_context_id: "${input.executionContextId ?? '<execution_context_id>'}"`,
    input.workItemId ? `work_item_id: "${input.workItemId}"` : null,
    input.taskId ? `task_id: "${input.taskId}"` : null,
    `source_kind: "${input.sourceKind}"`,
    'payload: { headline: "Orchestrator is routing the next specialist task." }',
  ].filter((value): value is string => Boolean(value));

  return `{ ${fields.join(', ')} }`;
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
  if (pendingDispatches.some((entry) => entry.action === 'assess')) {
    lines.push('A predecessor task remaining in output_pending_assessment is expected while a real assessment task is pending and does not block dispatching the listed assessment task.');
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
    return 'This workflow stays open and accepts work over time. Prioritize per-work-item continuity and backlog health over any single global stage.';
  }
  return 'This workflow is bounded. Move work through the authored stage sequence, close accepted predecessor work items when routing to successor-stage work, and finish only after any actually-invoked approval, assessment, or escalation steps are resolved.';
}

function progressModelGuidance(
  definition: ReturnType<typeof parsePlaybookDefinition>,
) {
  void definition;
  return 'Stage-and-board driven. Use the current stage goal, board posture, work-item continuity, and detailed process instructions together when deciding the next action.';
}

function outputProtocol(repoBacked: boolean, orchestrator: boolean) {
  if (repoBacked) {
    return orchestrator
      ? 'Repository-backed workflow. Use runtime-visible continuity, task outputs, and artifacts to decide what specialist work to dispatch next. When repository inspection is required, route that work through a specialist task instead of inspecting the repository from the orchestrator activation. Once required work is dispatched or active subordinate work is already in flight, finish the activation and wait for the next event instead of polling.'
      : 'Repository-backed workflow. Read predecessor context first, use Specialist Execution tools for repository, filesystem, shell, web fetch, and artifact upload work, and commit and push required changes before completion or escalation.';
  }
  return orchestrator
    ? 'Non-repository workflow. Evaluate artifacts and task outputs directly, and require clear uploaded evidence before accepting completion. Once required work is dispatched or active subordinate work is already in flight, finish the activation and wait for the next event instead of polling.'
    : 'Non-repository task. Base your completion on artifacts, outputs, and recorded evidence. Upload required artifacts before completion or escalation and leave a clear structured handoff for the next step.';
}

function workItemClosureDiscipline(lifecycle: 'planned' | 'ongoing') {
  const lifecycleSpecificLines = lifecycle === 'ongoing'
    ? [
        'When the current ongoing-workflow work item satisfies its authored stage goal, board posture, continuity, and process instructions, call complete_work_item in the same activation instead of leaving accepted work open.',
        'Do not keep accepted ongoing work items open just because the workflow itself remains available for future intake.',
      ]
    : [
        'When the current planned-workflow work item satisfies its authored stage goal, board posture, continuity, and process instructions, call complete_work_item in the same activation instead of leaving accepted work open.',
        'When every planned work item is terminal and no blocking tasks, approvals, assessments, escalations, or required follow-up remain, call complete_workflow in the same activation.',
      ];
  return [
    ...lifecycleSpecificLines,
    'Before complete_work_item or close_work_item_with_callouts, confirm closure_context.work_item_can_close_now is yes and no current-work-item specialist tasks remain open.',
    'When you call complete_workflow, include final_artifacts with the repo-relative deliverables or uploaded artifact paths that represent the final workflow output.',
    'When closure is legal but preferred work or advisory items remain, use complete_work_item or complete_workflow with structured completion_callouts instead of leaving the workflow open.',
    'Do not rely on board lane guesses or specialist prose to imply closure. Perform the explicit workflow mutation yourself.',
  ].join('\n');
}

function specialistCompletionBoundaries() {
  return [
    'Your responsibility is to finish the current task with concrete evidence and then leave a structured handoff or escalation when required.',
    'Submitting a handoff does not itself close the work item or workflow. The orchestrator decides whether to route more work, request approval or assessment, complete the work item, or complete the workflow.',
    'Do not claim broader workflow closure from specialist task success alone.',
  ].join('\n');
}

function formatRuleResults(
  workItem: Record<string, unknown>,
) {
  const lines: string[] = [];
  const nextActor = readString(workItem.next_expected_actor);
  const nextAction = readString(workItem.next_expected_action);
  const continuity = asRecord(workItem.continuity);
  if (nextActor) {
    lines.push(`Next expected actor: ${nextActor}`);
  }
  if (nextAction) {
    lines.push(`Next expected action: ${nextAction}`);
  }
  const statusSummary = readString(continuity.status_summary);
  if (statusSummary) {
    lines.push(`Continuity status: ${statusSummary}`);
  }
  const nextExpectedEvent = readString(continuity.next_expected_event);
  if (nextExpectedEvent) {
    lines.push(`Next expected event: ${nextExpectedEvent}`);
  }
  const activeSubordinateTasks = readStringArray(continuity.active_subordinate_tasks);
  if (activeSubordinateTasks.length > 0) {
    lines.push(`Active subordinate tasks: ${activeSubordinateTasks.join(', ')}`);
  }
  if (nextExpectedEvent && activeSubordinateTasks.length > 0) {
    lines.push(
      'When active subordinate tasks are already in flight and continuity identifies the next expected event, finish this activation and wait for that event instead of polling for completion.',
    );
  }
  const reworkCount = readNumber(workItem.rework_count);
  if (reworkCount !== null) {
    lines.push(`Current rework count: ${reworkCount}`);
  }
  const blockedState = readString(workItem.blocked_state);
  if (blockedState) {
    lines.push(`Blocked state: ${blockedState}`);
  }
  const escalationStatus = readString(workItem.escalation_status);
  if (escalationStatus) {
    lines.push(`Escalation status: ${escalationStatus}`);
  }
  return lines.join('\n') || 'No active continuity requirements are recorded.';
}

function formatPlannedHandoffSemantics() {
  return [
    'Structured handoffs capture the accepted output that justifies successor-stage routing.',
    'A handoff by itself does not authorize dispatching successor-role tasks on the current stage work item.',
    'send_task_message never creates or reopens a task and is not a routing mutation.',
    'Do not describe rework as routed until create_task succeeds for a new rework task or update_task_input succeeds on the already-open task.',
    'Create or move successor work into the next stage before dispatching successor-role specialists.',
    'Only actual invoked approvals, assessments, and escalations create blocking workflow state. Process prose may instruct you to invoke those controls, but there is no separate governance metadata to consult.',
    'Use the work item escalation status and structured handoffs as authoritative evidence of an active escalation; do not require direct escalation-record inspection before honoring it.',
  ].join('\n');
}

function formatStageRouting(
  currentStageName: string,
  successorStageName: string | null,
) {
  if (!successorStageName) {
    return [
      `Current stage: ${currentStageName}`,
      'This is the final planned stage. After the stage deliverable is accepted and any required human approval is satisfied, complete the accepted final-stage work item and then complete the workflow.',
    ].join('\n');
  }

  return [
    `Current stage: ${currentStageName}`,
    `Successor stage after acceptance: ${successorStageName}`,
    `Creating successor work in "${successorStageName}" and closing the accepted predecessor work item is itself the forward-routing mutation for this planned workflow.`,
    `If the platform already reports "${successorStageName}" as current after you route successor work, treat any repeated advance_stage request for "${currentStageName}" -> "${successorStageName}" as unnecessary and do not issue it again.`,
    `When you create successor work in a planned workflow, set stage_name to "${successorStageName}" and close the predecessor work item instead of leaving successor work anchored to "${currentStageName}".`,
    'Only create successor work for the immediate next stage after the predecessor stage has a full handoff or approved gate and no active predecessor tasks remain. Any actually invoked assessment, approval, or escalation on that path must resolve before successor-stage work starts.',
    'Before you create successor specialist tasks in a planned workflow, create or move the successor work item into the successor stage first.',
    'Planned-workflow tasks must stay attached to a work item in the same stage as the task itself.',
    'If a request_changes outcome already reopened the subject task, do not create another same-role rework task on the assessor work item; wait for the reopened subject to resubmit and then route it through the required follow-up step.',
    'If continuity for the current work item says the next expected action is rework, route only that next expected actor until a new subject handoff lands. Do not create additional assessor, approval, or successor tasks on that work item before the rework handoff changes continuity.',
  ].join('\n');
}

function formatEmptyPlannedStageGuidance(
  definition: ReturnType<typeof parsePlaybookDefinition>,
  currentStageName: string,
  previousStageName: string | null,
  currentStageHasWorkItems: boolean,
) {
  if (currentStageHasWorkItems) {
    return '';
  }

  const lines = [
    `No work item currently exists in "${currentStageName}".`,
    `When a planned stage has just started and is empty, creating the first successor work item in "${currentStageName}" from cleared predecessor lineage is expected workflow progress, not an error.`,
    `Use the latest accepted predecessor work item, its cleared handoffs, and any satisfied approval or assessment outcomes to seed the first work item in "${currentStageName}" before dispatching successor specialists.`,
    'Do not escalate solely because the newly started planned stage is empty.',
  ];

  if (previousStageName) {
    lines.splice(
      1,
      0,
      `This stage was entered from "${previousStageName}", so inspect that predecessor stage first when deriving the successor work item.`,
    );
  }

  const starterRoles = starterRolesForStage(definition, currentStageName);
  if (starterRoles.length > 0) {
    lines.push(`Starter roles for "${currentStageName}": ${starterRoles.join(', ')}.`);
    lines.push(
      `Do not seed the first work item in "${currentStageName}" with successor-only roles that require an intra-stage handoff first.`,
    );
  }

  return lines.join('\n');
}

function nextStageName(
  definition: ReturnType<typeof parsePlaybookDefinition>,
  stageName: string | null,
) {
  if (!stageName) {
    return null;
  }
  const stageIndex = definition.stages.findIndex((entry) => entry.name === stageName);
  if (stageIndex < 0) {
    return null;
  }
  return definition.stages[stageIndex + 1]?.name ?? null;
}

function starterRolesForStage(
  definition: ReturnType<typeof parsePlaybookDefinition>,
  stageName: string,
) {
  const stage = definition.stages.find((entry) => entry.name === stageName);
  void definition;
  return stage?.involves ?? [];
}

function formatStageRoleCoverage(
  stage: { name: string; involves?: string[] } | null,
  focusedWorkItem: Record<string, unknown>,
  boardTasks: Record<string, unknown>[],
) {
  const stageRoles = (stage?.involves ?? [])
    .map((role) => role.trim())
    .filter((role) => role.length > 0);
  if (stageRoles.length === 0) {
    return '';
  }

  const workItemId = readString(focusedWorkItem.id);
  if (!workItemId) {
    return '';
  }

  const currentSubjectRevision = readOptionalPositiveInteger(focusedWorkItem.current_subject_revision);
  const coverage = buildStageRoleCoverage({
    stageName: stage?.name ?? null,
    stageRoles,
    workItemId,
    currentSubjectRevision,
    tasks: boardTasks,
  });
  const lines = coverage.map((entry) => `- ${entry.role}: ${entry.description}`);
  lines.push(
    'An open escalation or other restrictive same-stage finding does not by itself satisfy the remaining current-stage roles.',
  );
  lines.push(
    'If any named current-stage role has not contributed and has not been explicitly skipped for a concrete playbook-grounded reason, keep routing within the current stage instead of stopping at the first restrictive finding.',
  );
  lines.push(
    'Use the work item escalation status and structured handoffs as authoritative evidence of an active escalation; do not require direct escalation-record inspection before honoring it.',
  );
  if (currentSubjectRevision !== null) {
    lines.push(
      `Current subject revision: ${currentSubjectRevision}. Confirm older assessment contributions still apply to this revision before treating them as sufficient.`,
    );
  }
  return lines.join('\n');
}

function readBoardTasks(
  orchestratorContext: Record<string, unknown> | null | undefined,
) {
  const board = asRecord(asRecord(orchestratorContext).board);
  const tasks = Array.isArray(board.tasks) ? board.tasks : [];
  return tasks.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry));
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

function formatClosureContext(workflow: Record<string, unknown>) {
  const parsed = guidedClosureContextSchema.safeParse(asRecord(workflow.closure_context));
  if (!parsed.success) {
    return '';
  }

  const lines = [
    `Closure readiness: ${parsed.data.closure_readiness}`,
    `Work item can close now: ${parsed.data.work_item_can_close_now ? 'yes' : 'no'}`,
    `Workflow can close now: ${parsed.data.workflow_can_close_now ? 'yes' : 'no'}`,
  ];
  if (parsed.data.open_specialist_task_count > 0) {
    lines.push(`Open specialist tasks on current work item: ${parsed.data.open_specialist_task_count}`);
  }
  if (parsed.data.open_specialist_task_roles.length > 0) {
    lines.push(`Open specialist task roles: ${parsed.data.open_specialist_task_roles.join(', ')}`);
  }
  for (const control of parsed.data.active_blocking_controls) {
    lines.push(`Blocking control ${control.kind} ${control.id}: ${control.summary ?? 'Blocking control remains open.'}`);
  }
  for (const control of parsed.data.active_advisory_controls) {
    lines.push(`Advisory control ${control.kind} ${control.id}: ${control.summary ?? 'Advisory control remains open.'}`);
  }
  for (const obligation of parsed.data.preferred_obligations) {
    lines.push(`Preferred obligation ${obligation.subject} (${obligation.code}): ${obligation.status}`);
  }
  for (const outcome of parsed.data.recent_recovery_outcomes) {
    lines.push(`Recent recovery ${outcome.recovery_class}`);
  }
  const workItemAttempts = Object.entries(parsed.data.attempt_count_by_work_item);
  if (workItemAttempts.length > 0) {
    lines.push(`Attempt counts by work item: ${workItemAttempts.map(([key, value]) => `${key}=${value}`).join(', ')}`);
  }
  const roleAttempts = Object.entries(parsed.data.attempt_count_by_role);
  if (roleAttempts.length > 0) {
    lines.push(`Attempt counts by role: ${roleAttempts.map(([key, value]) => `${key}=${value}`).join(', ')}`);
  }
  for (const failure of parsed.data.recent_failures) {
    lines.push(`Recent failure ${failure.role ?? 'unknown-role'} on ${failure.task_id}: ${failure.why}`);
  }
  if (parsed.data.retry_window) {
    lines.push(
      `Retry window: available at ${parsed.data.retry_window.retry_available_at} after ${parsed.data.retry_window.backoff_seconds} seconds`,
    );
  }
  if (parsed.data.reroute_candidates.length > 0) {
    lines.push(`Reroute candidates: ${parsed.data.reroute_candidates.join(', ')}`);
  }
  return lines.join('\n');
}

function guidedRecoveryGuidance() {
  return [
    'Use platform-produced closure_context, recent recovery outcomes, and attempt history as the recovery contract; do not guess from prose or stale memory.',
    'If a workflow mutation returns recoverable_not_applied, treat it as platform guidance: inspect current state, follow suggested_next_actions, and do not loop the same stale mutation again in the same state.',
    'Follow a fallback ladder: retry transient failures, inspect canonical state, reroute or reassign, rerun missing predecessor work with a corrected brief, waive preferred steps explicitly, close with callouts if legal, and escalate only when closure is impossible without external input.',
    'If recovery options are exhausted and closure remains legal, close with callouts if closure is legal instead of leaving the workflow open.',
  ].join('\n');
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

function readActivationStageTransition(
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
    const previousStageName = readString(payload.previous_stage_name);
    if (previousStageName) {
      return { previousStageName };
    }
  }

  return { previousStageName: null };
}

function hasStageWorkItems(
  orchestratorContext: Record<string, unknown> | null | undefined,
  stageName: string | null,
) {
  if (!stageName) {
    return false;
  }

  const context = asRecord(orchestratorContext);
  const board = asRecord(context.board);
  const workItems = Array.isArray(board.work_items)
    ? board.work_items.filter(
        (entry): entry is Record<string, unknown> =>
          Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry),
      )
    : [];
  return workItems.some((entry) => readString(entry.stage_name) === stageName);
}

function isRepositoryBacked(
  workspace: Record<string, unknown> | null | undefined,
  workflow: Record<string, unknown>,
  taskInput?: Record<string, unknown> | null,
  roleConfig?: Record<string, unknown> | null,
) {
  if (!roleConfigOwnsRepositorySurface(asRecord(roleConfig))) {
    return false;
  }
  return hasRepositoryBinding(workspace, workflow, taskInput);
}

function hasRepositoryBinding(
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

function readOptionalPositiveInteger(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}
