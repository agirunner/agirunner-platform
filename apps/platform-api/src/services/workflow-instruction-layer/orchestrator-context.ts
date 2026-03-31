import { roleConfigOwnsRepositorySurface } from '../tool-tag-service.js';
import {
  asRecord,
  readString,
  readStringArray,
} from './shared.js';

export function mergeOrchestratorWorkflowContext(
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

export function readOrchestratorActivationAnchor(
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

export function readActivationStageTransition(
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

export function hasStageWorkItems(
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

export function readBoardTasks(
  orchestratorContext: Record<string, unknown> | null | undefined,
) {
  const board = asRecord(asRecord(orchestratorContext).board);
  const tasks = Array.isArray(board.tasks) ? board.tasks : [];
  return tasks.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry));
}

export function selectFocusedWorkItem(
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

export function readOrchestratorRoleCatalog(
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

export function readPendingDispatches(
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

export function isRepositoryBacked(
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

export function hasRepositoryBinding(
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
