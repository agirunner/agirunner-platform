import { buildStageRoleCoverage } from '../workflow-stage/stage-role-coverage.js';
import { parsePlaybookDefinition } from '../../orchestration/playbook-model.js';
import {
  asRecord,
  readNumber,
  readOptionalPositiveInteger,
  readString,
  readStringArray,
} from './shared.js';
import {
  buildWorkflowBriefSection,
} from './briefing.js';
import {
  hasStageWorkItems,
  mergeOrchestratorWorkflowContext,
  readActivationStageTransition,
  readBoardTasks,
  readOrchestratorActivationAnchor,
  readOrchestratorRoleCatalog,
  readPendingDispatches,
  selectFocusedWorkItem,
} from './orchestrator-context.js';
import {
  formatClosureContext,
  formatOperatorVisibilitySection,
  formatPendingDispatches,
  formatRoleCatalog,
  guidedRecoveryGuidance,
} from './supporting-text.js';
import type { WorkflowInstructionLayerInput } from './types.js';

export function buildOrchestratorSections(params: {
  input: WorkflowInstructionLayerInput;
  workflow: Record<string, unknown>;
  definition: ReturnType<typeof parsePlaybookDefinition>;
  repoBacked: boolean;
}) {
  const workflow = asRecord(params.workflow);
  const lifecycle = workflow.lifecycle === 'ongoing' ? 'ongoing' : 'planned';
  const workflowInstructionContext = mergeOrchestratorWorkflowContext(workflow, params.input.orchestratorContext);
  const activationAnchor = readOrchestratorActivationAnchor(params.input.orchestratorContext);
  const activationTransition = readActivationStageTransition(params.input.orchestratorContext);
  const focusedWorkItem = selectFocusedWorkItem(params.input.orchestratorContext, activationAnchor);
  const stageName =
    activationAnchor.stageName
    ?? readString(focusedWorkItem.stage_name)
    ?? deriveSoleActiveStageName(workflow)
    ?? readString(workflow.current_stage)
    ?? null;
  const stage = params.definition.stages.find(
    (entry: { name: string; goal: string; guidance?: string; involves?: string[] }) => entry.name === stageName,
  ) ?? null;
  const boardColumn = params.definition.board.columns.find(
    (entry: { id: string; label: string }) => entry.id === readString(focusedWorkItem.column_id),
  );
  const currentStageHasWorkItems = hasStageWorkItems(params.input.orchestratorContext, stageName);
  const sections = [
    `## Workflow Mode: ${lifecycle}\n${workflowModeGuidance(lifecycle)}`,
    buildWorkflowBriefSection(workflowInstructionContext),
    `## Process Instructions\n${params.definition.process_instructions}`,
    `## Progress Model\n${progressModelGuidance(params.definition)}`,
  ];

  if (stage) {
    sections.push(`## Current Stage\n${stage.name}\nGoal: ${stage.goal}`);
    const successorStage = nextStageName(params.definition, stage.name);
    if (lifecycle === 'planned') {
      sections.push(`## Stage Routing\n${formatStageRouting(stage.name, successorStage)}`);
      sections.push(`## Stage Name Contract\n${formatStageNameContract(params.definition)}`);
      const emptyStageGuidance = formatEmptyPlannedStageGuidance(
        params.definition,
        stage.name,
        activationTransition.previousStageName,
        currentStageHasWorkItems,
      );
      if (emptyStageGuidance) {
        sections.push(`## Successor Seeding\n${emptyStageGuidance}`);
      }
    }
  } else if (boardColumn) {
    sections.push(`## Current Board Focus\n${boardColumn.label}`);
  }

  const activeStages = readStringArray(workflowInstructionContext.active_stages);
  if (lifecycle === 'ongoing' && activeStages.length > 0) {
    sections.push(`## Active Stages\n${activeStages.join(', ')}`);
  }

  const stageRoleCoverage = formatStageRoleCoverage(stage, focusedWorkItem, readBoardTasks(params.input.orchestratorContext));
  if (stageRoleCoverage) {
    sections.push(`## Stage Role Coverage\n${stageRoleCoverage}`);
  }

  const roleCatalog = readOrchestratorRoleCatalog(workflowInstructionContext);
  if (roleCatalog.length > 0) {
    sections.push(`## Available Roles\n${formatRoleCatalog(roleCatalog)}`);
  }

  sections.push(`## Active Continuity\n${formatRuleResults(focusedWorkItem)}`);
  const pendingDispatches = readPendingDispatches(params.input.orchestratorContext);
  if (pendingDispatches.length > 0) {
    sections.push(`## Pending Dispatches\n${formatPendingDispatches(pendingDispatches)}`);
  }
  if (lifecycle === 'planned') {
    sections.push(`## Handoff Semantics\n${formatPlannedHandoffSemantics()}`);
  }
  sections.push(`## Closure Discipline\n${workItemClosureDiscipline(lifecycle)}`);
  const closureContextSection = formatClosureContext(workflowInstructionContext);
  if (closureContextSection) {
    sections.push(`## Closure Context\n${closureContextSection}`);
  }
  sections.push(`## Guided Recovery\n${guidedRecoveryGuidance()}`);
  sections.push(
    '## Activation Discipline\nAfter you dispatch required specialist work, request a gate, or detect active subordinate work with no new routing decision to make, finish this activation and wait for the next workflow event. Active subordinate work means real work items and non-orchestrator specialist tasks, never the current orchestrator task itself. Do not use read_task_status on the current orchestrator task id as evidence that stage work already exists. Do not poll running tasks in a loop. If no subordinate work is active and the workflow should progress, perform the workflow mutation now. A recommendation without the required workflow mutation does not complete the activation.',
  );

  const orchestrator = params.definition.orchestrator ?? {};
  const parallelLines = [
    `Max active tasks: ${orchestrator.max_active_tasks ?? 'not set'}`,
    `Max per work item: ${orchestrator.max_active_tasks_per_work_item ?? 'not set'}`,
    `Parallel work items: ${orchestrator.allow_parallel_work_items === false ? 'disabled' : 'enabled'}`,
  ];
  sections.push(`## Parallelism\n${parallelLines.join('\n')}`);
  const operatorVisibilitySection = formatOperatorVisibilitySection(asRecord(workflowInstructionContext.live_visibility));
  if (operatorVisibilitySection) {
    sections.push(operatorVisibilitySection);
  }

  sections.push(`## Output Protocol\n${outputProtocol(params.repoBacked, true)}`);
  return sections.filter((section) => section.trim().length > 0);
}

