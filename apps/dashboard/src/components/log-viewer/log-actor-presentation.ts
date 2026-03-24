import type { LogActorRecord } from '../../lib/api.js';

type ActorLike = Pick<
  LogActorRecord,
  | 'actor_type'
  | 'actor_id'
  | 'actor_name'
  | 'latest_role'
  | 'latest_workflow_id'
  | 'latest_workflow_name'
  | 'latest_workflow_label'
>;

export function describeActorTypeLabel(actorType: string): string {
  switch (actorType) {
    case 'worker':
      return 'Specialist agent';
    case 'agent':
      return 'Specialist task execution';
    case 'user':
    case 'api_key':
    case 'operator':
      return 'Operator';
    case 'system':
      return 'Platform system';
    default:
      return humanize(actorType);
  }
}

export function describeActorPrimaryLabel(item: ActorLike): string {
  if (item.actor_type === 'worker' && item.latest_role?.trim()?.toLowerCase() === 'orchestrator') {
    return 'Orchestrator agent';
  }
  return describeActorTypeLabel(item.actor_type);
}

export function describeActorDetail(item: ActorLike): string {
  const workflowLabel = describeActorWorkflowLabel(item);
  const roleLabel = describeActorRoleLabel(item.latest_role);
  const reference = describeActorReference(item);
  const parts: string[] = [];

  if (roleLabel && workflowLabel) {
    parts.push(`${roleLabel} on ${workflowLabel}`);
  } else if (roleLabel) {
    parts.push(roleLabel);
  } else if (workflowLabel) {
    parts.push(workflowLabel);
  }

  if (reference) {
    parts.push(reference);
  }
  return parts.join(' · ') || describeActorTypeLabel(item.actor_type);
}

export function describeActorComboboxSubtitle(item: ActorLike & { count: number }): string {
  return `${describeActorDetail(item)} · ${item.count} entries`;
}

export function sortActorKindRecords<T extends ActorLike & { count: number }>(items: T[]): T[] {
  const order = new Map<string, number>([
    ['worker', 0],
    ['agent', 1],
    ['operator', 2],
    ['user', 2],
    ['api_key', 2],
    ['system', 3],
  ]);

  return [...items].sort((left, right) => {
    const leftOrder = order.get(left.actor_type) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = order.get(right.actor_type) ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    return right.count - left.count;
  });
}

function describeActorRoleLabel(role: string | null | undefined): string | null {
  if (!role?.trim()) {
    return null;
  }
  return humanize(role);
}

function describeActorWorkflowLabel(item: ActorLike): string | null {
  const workflowName = item.latest_workflow_name?.trim();
  if (workflowName) {
    return workflowName;
  }

  const workflowLabel = item.latest_workflow_label?.trim();
  if (workflowLabel) {
    return workflowLabel;
  }

  const workflowId = item.latest_workflow_id?.trim();
  if (workflowId) {
    return `Workflow ${workflowId.slice(0, 8)}`;
  }

  return null;
}

function describeActorReference(item: ActorLike): string | null {
  const actorName = item.actor_name?.trim();
  if (actorName && !looksLikeOpaqueActorName(actorName)) {
    return actorName;
  }

  const actorId = item.actor_id?.trim();
  if (!actorId) {
    return null;
  }
  return actorId.length > 8 ? actorId.slice(0, 8) : actorId;
}

function looksLikeOpaqueActorName(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    /^[a-f0-9-]{12,}$/i.test(value) ||
    value.includes(':') ||
    value.startsWith('agirunner-runtime-') ||
    normalized === 'runtime' ||
    normalized === 'worker' ||
    normalized === 'agent' ||
    normalized === 'operator'
  );
}

function humanize(value: string): string {
  return value
    .split(/[_:\-.]/g)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
