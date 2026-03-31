import type { DatabaseQueryable } from '../../db/database.js';
import { listTaskDocuments } from '../document-reference/document-reference-service.js';
import { buildOrchestratorTaskContext } from '../orchestrator-task-context/orchestrator-task-context.js';
import { resolveRelevantHandoffs } from '../handoff-service/predecessor-handoff-resolver.js';
import { buildSpecialistExecutionBrief } from '../specialist-execution-brief-service/specialist-execution-brief-service.js';
import {
  readSpecialistRoleCapabilities,
  type SpecialistRoleCapabilities,
} from '../specialist/specialist-capability-service.js';
import { loadWorkflowStageProjection } from '../workflow-stage/workflow-stage-projection.js';
import {
  applyTaskContextAnchor,
  buildOrchestratorExecutionBrief,
  readTenantAssembledPromptWarningThreshold,
  resolveTaskContextAnchor,
} from './task-context-anchor.js';
import {
  flattenInstructionLayers,
  summarizeTaskContextAttachments,
  buildInstructionLayers,
} from './task-context-instructions.js';
import {
  TASK_CONTEXT_RECENT_HANDOFF_LIMIT,
} from './task-context-constants.js';
import {
  asOptionalNumber,
  asOptionalString,
  asRecord,
  readFlatInstructions,
  readSuppressedLayers,
  sanitizeTaskContextValue,
  truncateOutput,
} from './task-context-utils.js';
import {
  buildContinuousWorkflowContext,
  buildStandardWorkflowContext,
  isContinuousWorkflowRow,
  loadParentWorkflowContext,
  loadWorkflowInputPackets,
  loadWorkflowLiveVisibilityContext,
  loadWorkflowRelations,
} from './task-context-workflow.js';
import {
  loadOrchestratorPrompt,
  loadPlatformInstructions,
  loadWorkItemContext,
  loadWorkspaceContext,
  loadWorkspaceInstructions,
} from './task-context-workspace.js';

export { flattenInstructionLayers, summarizeTaskContextAttachments };

