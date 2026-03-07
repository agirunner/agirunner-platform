import {
  ConflictError,
  CycleDetectedError,
  SchemaValidationFailedError,
} from '../errors/domain-errors.js';

export type WorkflowGateType = 'none' | 'all_complete' | 'manual' | 'auto';

export interface WorkflowPhaseDefinition {
  name: string;
  gate: WorkflowGateType;
  parallel: boolean;
  tasks: string[];
}

export interface WorkflowDefinition {
  phases: WorkflowPhaseDefinition[];
  patterns?: Record<string, unknown>;
}

export interface StoredWorkflowPhase {
  name: string;
  gate: WorkflowGateType;
  parallel: boolean;
  task_refs: string[];
  task_ids: string[];
}

export interface StoredWorkflowDefinition {
  phases: StoredWorkflowPhase[];
}

const allowedGateTypes = new Set<WorkflowGateType>(['none', 'all_complete', 'manual', 'auto']);
const terminalStates = new Set(['completed', 'failed', 'cancelled']);

export function validateWorkflowDefinition(params: {
  workflow: unknown;
  taskIds: string[];
  dependencyMap: Map<string, string[]>;
  patterns?: Record<string, unknown>;
}): WorkflowDefinition {
  const { workflow, taskIds, dependencyMap, patterns } = params;
  if (workflow === undefined) {
    return {
      phases: [
        {
          name: 'default',
          gate: 'none',
          parallel: true,
          tasks: [...taskIds],
        },
      ],
      ...(patterns ? { patterns } : {}),
    };
  }
  if (!isObject(workflow)) {
    throw new SchemaValidationFailedError("Template schema field 'workflow' must be an object");
  }

  const phasesValue = workflow.phases;
  if (!Array.isArray(phasesValue) || phasesValue.length === 0) {
    throw new SchemaValidationFailedError("Template workflow requires a non-empty 'phases' array");
  }

  const phases = phasesValue.map((rawPhase, index) => {
    if (!isObject(rawPhase)) {
      throw new SchemaValidationFailedError(`Workflow phase at index ${index} must be an object`);
    }
    if (typeof rawPhase.name !== 'string' || rawPhase.name.trim().length === 0) {
      throw new SchemaValidationFailedError(
        `Workflow phase at index ${index} requires a non-empty string 'name'`,
      );
    }
    if (!Array.isArray(rawPhase.tasks) || rawPhase.tasks.length === 0) {
      throw new SchemaValidationFailedError(
        `Workflow phase '${rawPhase.name}' requires a non-empty 'tasks' array`,
      );
    }

    const gate =
      rawPhase.gate === undefined
        ? 'all_complete'
        : typeof rawPhase.gate === 'string' && allowedGateTypes.has(rawPhase.gate as WorkflowGateType)
          ? (rawPhase.gate as WorkflowGateType)
          : null;
    if (!gate) {
      throw new SchemaValidationFailedError(
        `Workflow phase '${rawPhase.name}' has invalid gate '${String(rawPhase.gate)}'`,
      );
    }

    return {
      name: rawPhase.name,
      gate,
      parallel: rawPhase.parallel !== false,
      tasks: rawPhase.tasks.map((taskRef) => {
        if (typeof taskRef !== 'string' || taskRef.trim().length === 0) {
          throw new SchemaValidationFailedError(
            `Workflow phase '${rawPhase.name}' contains an invalid task reference`,
          );
        }
        return taskRef;
      }),
    } satisfies WorkflowPhaseDefinition;
  });

  assertUniquePhaseNames(phases);
  assertWorkflowTaskCoverage(phases, taskIds);
  assertDependencyPlacement(phases, dependencyMap);

  return {
    phases,
    ...(patterns ? { patterns } : {}),
  };
}

export function applySequentialPhaseDependencies(
  workflow: WorkflowDefinition,
  dependencyMap: Map<string, string[]>,
): Map<string, string[]> {
  const nextMap = new Map<string, string[]>();
  for (const [taskId, deps] of dependencyMap.entries()) {
    nextMap.set(taskId, [...deps]);
  }

  for (const phase of workflow.phases) {
    if (phase.parallel) {
      continue;
    }
    for (let index = 1; index < phase.tasks.length; index += 1) {
      const taskId = phase.tasks[index];
      const previousTaskId = phase.tasks[index - 1];
      const deps = nextMap.get(taskId) ?? [];
      if (!deps.includes(previousTaskId)) {
        deps.push(previousTaskId);
      }
      nextMap.set(taskId, deps);
    }
  }

  for (const phase of workflow.phases) {
    const localCycle = detectDependencyCycle(
      phase.tasks.map((taskId) => ({
        id: taskId,
        depends_on: (nextMap.get(taskId) ?? []).filter((dep) => phase.tasks.includes(dep)),
      })),
    );
    if (localCycle) {
      throw new CycleDetectedError('Template dependency graph contains a cycle', {
        cycle_path: localCycle,
      });
    }
  }

  return nextMap;
}

export function buildStoredWorkflow(
  workflow: WorkflowDefinition,
  taskIdMap: Map<string, string>,
): StoredWorkflowDefinition {
  return {
    phases: workflow.phases.map((phase) => ({
      name: phase.name,
      gate: phase.gate,
      parallel: phase.parallel,
      task_refs: [...phase.tasks],
      task_ids: phase.tasks.map((taskRef) => {
        const taskId = taskIdMap.get(taskRef);
        if (!taskId) {
          throw new SchemaValidationFailedError(
            `Workflow phase '${phase.name}' references unknown task '${taskRef}'`,
          );
        }
        return taskId;
      }),
    })),
  };
}

