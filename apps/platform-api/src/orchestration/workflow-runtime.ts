import type { DatabaseClient } from '../db/database.js';
import { ConflictError, NotFoundError } from '../errors/domain-errors.js';
import type { WorkflowGateType, StoredWorkflowDefinition } from './workflow-model.js';
import type { TaskState } from './task-state-machine.js';

export interface WorkflowPhaseView {
  name: string;
  status: 'pending' | 'active' | 'gate_waiting' | 'completed' | 'cancelled';
  gate: WorkflowGateType;
  gate_status: 'awaiting_approval' | 'approved' | 'rejected' | 'none';
}

export interface WorkflowGateDecision {
  status: 'awaiting_approval' | 'approved' | 'rejected';
  action: 'approve' | 'reject' | 'request_changes';
  feedback?: string;
  acted_at: string;
  acted_by: string;
}

export interface StoredWorkflowRuntimeState {
  phase_gates?: Record<string, WorkflowGateDecision>;
}

export function readStoredWorkflow(value: unknown): StoredWorkflowDefinition | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const workflow = value as StoredWorkflowDefinition;
  if (!Array.isArray(workflow.phases)) {
    return null;
  }
  return workflow;
}

export function readWorkflowRuntimeState(value: unknown): StoredWorkflowRuntimeState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as StoredWorkflowRuntimeState;
}

export function deriveWorkflowView(
  workflow: StoredWorkflowDefinition | null,
  tasks: Array<Record<string, unknown>>,
  runtimeState: StoredWorkflowRuntimeState = {},
): {
  phases: Array<WorkflowPhaseView & { progress: { completed_tasks: number; total_tasks: number } }>;
  current_phase: string | null;
  phase_progress: Record<string, { completed_tasks: number; total_tasks: number }>;
} {
  if (!workflow) {
    return {
      phases: [],
      current_phase: null,
      phase_progress: {},
    };
  }

  const taskMap = new Map(tasks.map((task) => [String(task.id), task]));
  const phaseGates = runtimeState.phase_gates ?? {};
  const phases = workflow.phases.map((phase, index) => {
    const phaseTasks = phase.task_ids
      .map((taskId) => taskMap.get(taskId))
      .filter((task): task is Record<string, unknown> => Boolean(task));
    const completedCount = phaseTasks.filter((task) => task.state === 'completed').length;
    const allCompleted = phaseTasks.length > 0 && completedCount === phaseTasks.length;
    const allCancelled =
      phaseTasks.length > 0 && phaseTasks.every((task) => String(task.state) === 'cancelled');
    const hasActiveWork = phaseTasks.some((task) =>
      ['ready', 'claimed', 'running', 'awaiting_approval', 'output_pending_review'].includes(
        String(task.state),
      ),
    );
    const previousPhasesSatisfied = workflow.phases.slice(0, index).every((previousPhase) => {
      const gate = phaseGates[previousPhase.name];
      if (previousPhase.gate === 'manual') {
        return gate?.status === 'approved';
      }
      return previousPhase.task_ids.every((taskId) => taskMap.get(taskId)?.state === 'completed');
    });

    let status: WorkflowPhaseView['status'] = 'pending';
    let gateStatus: WorkflowPhaseView['gate_status'] = 'none';
    const gateDecision = phaseGates[phase.name];

    if (allCancelled) {
      status = 'cancelled';
    } else if (allCompleted && phase.gate === 'manual') {
      gateStatus = gateDecision?.status ?? 'awaiting_approval';
      status = gateStatus === 'approved' ? 'completed' : 'gate_waiting';
    } else if (allCompleted) {
      status = 'completed';
    } else if (previousPhasesSatisfied && hasActiveWork) {
      status = 'active';
    }

    return {
      name: phase.name,
      status,
      gate: phase.gate,
      gate_status: gateStatus,
      progress: {
        completed_tasks: completedCount,
        total_tasks: phase.task_ids.length,
      },
    };
  });

  const currentPhase =
    phases.find((phase) => phase.status === 'active' || phase.status === 'gate_waiting')?.name ??
    null;

  return {
    phases,
    current_phase: currentPhase,
    phase_progress: Object.fromEntries(phases.map((phase) => [phase.name, phase.progress])),
  };
}