export async function buildTaskContext(
  db: DatabaseQueryable,
  tenantId: string,
  task: Record<string, unknown>,
  agentId?: string,
) {
  const contextAnchor = resolveTaskContextAnchor(task);
  const contextTask = applyTaskContextAnchor(task, contextAnchor);
  let agent = null;
  if (agentId) {
    const agentRes = await db.query(
      'SELECT id, name, routing_tags, metadata FROM agents WHERE tenant_id = $1 AND id = $2',
      [tenantId, agentId],
    );
    agent = agentRes.rows[0] ?? null;
  } else if (task.assigned_agent_id) {
    const assignedAgentRes = await db.query(
      'SELECT id, name, routing_tags, metadata FROM agents WHERE tenant_id = $1 AND id = $2',
      [tenantId, task.assigned_agent_id],
    );
    agent = assignedAgentRes.rows[0] ?? null;
  }

  const [workspaceRes, workflowRes, depsRes, documents, handoffResolution] = await Promise.all([
    contextTask.workspace_id
      ? db.query(
          `SELECT id,
                  name,
                  description,
                  repository_url,
                  settings,
                  memory
             FROM workspaces
            WHERE tenant_id = $1
              AND id = $2`,
          [tenantId, contextTask.workspace_id],
        )
      : Promise.resolve({ rows: [] }),
    contextTask.workflow_id
      ? db.query(
          `SELECT p.id, p.name, p.context, p.git_branch, p.parameters, p.resolved_config, p.instruction_config,
                  p.metadata,
                  p.live_visibility_mode_override,
                  p.live_visibility_revision,
                  p.playbook_id, p.lifecycle,
                  p.workspace_spec_version,
                  pb.name AS playbook_name, pb.outcome AS playbook_outcome, pb.definition AS playbook_definition
           FROM workflows p
           LEFT JOIN playbooks pb ON pb.tenant_id = p.tenant_id AND pb.id = p.playbook_id
           WHERE p.tenant_id = $1 AND p.id = $2`,
          [tenantId, contextTask.workflow_id],
        )
      : Promise.resolve({ rows: [] }),
    (contextTask.depends_on as string[]).length > 0
      ? db.query(
          "SELECT id, role, title, output FROM tasks WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND state = 'completed'",
          [tenantId, contextTask.depends_on],
        )
      : Promise.resolve({ rows: [] }),
    listTaskDocuments(db, tenantId, contextTask),
    resolveRelevantHandoffs(db, tenantId, contextTask, TASK_CONTEXT_RECENT_HANDOFF_LIMIT),
  ]);
  const recentHandoffs = handoffResolution.handoffs;
  const predecessorHandoff = recentHandoffs[0] ?? null;

  const upstreamOutputs = Object.fromEntries(
    depsRes.rows.map((row) => [
      row.role ?? row.title ?? row.id,
      { task_name: row.title ?? row.role ?? row.id, output: truncateOutput(row.output ?? {}) },
    ]),
  );

  const workflowRow = workflowRes.rows[0] as Record<string, unknown> | undefined;
  const continuousWorkflowRow =
    workflowRow && isContinuousWorkflowRow(workflowRow) ? workflowRow : null;
  const workItem = await loadWorkItemContext(db, tenantId, contextTask);
  const workspaceContext = await loadWorkspaceContext(
    db,
    tenantId,
    workspaceRes.rows[0] as Record<string, unknown> | undefined,
    contextTask,
  );
  const stageProjection = workflowRow
    ? await loadWorkflowStageProjection(db, tenantId, String(workflowRow.id), {
        lifecycle: continuousWorkflowRow ? 'ongoing' : 'planned',
        definition: workflowRow.playbook_definition,
      })
    : null;
  const activeStages = stageProjection?.activeStages ?? [];
  const workflowRelations = workflowRow
    ? await loadWorkflowRelations(db, tenantId, workflowRow)
    : null;
  const parentWorkflowContext = workflowRelations?.parent?.workflow_id
    ? await loadParentWorkflowContext(db, tenantId, workflowRelations.parent.workflow_id)
    : null;
  const workspaceInstructions = await loadWorkspaceInstructions(db, tenantId, task, workflowRow);
  const platformInstructions = await loadPlatformInstructions(db, tenantId);
  const assembledPromptWarningThresholdChars = await readTenantAssembledPromptWarningThreshold(
    db,
    tenantId,
  );
  const orchestratorPrompt = task.is_orchestrator_task
    ? await loadOrchestratorPrompt(db, tenantId)
    : undefined;
  const specialistCapabilities: SpecialistRoleCapabilities | null =
    task.is_orchestrator_task || !asOptionalString(task.role)
      ? null
      : await readSpecialistRoleCapabilities(db, tenantId, String(task.role));
  const flatInstructions = readFlatInstructions(asRecord(task.role_config), agent?.metadata);
  const orchestratorContext = await buildOrchestratorTaskContext(db, tenantId, task);
  const workflowInputPackets = workflowRow
    ? await loadWorkflowInputPackets(db, tenantId, String(workflowRow.id))
    : [];
  const workflowLiveVisibility = workflowRow
    ? await loadWorkflowLiveVisibilityContext(db, tenantId, contextTask, workflowRow)
    : null;
  const workflowContext = workflowRow
    ? continuousWorkflowRow
      ? buildContinuousWorkflowContext({
          workflowRow: continuousWorkflowRow,
          activeStages,
          workflowRelations,
          parentWorkflowContext,
          inputPackets: workflowInputPackets,
        })
      : await buildStandardWorkflowContext({
          workflowRow,
          activeStages,
          currentStage: stageProjection?.currentStage ?? null,
          workflowRelations,
          parentWorkflowContext,
          inputPackets: workflowInputPackets,
        })
    : null;
  if (workflowContext && workflowLiveVisibility) {
    workflowContext.live_visibility = workflowLiveVisibility;
  }
  const instructionLayers = buildInstructionLayers({
    platformInstructions,
    orchestratorPrompt,
    isOrchestratorTask: Boolean(task.is_orchestrator_task),
    workspaceInstructions,
    roleConfig: asRecord(task.role_config),
    specialistCapabilities: specialistCapabilities ?? undefined,
    taskInput: asRecord(task.input),
    taskId: String(task.id ?? ''),
    workspaceId: asOptionalString(task.workspace_id),
    workspaceSpecVersion: asOptionalNumber(workflowRow?.workspace_spec_version),
    role: asOptionalString(task.role),
    suppressLayers: readSuppressedLayers(workflowRow?.instruction_config),
    workflowContext,
    workspace: workspaceContext ?? undefined,
    workItem,
    predecessorHandoff,
    orchestratorContext: orchestratorContext as Record<string, unknown> | undefined,
  });
  const executionBrief = task.is_orchestrator_task
    ? buildOrchestratorExecutionBrief(workflowLiveVisibility)
    : buildSpecialistExecutionBrief({
        role: asOptionalString(task.role) ?? null,
        roleConfig: asRecord(task.role_config),
        specialistCapabilities: specialistCapabilities ?? undefined,
        workflow: workflowContext ?? null,
        workspace: workspaceContext ?? null,
        workItem,
        predecessorHandoff,
        taskInput: asRecord(task.input),
        executionEnvironmentSnapshot:
          task.execution_environment_snapshot &&
          typeof task.execution_environment_snapshot === 'object'
            ? (task.execution_environment_snapshot as Record<string, unknown>)
            : null,
      });

  return {
    agent: sanitizeTaskContextValue(agent),
    agentic_settings: sanitizeTaskContextValue({
      assembled_prompt_warning_threshold_chars: assembledPromptWarningThresholdChars,
    }),
    workspace: sanitizeTaskContextValue(workspaceContext),
    workflow: sanitizeTaskContextValue(workflowContext),
    orchestrator: sanitizeTaskContextValue(orchestratorContext),
    documents: sanitizeTaskContextValue(documents),
    instructions: sanitizeTaskContextValue(flatInstructions),
    instruction_layers: sanitizeTaskContextValue(instructionLayers),
    execution_brief: sanitizeTaskContextValue(executionBrief),
    task: {
      id: task.id,
      input: sanitizeTaskContextValue(task.input),
      context: sanitizeTaskContextValue(task.context),
      context_anchor: sanitizeTaskContextValue(contextAnchor),
      work_item: sanitizeTaskContextValue(workItem),
      predecessor_handoff: sanitizeTaskContextValue(predecessorHandoff),
      predecessor_handoff_resolution: sanitizeTaskContextValue(handoffResolution),
      recent_handoffs: sanitizeTaskContextValue(recentHandoffs),
      failure_mode:
        task.context && typeof task.context === 'object' && !Array.isArray(task.context)
          ? ((task.context as Record<string, unknown>).failure_mode ?? null)
          : null,
      role_config: sanitizeTaskContextValue(task.role_config),
      upstream_outputs: sanitizeTaskContextValue(upstreamOutputs),
    },
  };
}
