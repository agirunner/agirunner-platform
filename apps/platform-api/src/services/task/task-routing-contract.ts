interface TaskRoutingInput {
  is_orchestrator_task?: unknown;
  role?: unknown;
}

export interface DispatchRoutingRequirements {
  requiredRoutingTag: string | null;
}

export function normalizeRoutingTagList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(
    new Set(
      value
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    ),
  );
}

export function isWorkflowSpecialistRoutingTask(task: TaskRoutingInput): boolean {
  return Boolean(
    readRoleName(task.role)
    && task.is_orchestrator_task !== true
  );
}

export function buildTaskWorkerRoleTag(role: unknown): string | null {
  const roleName = readRoleName(role);
  return roleName ? `role:${roleName}` : null;
}

export function resolveRequiredRoutingTag(task: TaskRoutingInput): string | null {
  if (task.is_orchestrator_task === true) {
    return 'orchestrator';
  }
  return buildTaskWorkerRoleTag(task.role);
}

export function resolveDispatchRoutingRequirements(
  task: TaskRoutingInput,
): DispatchRoutingRequirements {
  return {
    requiredRoutingTag: resolveRequiredRoutingTag(task),
  };
}

export function matchesWorkerToTaskRouting(
  task: TaskRoutingInput,
  workerRoutingTags: string[],
): boolean {
  const normalizedWorkerRoutingTags = normalizeRoutingTagList(workerRoutingTags);
  const requiredRoutingTag = resolveRequiredRoutingTag(task);
  return requiredRoutingTag === null || normalizedWorkerRoutingTags.includes(requiredRoutingTag);
}

function readRoleName(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
