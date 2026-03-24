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
      return 'Agentic runtime';
    case 'agent':
      return 'Task execution';
    case 'operator':
      return 'Operator';
    case 'system':
      return 'Platform system';
    default:
      return humanize(actorType);
  }
}

export function describeActorPrimaryLabel(item: ActorLike): string {
  const workflowLabel = describeActorWorkflowLabel(item);
  const roleLabel = describeActorRoleLabel(item.latest_role);

  if (workflowLabel && roleLabel) {
    return `${roleLabel} on ${workflowLabel}`;
  }
  if (workflowLabel) {
    return workflowLabel;
  }
  if (roleLabel) {
    return roleLabel;
  }

  const actorName = item.actor_name?.trim();
  if (actorName && !looksLikeOpaqueActorName(actorName)) {
    return actorName;
  }

  return describeActorTypeLabel(item.actor_type);
}

export function describeActorDetail(item: ActorLike): string {
  const parts = [describeActorTypeLabel(item.actor_type)];
  const reference = describeActorReference(item);
  if (reference) {
    parts.push(reference);
  }
  return parts.join(' · ');
}

export function describeActorComboboxSubtitle(item: ActorLike & { count: number }): string {
  return `${describeActorDetail(item)} · ${item.count} entries`;
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