export function buildSpecialistSections(params: {
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

function deriveSoleActiveStageName(workflow: Record<string, unknown>) {
  const activeStages = readStringArray(workflow.active_stages);
  return activeStages.length === 1 ? activeStages[0] : null;
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

function formatStageNameContract(definition: ReturnType<typeof parsePlaybookDefinition>) {
  const stageNames = definition.stages
    .map((entry) => entry.name.trim())
    .filter((name) => name.length > 0);
  if (stageNames.length === 0) {
    return 'Use only exact authored stage_name values when routing work items or tasks. Do not paraphrase or shorten stage names.';
  }
  return `Use only these exact authored stage_name values when routing work: ${stageNames.join(', ')}. Do not paraphrase, shorten, or invent alternate stage names.`;
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
    `If list_work_items returns no work items in "${currentStageName}" and list_workflow_tasks returns no non-orchestrator tasks for that stage, create the first work item and starter specialist task now instead of waiting on the current orchestrator task.`,
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
  const stageIndex = definition.stages.findIndex((entry: { name: string }) => entry.name === stageName);
  if (stageIndex < 0) {
    return null;
  }
  return definition.stages[stageIndex + 1]?.name ?? null;
}

function starterRolesForStage(
  definition: ReturnType<typeof parsePlaybookDefinition>,
  stageName: string,
) {
  const stage = definition.stages.find((entry: { name: string; involves?: string[] }) => entry.name === stageName);
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
  const lines = coverage.map((entry: { role: string; description: string }) => `- ${entry.role}: ${entry.description}`);
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
