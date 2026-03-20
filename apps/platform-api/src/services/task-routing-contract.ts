interface TaskRoutingInput {
  workflow_id?: unknown;
  work_item_id?: unknown;
  is_orchestrator_task?: unknown;
  role?: unknown;
  capabilities_required?: unknown;
}

export interface DispatchRoutingRequirements {
  requiredCapabilities: string[];
  requiredRoleTag: string | null;
}

export function normalizeCapabilityList(value: unknown): string[] {
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
    && (readUuidLike(task.workflow_id) || readUuidLike(task.work_item_id)),
  );
}

export function buildTaskWorkerRoleTag(role: unknown): string | null {
  const roleName = readRoleName(role);
  return roleName ? `role:${roleName}` : null;
}

export function resolveDispatchRoutingRequirements(
  task: TaskRoutingInput,
): DispatchRoutingRequirements {
  if (isWorkflowSpecialistRoutingTask(task)) {
    return {
      requiredCapabilities: [],
      requiredRoleTag: buildTaskWorkerRoleTag(task.role),
    };
  }
  return {
    requiredCapabilities: normalizeCapabilityList(task.capabilities_required),
    requiredRoleTag: null,
  };
}

export function matchesWorkerToTaskRouting(
  task: TaskRoutingInput,
  workerCapabilities: string[],
): boolean {
  const normalizedWorkerCapabilities = normalizeCapabilityList(workerCapabilities);
  const roleTag = buildTaskWorkerRoleTag(task.role);
  if (isWorkflowSpecialistRoutingTask(task)) {
    return roleTag !== null && normalizedWorkerCapabilities.includes(roleTag);
  }
  const requiredCapabilities = normalizeCapabilityList(task.capabilities_required);
  return requiredCapabilities.every((required) => normalizedWorkerCapabilities.includes(required));
}

function readRoleName(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readUuidLike(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
