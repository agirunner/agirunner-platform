import {
  buildActivationActivity,
  buildChildWorkflowActivity,
  buildEscalationActivity,
  buildGateActivity,
  buildOrchestratorAnalytics,
  buildProducedArtifacts,
  buildWorkItemActivity,
} from './playbook-run-summary-activity.js';
import {
  buildStageActivity,
  buildStageGateHistory,
  buildStageProgression,
  buildStageTiming,
  countByColumn,
  normalizeContinuousStages,
} from './playbook-run-summary-stage-support.js';
import type { BuildPlaybookRunSummaryParams } from './playbook-run-summary.types.js';
import {
  asOptionalString,
  asRecord,
  calculateDurationSeconds,
  readWorkflowLifecycle,
  readWorkflowRelations,
  sanitizeWorkflowSummary,
} from './playbook-run-summary-utils.js';

export function buildPlaybookRunSummary(params: BuildPlaybookRunSummaryParams) {
  const metadata = asRecord(params.workflow.metadata);
  const relations = readWorkflowRelations(params.workflow, metadata);
  const lifecycle = readWorkflowLifecycle(params.workflow);
  const stages =
    lifecycle === 'ongoing'
      ? normalizeContinuousStages(params.stages, params.workItems)
      : params.stages;
  const activationActivity = buildActivationActivity(params.activations ?? [], params.events);
  const workItemActivity = buildWorkItemActivity(stages, params.workItems, params.events);
  const gateActivity = buildGateActivity(stages, params.gates ?? [], params.events);
  const escalationActivity = buildEscalationActivity(params.tasks, params.events);
  const childWorkflowActivity = buildChildWorkflowActivity(metadata, relations, params.events);
  const orchestratorAnalytics = buildOrchestratorAnalytics(params.tasks, activationActivity);
  const reworkByTask = params.tasks
    .filter((task) => Number(task.rework_count ?? 0) > 0)
    .map((task) => ({
      task_id: String(task.id),
      role: asOptionalString(task.role),
      rework_count: Number(task.rework_count ?? 0),
    }));

  const summary = {
    kind: 'run_summary',
    workflow_id: String(params.workflow.id),
    name: String(params.workflow.name),
    state: String(params.workflow.state),
    created_at: params.workflow.created_at,
    started_at: params.workflow.started_at ?? null,
    completed_at: params.workflow.completed_at ?? null,
    duration_seconds: calculateDurationSeconds(
      params.workflow.started_at,
      params.workflow.completed_at,
    ),
    rework_cycles: params.tasks.reduce((sum, task) => sum + Number(task.rework_count ?? 0), 0),
    rework_by_task: reworkByTask,
    lifecycle,
    activation_activity: activationActivity,
    work_item_activity: workItemActivity,
    gate_activity: gateActivity,
    escalation_activity: escalationActivity,
    child_workflow_activity: childWorkflowActivity,
    orchestrator_analytics: orchestratorAnalytics,
    stage_progression:
      lifecycle === 'ongoing' ? null : buildStageProgression(stages, params.workItems),
    stage_activity:
      lifecycle === 'ongoing' ? buildStageActivity(stages, params.workItems) : null,
    stage_metrics: stages.map((stage) => {
      const stageItems = params.workItems.filter((item) => item.stage_name === stage.name);
      return {
        name: stage.name,
        goal: stage.goal,
        status: stage.status,
        gate_status: stage.gate_status,
        iteration_count: stage.iteration_count,
        summary: stage.summary,
        work_item_counts: {
          total: stageItems.length,
          completed: stageItems.filter((item) => item.completed_at).length,
          open: stageItems.filter((item) => !item.completed_at).length,
          by_column: countByColumn(stageItems),
        },
        timing: buildStageTiming(stage, params.events, stageItems),
        gate_history: buildStageGateHistory(params.gates ?? [], params.events, stage.name),
      };
    }),
    produced_artifacts: buildProducedArtifacts(params.tasks, params.artifacts),
    workflow_relations: relations,
    link: `/workflows/${String(params.workflow.id)}`,
  };
  return sanitizeWorkflowSummary(summary);
}