export function resolveWorkflowDependencies(
  workflow: WorkflowDefinition,
  dependencyMap: Map<string, string[]>,
): Map<string, string[]> {
  const phaseIndexByTask = new Map<string, number>();
  for (const [phaseIndex, phase] of workflow.phases.entries()) {
    for (const taskId of phase.tasks) {
      phaseIndexByTask.set(taskId, phaseIndex);
    }
  }

  const resolved = new Map<string, string[]>();
  for (const [taskId, deps] of dependencyMap.entries()) {
    const taskPhaseIndex = phaseIndexByTask.get(taskId) ?? 0;
    resolved.set(
      taskId,
      deps.map((dep) => {
        if (!dep.includes('.')) {
          return dep;
        }
        const [phaseName, phaseTaskId] = dep.split('.', 2);
        const phaseIndex = workflow.phases.findIndex((phase) => phase.name === phaseName);
        if (phaseIndex === -1 || phaseIndex > taskPhaseIndex) {
          throw new SchemaValidationFailedError(
            `Task '${taskId}' references invalid cross-phase dependency '${dep}'`,
          );
        }
        if (!workflow.phases[phaseIndex].tasks.includes(phaseTaskId)) {
          throw new SchemaValidationFailedError(
            `Task '${taskId}' references unknown cross-phase dependency '${dep}'`,
          );
        }
        return phaseTaskId;
      }),
    );
  }
  return resolved;
}

function assertUniquePhaseNames(phases: WorkflowPhaseDefinition[]) {
  const names = new Set<string>();
  for (const phase of phases) {
    if (names.has(phase.name)) {
      throw new ConflictError(`Duplicate workflow phase '${phase.name}' in template schema`);
    }
    names.add(phase.name);
  }
}

function assertWorkflowTaskCoverage(phases: WorkflowPhaseDefinition[], taskIds: string[]) {
  const knownTaskIds = new Set(taskIds);
  const assignedTaskIds = new Set<string>();
  for (const phase of phases) {
    for (const taskId of phase.tasks) {
      if (!knownTaskIds.has(taskId)) {
        throw new SchemaValidationFailedError(
          `Workflow phase '${phase.name}' references unknown task '${taskId}'`,
        );
      }
      if (assignedTaskIds.has(taskId)) {
        throw new ConflictError(`Task '${taskId}' is assigned to multiple workflow phases`);
      }
      assignedTaskIds.add(taskId);
    }
  }

  for (const taskId of taskIds) {
    if (!assignedTaskIds.has(taskId)) {
      throw new SchemaValidationFailedError(
        `Workflow definition does not assign task '${taskId}' to a phase`,
      );
    }
  }
}

function assertDependencyPlacement(
  phases: WorkflowPhaseDefinition[],
  dependencyMap: Map<string, string[]>,
) {
  const taskPhase = new Map<string, { index: number; phaseName: string }>();
  for (const [index, phase] of phases.entries()) {
    for (const taskId of phase.tasks) {
      taskPhase.set(taskId, { index, phaseName: phase.name });
    }
  }

  for (const [taskId, deps] of dependencyMap.entries()) {
    const phase = taskPhase.get(taskId);
    if (!phase) {
      continue;
    }
    for (const dep of deps) {
      if (!dep.includes('.')) {
        if (taskPhase.get(dep)?.phaseName !== phase.phaseName) {
          throw new SchemaValidationFailedError(
            `Task '${taskId}' depends_on '${dep}' outside phase '${phase.phaseName}'. Use dotted cross-phase notation.`,
          );
        }
        continue;
      }

      const [phaseName, phaseTaskId] = dep.split('.', 2);
      const referencedPhase = phases.findIndex((item) => item.name === phaseName);
      if (referencedPhase === -1) {
        throw new SchemaValidationFailedError(
          `Task '${taskId}' depends_on unknown phase reference '${dep}'`,
        );
      }
      if (!phases[referencedPhase].tasks.includes(phaseTaskId)) {
        throw new SchemaValidationFailedError(
          `Task '${taskId}' depends_on unknown phase task '${dep}'`,
        );
      }
      if (referencedPhase >= phase.index) {
        throw new SchemaValidationFailedError(
          `Task '${taskId}' cannot depend on forward phase reference '${dep}'`,
        );
      }
    }
  }
}

function detectDependencyCycle(
  tasks: Array<{ id: string; depends_on?: string[] }>,
): string[] | null {
  const adjacency = new Map(tasks.map((task) => [task.id, task.depends_on ?? []]));
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const stack: string[] = [];

  const visit = (node: string): string[] | null => {
    visited.add(node);
    inStack.add(node);
    stack.push(node);

    for (const dep of adjacency.get(node) ?? []) {
      if (!visited.has(dep)) {
        const cycle = visit(dep);
        if (cycle) {
          return cycle;
        }
      } else if (inStack.has(dep)) {
        const cycleStart = stack.indexOf(dep);
        return [...stack.slice(cycleStart), dep];
      }
    }

    stack.pop();
    inStack.delete(node);
    return null;
  };

  for (const task of tasks) {
    if (!visited.has(task.id)) {
      const cycle = visit(task.id);
      if (cycle) {
        return cycle;
      }
    }
  }

  return null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function isTerminalTaskState(state: string): boolean {
  return terminalStates.has(state);
}