export async function activateNextWorkflowPhase(params: {
  tenantId: string;
  pipelineId: string;
  workflow: StoredWorkflowDefinition;
  currentPhaseName: string;
  tasks: Array<Record<string, unknown>>;
  client: DatabaseClient;
}): Promise<{ activated: boolean; phaseName: string | null }> {
  const { tenantId, workflow, currentPhaseName, tasks, client } = params;
  const currentIndex = workflow.phases.findIndex((phase) => phase.name === currentPhaseName);
  const nextPhase = currentIndex >= 0 ? workflow.phases[currentIndex + 1] : null;
  if (!nextPhase) {
    return { activated: false, phaseName: null };
  }

  let activatedAny = false;
  for (const nextTask of tasks.filter((candidate) => nextPhase.task_ids.includes(String(candidate.id)))) {
    if (nextTask.state !== 'pending') {
      continue;
    }
    const dependencies = Array.isArray(nextTask.depends_on)
      ? (nextTask.depends_on as string[])
      : [];
    const depsComplete = dependencies.every((dependencyId) => {
      const dependency = tasks.find((candidate) => String(candidate.id) === String(dependencyId));
      return dependency ? dependency.state === 'completed' : false;
    });
    if (!depsComplete) {
      continue;
    }

    const nextState: TaskState = nextTask.requires_approval ? 'awaiting_approval' : 'ready';
    await client.query(
      'UPDATE tasks SET state = $3, state_changed_at = now() WHERE tenant_id = $1 AND id = $2',
      [tenantId, nextTask.id, nextState],
    );
    nextTask.state = nextState;
    activatedAny = true;
  }

  return { activated: activatedAny, phaseName: nextPhase.name };
}

export function getWorkflowPhaseOrThrow(
  workflow: StoredWorkflowDefinition,
  phaseName: string,
): { name: string; gate: WorkflowGateType; parallel: boolean; task_refs: string[]; task_ids: string[] } {
  const phase = workflow.phases.find((candidate) => candidate.name === phaseName);
  if (!phase) {
    throw new NotFoundError('Pipeline phase not found');
  }
  return phase;
}

export function assertManualPhaseGateReady(params: {
  workflow: StoredWorkflowDefinition;
  phaseName: string;
  tasks: Array<Record<string, unknown>>;
  runtimeState: StoredWorkflowRuntimeState;
}) {
  const phase = getWorkflowPhaseOrThrow(params.workflow, params.phaseName);
  if (phase.gate !== 'manual') {
    throw new ConflictError('Pipeline phase does not use a manual gate');
  }
  const phaseTasks = params.tasks.filter((task) => phase.task_ids.includes(String(task.id)));
  const allCompleted = phaseTasks.length > 0 && phaseTasks.every((task) => task.state === 'completed');
  if (!allCompleted) {
    throw new ConflictError('Pipeline phase is not ready for gate action');
  }
  const gateStatus = params.runtimeState.phase_gates?.[phase.name]?.status;
  if (gateStatus === 'approved') {
    throw new ConflictError('Pipeline phase gate is already approved');
  }
}

export function assertPhaseCancelable(
  workflow: StoredWorkflowDefinition,
  phaseName: string,
): { name: string; task_ids: string[] }[] {
  const phaseIndex = workflow.phases.findIndex((phase) => phase.name === phaseName);
  if (phaseIndex === -1) {
    throw new NotFoundError('Pipeline phase not found');
  }
  return workflow.phases.slice(phaseIndex).map((phase) => ({
    name: phase.name,
    task_ids: phase.task_ids,
  }));
}
