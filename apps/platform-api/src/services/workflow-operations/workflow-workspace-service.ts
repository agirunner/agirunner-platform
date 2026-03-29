import type {
  MissionControlActionAvailability,
  MissionControlOutputDescriptor,
  MissionControlWorkflowCard,
} from './mission-control-types.js';
import { isWorkflowScopeHeaderAction } from './mission-control-action-availability.js';
import type { WorkflowService } from '../workflow-service.js';
import type { WorkflowDeliverablesService } from './workflow-deliverables-service.js';
import type { WorkflowHistoryService } from './workflow-history-service.js';
import type { WorkflowLiveConsoleService } from './workflow-live-console-service.js';
import type { WorkflowRailService } from './workflow-rail-service.js';
import type { WorkflowDeliverableRecord } from '../workflow-deliverable-service.js';
import type {
  WorkflowInterventionRecord,
  WorkflowInterventionService,
} from '../workflow-intervention-service.js';
import type {
  WorkflowSteeringSessionRecord,
  WorkflowSteeringSessionService,
} from '../workflow-steering-session-service.js';
import type {
  WorkflowBottomTabsPacket,
  WorkflowBriefItem,
  WorkflowHistoryItem,
  WorkflowNeedsActionDetail,
  WorkflowNeedsActionItem,
  WorkflowNeedsActionResponseAction,
  WorkflowLiveConsoleItem,
  WorkflowWorkspacePacket,
} from './workflow-operations-types.js';
import { filterLiveConsoleItemsForSelectedScope } from './workflow-live-console-scope.js';

interface WorkflowWorkspaceQuery {
  boardMode?: string;
  boardFilters?: string;
  workItemId?: string;
  taskId?: string;
  tabScope?: 'workflow' | 'selected_work_item' | 'selected_task';
  liveConsoleLimit?: number;
  briefsLimit?: number;
  historyLimit?: number;
  deliverablesLimit?: number;
  liveConsoleAfter?: string;
  briefsAfter?: string;
  historyAfter?: string;
  deliverablesAfter?: string;
}

interface ActionableTaskRecord {
  id: string;
  title: string;
  role: string | null;
  state: string;
  work_item_id: string | null;
  updated_at: string | null;
  description: string | null;
  review_feedback: string | null;
  verification_summary: string | null;
  subject_revision: number | null;
  escalation_reason: string | null;
  escalation_context: string | null;
  escalation_work_so_far: string | null;
}

interface TaskActionSource {
  listTasks(
    tenantId: string,
    query: {
      workflow_id?: string;
      work_item_id?: string;
      state?: string;
      page: number;
      per_page: number;
    },
  ): Promise<{ data: Array<Record<string, unknown>> }>;
}

interface WorkflowGateRecord {
  gate_id: string;
  stage_name: string;
  status: string;
  request_summary: string | null;
  recommendation: string | null;
  concerns: string[];
  requested_by_work_item_id: string | null;
  requested_by_task_title: string | null;
  requested_by_work_item_title: string | null;
}

interface GateActionSource {
  listWorkflowGates(tenantId: string, workflowId: string): Promise<Array<Record<string, unknown>>>;
}

interface WorkflowBoardNeedsActionItem extends WorkflowNeedsActionItem {
  stage_name?: string | null;
  subject_label?: string | null;
}

type WorkspaceDeliverablesPacket = Omit<
  WorkflowWorkspacePacket['deliverables'],
  'final_deliverables' | 'in_progress_deliverables'
> & {
  final_deliverables: WorkflowDeliverableRecord[];
  in_progress_deliverables: WorkflowDeliverableRecord[];
  all_deliverables?: WorkflowDeliverableRecord[];
};

export class WorkflowWorkspaceService {
  constructor(
    private readonly workflowService: Pick<WorkflowService, 'getWorkflow' | 'getWorkflowBoard'>,
    private readonly railService: Pick<WorkflowRailService, 'getWorkflowCard'>,
    private readonly liveConsoleService: Pick<WorkflowLiveConsoleService, 'getLiveConsole'>,
    private readonly historyService: Pick<WorkflowHistoryService, 'getHistory'>,
    private readonly deliverablesService: Pick<WorkflowDeliverablesService, 'getDeliverables'>,
    private readonly interventionService: Pick<WorkflowInterventionService, 'listWorkflowInterventions'>,
    private readonly steeringSessionService: Pick<
      WorkflowSteeringSessionService,
      'listSessions' | 'listMessages'
    >,
    private readonly taskActionSource?: TaskActionSource,
    private readonly gateActionSource?: GateActionSource,
    private readonly briefsService?: {
      getBriefs(
        tenantId: string,
        workflowId: string,
        input?: { limit?: number; workItemId?: string; taskId?: string; after?: string },
      ): Promise<WorkflowWorkspacePacket['briefs']>;
    },
  ) {}

  async getWorkspace(
    tenantId: string,
    workflowId: string,
    input: WorkflowWorkspaceQuery = {},
  ): Promise<WorkflowWorkspacePacket> {
    const selectedScope = resolveSelectedScope(input);
    const scopedWorkItemId =
      selectedScope.scope_kind === 'selected_work_item' || selectedScope.scope_kind === 'selected_task'
        ? selectedScope.work_item_id
        : undefined;
    const scopedTaskId = selectedScope.scope_kind === 'selected_task'
      ? selectedScope.task_id
      : undefined;
    const [
      workflow,
      board,
      workflowCard,
      liveConsole,
      briefs,
      history,
      deliverables,
      interventions,
      sessions,
      actionableTasks,
      gates,
    ] =
      await Promise.all([
        this.workflowService.getWorkflow(tenantId, workflowId),
        this.workflowService.getWorkflowBoard(tenantId, workflowId),
        this.railService.getWorkflowCard(tenantId, workflowId),
        this.liveConsoleService.getLiveConsole(tenantId, workflowId, {
          limit: input.liveConsoleLimit,
          workItemId: scopedWorkItemId ?? undefined,
          taskId: scopedTaskId ?? undefined,
          after: input.liveConsoleAfter,
        }),
        this.briefsService?.getBriefs(tenantId, workflowId, {
          limit: input.briefsLimit,
          workItemId: scopedWorkItemId ?? undefined,
          taskId: scopedTaskId ?? undefined,
          after: input.briefsAfter,
        }) ?? Promise.resolve(null),
        this.historyService.getHistory(tenantId, workflowId, {
          limit: input.historyLimit,
          workItemId: scopedWorkItemId ?? undefined,
          taskId: scopedTaskId ?? undefined,
          after: input.historyAfter,
        }),
        this.deliverablesService.getDeliverables(tenantId, workflowId, {
          limit: input.deliverablesLimit,
          workItemId: scopedWorkItemId ?? undefined,
          after: input.deliverablesAfter,
        }),
        this.interventionService.listWorkflowInterventions(tenantId, workflowId),
        this.steeringSessionService.listSessions(tenantId, workflowId),
        loadActionableTasks(this.taskActionSource, tenantId, workflowId, scopedWorkItemId ?? null),
        loadWorkflowGates(this.gateActionSource, tenantId, workflowId),
      ]);

    const needsActionItems = buildNeedsActionItems(
      workflowId,
      board as Record<string, unknown>,
      workflowCard?.availableActions ?? [],
      interventions,
      actionableTasks,
      selectedScope.work_item_id,
      gates,
    );
    const normalizedDeliverables = normalizeWorkspaceDeliverablesPacket(deliverables);
    const allDeliverables = normalizedDeliverables.all_deliverables ?? [
      ...normalizedDeliverables.final_deliverables,
      ...normalizedDeliverables.in_progress_deliverables,
    ];
    const workspaceDeliverables = buildWorkspaceDeliverablesPacket(
      normalizedDeliverables,
      workflowCard?.outputDescriptors ?? [],
      workflowId,
      selectedScope,
      board as Record<string, unknown>,
    );
    const currentDeliverables = workspaceDeliverables.all_deliverables ?? [
      ...workspaceDeliverables.final_deliverables,
      ...workspaceDeliverables.in_progress_deliverables,
    ];
    const effectiveLiveConsole = filterLiveConsoleForSelectedScope(
      liveConsole,
      selectedScope,
      readBoardWorkItemIds(board as Record<string, unknown>),
    );
    const effectiveBriefs = filterBriefsForSelectedScope(
      briefs ?? buildEmptyBriefsPacket(history),
      selectedScope,
    );
    const effectiveHistory = filterHistoryForSelectedScope(history, selectedScope);
    const activeSession = sessions[0] ?? null;
    const steeringQuickActions = filterSteeringQuickActions(workflowCard?.availableActions ?? []);
    const sessionMessages = activeSession
      ? await this.steeringSessionService.listMessages(tenantId, workflowId, activeSession.id)
      : [];
    const bottomTabs = buildBottomTabs(
      needsActionItems.length,
      activeSession ? 1 : 0,
      readPacketTotalCount(effectiveLiveConsole),
      readPacketTotalCount(effectiveBriefs),
      readPacketTotalCount(effectiveHistory),
      currentDeliverables.length,
      input,
    );

    return {
      workflow_id: workflowId,
      workflow: workflowCard ?? null,
      generated_at: history.generated_at,
      latest_event_id: history.latest_event_id,
      snapshot_version: history.snapshot_version,
      selected_scope: selectedScope,
      sticky_strip:
        workflowCard
          ? buildStickyStrip(
              workflowCard,
              activeSession !== null || interventions.length > 0 || steeringQuickActions.some((action) => action.enabled),
            )
          : null,
      board: board as Record<string, unknown>,
      bottom_tabs: bottomTabs,
      needs_action: {
        items: needsActionItems,
        total_count: needsActionItems.length,
        default_sort: 'priority_desc',
      },
      steering: {
        quick_actions: steeringQuickActions,
        decision_actions: [],
        steering_state: {
          mode:
            selectedScope.scope_kind === 'selected_task'
              ? 'selected_task'
              : selectedScope.scope_kind === 'selected_work_item'
                ? 'selected_work_item'
                : 'workflow_scoped',
          can_accept_request: true,
          active_session_id: activeSession ? String(activeSession.id) : null,
          last_summary: workflowCard?.pulse.summary ?? null,
        },
        recent_interventions: interventions.slice(0, 10),
        session: {
          session_id: activeSession ? String(activeSession.id) : null,
          status: readSessionStatus(activeSession),
          messages: sessionMessages,
        },
      },
      live_console: effectiveLiveConsole,
      briefs: effectiveBriefs,
      history: effectiveHistory,
      deliverables: workspaceDeliverables,
      redrive_lineage: readRedriveLineage(workflow),
    };
  }
}

function buildWorkspaceDeliverablesPacket(
  deliverables: WorkspaceDeliverablesPacket,
  outputDescriptors: MissionControlOutputDescriptor[],
  workflowId: string,
  selectedScope: WorkflowWorkspacePacket['selected_scope'],
  board: Record<string, unknown>,
): WorkspaceDeliverablesPacket {
  const visibleDeliverables = [
    ...deliverables.final_deliverables,
    ...deliverables.in_progress_deliverables,
  ];
  const fallbackDeliverables = visibleDeliverables.length === 0
    ? buildFallbackOutputDescriptorDeliverables(
        outputDescriptors,
        workflowId,
        selectedScope,
        visibleDeliverables,
        board,
      )
    : [];
  const mergedFinalDeliverables = [
    ...deliverables.final_deliverables,
    ...fallbackDeliverables.filter(isFinalWorkspaceDeliverable),
  ];
  const mergedInProgressDeliverables = [
    ...deliverables.in_progress_deliverables,
    ...fallbackDeliverables.filter((deliverable) => !isFinalWorkspaceDeliverable(deliverable)),
  ];

  return {
    ...deliverables,
    final_deliverables: mergedFinalDeliverables,
    in_progress_deliverables: mergedInProgressDeliverables,
    all_deliverables: [...mergedFinalDeliverables, ...mergedInProgressDeliverables],
  };
}

function normalizeWorkspaceDeliverablesPacket(
  deliverables: WorkflowWorkspacePacket['deliverables'],
): WorkspaceDeliverablesPacket {
  return {
    ...deliverables,
    final_deliverables: deliverables.final_deliverables as WorkflowDeliverableRecord[],
    in_progress_deliverables: deliverables.in_progress_deliverables as WorkflowDeliverableRecord[],
    all_deliverables: (deliverables as WorkspaceDeliverablesPacket).all_deliverables,
  };
}

function buildFallbackOutputDescriptorDeliverables(
  outputDescriptors: MissionControlOutputDescriptor[],
  workflowId: string,
  selectedScope: WorkflowWorkspacePacket['selected_scope'],
  visibleDeliverables: WorkflowDeliverableRecord[],
  board: Record<string, unknown>,
): WorkflowDeliverableRecord[] {
  const visibleIdentityKeys = new Set(
    visibleDeliverables.map(readDeliverableIdentityKey).filter((key): key is string => key !== null),
  );
  const blockedWorkItemIds = readBlockedWorkItemIds(board);
  const fallbackDeliverables: WorkflowDeliverableRecord[] = [];
  const emittedKeys = new Set<string>();

  for (const descriptor of selectScopedOutputDescriptors(outputDescriptors, selectedScope)) {
    if (descriptor.workItemId && blockedWorkItemIds.has(descriptor.workItemId)) {
      continue;
    }
    const fallbackDeliverable = composeFallbackDeliverableFromOutputDescriptor(workflowId, descriptor);
    const identityKey = readDeliverableIdentityKey(fallbackDeliverable);
    if (!identityKey || visibleIdentityKeys.has(identityKey) || emittedKeys.has(identityKey)) {
      continue;
    }
    fallbackDeliverables.push(fallbackDeliverable);
    emittedKeys.add(identityKey);
  }

  return fallbackDeliverables;
}

function selectScopedOutputDescriptors(
  outputDescriptors: MissionControlOutputDescriptor[],
  selectedScope: WorkflowWorkspacePacket['selected_scope'],
): MissionControlOutputDescriptor[] {
  if (selectedScope.scope_kind === 'workflow') {
    return outputDescriptors;
  }
  if (selectedScope.scope_kind === 'selected_task') {
    return [];
  }
  if (!selectedScope.work_item_id) {
    return [];
  }
  return outputDescriptors.filter((descriptor) =>
    descriptor.workItemId === null || descriptor.workItemId === selectedScope.work_item_id,
  );
}

function readBlockedWorkItemIds(board: Record<string, unknown>): Set<string> {
  const blockedIds = new Set<string>();
  const workItems = Array.isArray(board.work_items) ? board.work_items : [];
  for (const workItem of workItems) {
    const record = asRecord(workItem);
    const workItemId = readOptionalString(record.id);
    if (!workItemId) {
      continue;
    }
    const blockedState = readOptionalString(record.blocked_state);
    const gateStatus = readOptionalString(record.gate_status);
    if (blockedState === 'blocked' || isBlockedGateStatus(gateStatus)) {
      blockedIds.add(workItemId);
    }
  }
  return blockedIds;
}

function composeFallbackDeliverableFromOutputDescriptor(
  workflowId: string,
  descriptor: MissionControlOutputDescriptor,
): WorkflowDeliverableRecord {
  return {
    descriptor_id: `output:${descriptor.id}`,
    workflow_id: workflowId,
    work_item_id: descriptor.workItemId,
    descriptor_kind: descriptor.primaryLocation.kind,
    delivery_stage: isFinalOutputDescriptorStatus(descriptor.status) ? 'final' : 'in_progress',
    title: descriptor.title,
    state: descriptor.status,
    summary_brief: descriptor.summary,
    preview_capabilities: {},
    primary_target: composeFallbackPrimaryTarget(descriptor),
    secondary_targets: [],
    content_preview: descriptor.summary ? { summary: descriptor.summary } : {},
    source_brief_id: null,
    created_at: '',
    updated_at: '',
  };
}

function composeFallbackPrimaryTarget(
  descriptor: MissionControlOutputDescriptor,
): Record<string, unknown> {
  const location = descriptor.primaryLocation;
  switch (location.kind) {
    case 'artifact':
      return {
        target_kind: 'artifact',
        label: 'Open artifact',
        url: normalizeArtifactPreviewUrl(location.previewPath, location.taskId, location.artifactId),
        path: location.logicalPath,
        artifact_id: location.artifactId,
      };
    case 'repository':
      return {
        target_kind: 'repository',
        label: 'Open repository output',
        url:
          location.pullRequestUrl
          ?? location.branchUrl
          ?? location.commitUrl
          ?? location.repository,
        repo_ref: location.branch ?? location.commitSha ?? location.repository,
      };
    case 'workflow_document':
      return {
        target_kind: 'workflow_document',
        label: 'Open workflow document',
        url: location.location,
        path: location.logicalName,
        artifact_id: location.artifactId,
      };
    case 'external_url':
      return {
        target_kind: 'external_url',
        label: 'Open link',
        url: location.url,
      };
    case 'host_directory':
      return {
        target_kind: 'host_directory',
        label: 'Open host directory',
        path: location.path,
      };
  }
}

function normalizeArtifactPreviewUrl(
  previewPath: string | null,
  taskId: string,
  artifactId: string,
): string {
  const normalizedPreviewPath = readOptionalString(previewPath);
  if (!normalizedPreviewPath) {
    return `/api/v1/tasks/${encodeURIComponent(taskId)}/artifacts/${encodeURIComponent(artifactId)}/preview`;
  }
  const deprecatedMatch = normalizedPreviewPath.match(/^\/artifacts\/tasks\/([^/]+)\/([^/?#]+)$/);
  if (!deprecatedMatch) {
    return normalizedPreviewPath;
  }
  return `/api/v1/tasks/${encodeURIComponent(deprecatedMatch[1])}/artifacts/${encodeURIComponent(deprecatedMatch[2])}/preview`;
}

function isFinalWorkspaceDeliverable(deliverable: WorkflowDeliverableRecord): boolean {
  return deliverable.delivery_stage === 'final' || deliverable.state === 'final';
}

function isFinalOutputDescriptorStatus(status: MissionControlOutputDescriptor['status']): boolean {
  return status === 'approved' || status === 'final';
}

function readDeliverableIdentityKey(deliverable: WorkflowDeliverableRecord): string | null {
  const primaryTarget = asRecord(deliverable.primary_target);
  const artifactId = readOptionalString(primaryTarget.artifact_id);
  if (artifactId) {
    return `artifact:${artifactId}`;
  }
  const targetUrl = readOptionalString(primaryTarget.url);
  if (targetUrl) {
    return `url:${targetUrl}`;
  }
  const targetPath = readOptionalString(primaryTarget.path);
  if (targetPath) {
    return `path:${targetPath}`;
  }
  return null;
}

function resolveSelectedScope(input: WorkflowWorkspaceQuery): WorkflowWorkspacePacket['selected_scope'] {
  if (input.tabScope === 'selected_task' && input.taskId) {
    return {
      scope_kind: 'selected_task',
      work_item_id: input.workItemId ?? null,
      task_id: input.taskId,
    };
  }
  if (input.tabScope === 'selected_work_item' && input.workItemId) {
    return {
      scope_kind: 'selected_work_item',
      work_item_id: input.workItemId,
      task_id: null,
    };
  }
  return {
    scope_kind: 'workflow',
    work_item_id: null,
    task_id: null,
  };
}

function buildStickyStrip(workflowCard: MissionControlWorkflowCard, steeringAvailable: boolean) {
  return {
    workflow_id: workflowCard.id,
    workflow_name: workflowCard.name,
    posture: workflowCard.posture,
    summary: workflowCard.pulse.summary,
    approvals_count: workflowCard.metrics.waitingForDecisionCount,
    escalations_count: workflowCard.metrics.openEscalationCount,
    blocked_work_item_count: workflowCard.metrics.blockedWorkItemCount,
    active_task_count: workflowCard.metrics.activeTaskCount,
    active_work_item_count: workflowCard.metrics.activeWorkItemCount,
    steering_available: steeringAvailable,
  };
}

function filterSteeringQuickActions(
  actions: MissionControlActionAvailability[],
): MissionControlActionAvailability[] {
  return actions.filter((action) => !isWorkflowScopeHeaderAction(action.kind));
}

function buildBottomTabs(
  needsActionCount: number,
  steeringCount: number,
  liveConsoleCount: number,
  briefsCount: number,
  historyCount: number,
  deliverablesCount: number,
  input: WorkflowWorkspaceQuery,
): WorkflowBottomTabsPacket {
  return {
    default_tab: needsActionCount > 0 ? 'needs_action' : 'details',
    current_scope_kind:
      input.tabScope === 'selected_task' && input.taskId
        ? 'selected_task'
        : input.tabScope === 'selected_work_item' && input.workItemId
          ? 'selected_work_item'
          : 'workflow',
    current_work_item_id:
      input.tabScope === 'selected_work_item' || input.tabScope === 'selected_task'
        ? input.workItemId ?? null
        : null,
    current_task_id: input.tabScope === 'selected_task' ? input.taskId ?? null : null,
    counts: {
      details: 1,
      needs_action: needsActionCount,
      steering: steeringCount,
      live_console_activity: liveConsoleCount,
      briefs: briefsCount,
      history: historyCount,
      deliverables: deliverablesCount,
    },
  };
}

function filterLiveConsoleForSelectedScope(
  packet: WorkflowWorkspacePacket['live_console'],
  selectedScope: WorkflowWorkspacePacket['selected_scope'],
  workflowWorkItemIds: string[],
): WorkflowWorkspacePacket['live_console'] {
  const filteredItems = filterLiveConsoleItemsForSelectedScope(packet.items, selectedScope, workflowWorkItemIds);
  if (filteredItems.length === packet.items.length) {
    return packet;
  }
  return {
    ...packet,
    items: filteredItems,
    total_count: filteredItems.length,
  };
}

function readBoardWorkItemIds(board: Record<string, unknown>): string[] {
  const workItems = board.work_items;
  if (!Array.isArray(workItems)) {
    return [];
  }
  return workItems
    .map((item) => readOptionalString(asRecord(item).id))
    .filter((workItemId): workItemId is string => workItemId !== null);
}

function filterHistoryForSelectedScope(
  packet: WorkflowWorkspacePacket['history'],
  selectedScope: WorkflowWorkspacePacket['selected_scope'],
): WorkflowWorkspacePacket['history'] {
  const filteredItems = packet.items.filter((item) => matchesScopedRecord(item, selectedScope));
  if (filteredItems.length === packet.items.length) {
    return packet;
  }
  return {
    ...packet,
    items: filteredItems,
    total_count: filteredItems.length,
    groups: buildHistoryGroupsFromItems(filteredItems),
  };
}

function filterBriefsForSelectedScope(
  packet: WorkflowWorkspacePacket['briefs'],
  selectedScope: WorkflowWorkspacePacket['selected_scope'],
): WorkflowWorkspacePacket['briefs'] {
  const filteredItems = packet.items.filter((item) => matchesScopedRecord(item, selectedScope));
  if (filteredItems.length === packet.items.length) {
    return packet;
  }
  return {
    ...packet,
    items: filteredItems,
    total_count: filteredItems.length,
  };
}

function matchesScopedRecord(
  item: Pick<
    WorkflowLiveConsoleItem | WorkflowHistoryItem | WorkflowBriefItem,
    'work_item_id' | 'task_id' | 'linked_target_ids'
  >,
  selectedScope: WorkflowWorkspacePacket['selected_scope'],
): boolean {
  if (selectedScope.scope_kind === 'workflow') {
    return true;
  }

  if (selectedScope.scope_kind === 'selected_task') {
    return matchesTaskScope(item, selectedScope.task_id);
  }

  return matchesWorkItemScope(item, selectedScope.work_item_id);
}

function readPacketTotalCount(
  packet: Pick<
    WorkflowWorkspacePacket['live_console'] | WorkflowWorkspacePacket['briefs'] | WorkflowWorkspacePacket['history'],
    'items'
  > & {
    total_count?: number;
  },
): number {
  return typeof packet.total_count === 'number' ? packet.total_count : packet.items.length;
}

function buildEmptyBriefsPacket(
  snapshot: Pick<WorkflowWorkspacePacket['history'], 'generated_at' | 'latest_event_id' | 'snapshot_version'>,
): WorkflowWorkspacePacket['briefs'] {
  return {
    generated_at: snapshot.generated_at,
    latest_event_id: snapshot.latest_event_id,
    snapshot_version: snapshot.snapshot_version,
    items: [],
    total_count: 0,
    next_cursor: null,
  };
}

function matchesTaskScope(
  item: Pick<WorkflowLiveConsoleItem | WorkflowHistoryItem, 'task_id' | 'linked_target_ids'>,
  taskId: string | null,
): boolean {
  if (!taskId) {
    return false;
  }

  return item.task_id === taskId || item.linked_target_ids.includes(taskId);
}

function matchesWorkItemScope(
  item: Pick<WorkflowLiveConsoleItem | WorkflowHistoryItem, 'work_item_id' | 'linked_target_ids'>,
  workItemId: string | null,
): boolean {
  if (!workItemId) {
    return false;
  }

  return item.work_item_id === workItemId || item.linked_target_ids.includes(workItemId);
}

function buildHistoryGroupsFromItems(items: WorkflowHistoryItem[]): WorkflowWorkspacePacket['history']['groups'] {
  const idsByDay = new Map<string, string[]>();
  for (const item of items) {
    const groupId = item.created_at.slice(0, 10);
    const itemIds = idsByDay.get(groupId) ?? [];
    itemIds.push(item.item_id);
    idsByDay.set(groupId, itemIds);
  }

  return Array.from(idsByDay.entries()).map(([groupId, itemIds]) => ({
    group_id: groupId,
    label: groupId,
    anchor_at: `${groupId}T00:00:00.000Z`,
    item_ids: itemIds,
  }));
}

function buildNeedsActionItems(
  workflowId: string,
  board: Record<string, unknown>,
  actions: MissionControlActionAvailability[],
  interventions: WorkflowInterventionRecord[],
  actionableTasks: ActionableTaskRecord[],
  selectedWorkItemId: string | null,
  gates: WorkflowGateRecord[],
): WorkflowNeedsActionItem[] {
  const items: WorkflowNeedsActionItem[] = [];
  const actionableTaskMap = buildActionableTaskMap(actionableTasks);
  const gatesByWorkItem = buildWorkflowGateWorkItemMap(gates);
  const gatesByStage = buildWorkflowGateStageMap(gates);
  for (const boardItem of readBoardNeedsActionItems(board)) {
    const gate = resolveNeedsActionGate(boardItem, gatesByWorkItem, gatesByStage);
    const directTask = readDirectActionTask(
      boardItem.action_kind,
      boardItem.target.target_kind,
      boardItem.target.target_id,
      actionableTaskMap,
    );
    const responses = buildBoardNeedsActionResponses(boardItem.action_kind, boardItem.target, directTask, gate);
    const presentation = buildBoardNeedsActionPresentation(boardItem, directTask, gate);
    const { stage_name: _stageName, subject_label: _subjectLabel, ...publicItem } = boardItem;
    items.push({
      ...publicItem,
      ...presentation,
      target: directTask ? { target_kind: 'task', target_id: directTask.id } : boardItem.target,
      submission: {
        route_kind: directTask ? 'task_mutation' : boardItem.submission.route_kind,
        method: 'POST',
      },
      responses,
    });
  }
  for (const stageItem of readBoardStageNeedsActionItems(board, workflowId)) {
    if (items.some((item) => item.action_id === stageItem.action_id)) {
      continue;
    }
    const gate = resolveNeedsActionGate(stageItem, gatesByWorkItem, gatesByStage);
    const presentation = buildBoardNeedsActionPresentation(stageItem, null, gate);
    const { stage_name: _stageName, ...publicItem } = stageItem;
    items.push({
      ...publicItem,
      ...presentation,
      responses: buildBoardNeedsActionResponses(stageItem.action_kind, stageItem.target, null, gate),
    });
  }
  for (const intervention of interventions) {
    if (!isActionableIntervention(intervention)) {
      continue;
    }
    const actionKind = readStructuredActionKind(intervention) ?? intervention.kind;
    const target = readInterventionTarget(intervention, workflowId);
    const actionId = `${intervention.id}:${actionKind}:${target.target_id}`;
    if (items.some((item) => item.action_id === actionId)) {
      continue;
    }
    items.push({
      action_id: actionId,
      action_kind: actionKind,
      label: humanizeActionKind(actionKind),
      summary: intervention.summary,
      target,
      priority: 'high',
      requires_confirmation: false,
      submission: {
        route_kind: target.target_kind === 'task' ? 'task_mutation' : 'workflow_intervention',
        method: 'POST',
      },
      responses: buildInterventionResponses(
        actionKind,
        target,
        typeof intervention.work_item_id === 'string' ? intervention.work_item_id : null,
      ),
    });
  }
  for (const action of actions) {
    if (!isNeedsActionQuickAction(action)) {
      continue;
    }
    items.push({
      action_id: `${workflowId}:${action.kind}`,
      action_kind: action.kind,
      label: humanizeActionKind(action.kind),
      summary: action.disabledReason ?? humanizeActionKind(action.kind),
      target: resolveActionTarget(action.scope, workflowId, interventions, selectedWorkItemId),
      priority: action.scope === 'workflow' ? 'medium' : 'high',
      requires_confirmation: action.confirmationLevel !== 'immediate',
      submission: {
        route_kind: 'workflow_mutation',
        method: 'POST',
      },
      responses: buildQuickActionResponses(action.kind, resolveActionTarget(action.scope, workflowId, interventions, selectedWorkItemId)),
    });
  }
  return items.sort(compareNeedsActionPriority);
}

async function loadWorkflowGates(
  gateActionSource: GateActionSource | undefined,
  tenantId: string,
  workflowId: string,
): Promise<WorkflowGateRecord[]> {
  if (!gateActionSource) {
    return [];
  }
  const gates = await gateActionSource.listWorkflowGates(tenantId, workflowId);
  return gates
    .map(normalizeWorkflowGate)
    .filter((gate): gate is WorkflowGateRecord => gate !== null && isActionableGateStatus(gate.status));
}

async function loadActionableTasks(
  taskActionSource: TaskActionSource | undefined,
  tenantId: string,
  workflowId: string,
  workItemId: string | null,
): Promise<ActionableTaskRecord[]> {
  if (!taskActionSource) {
    return [];
  }
  const states = ['awaiting_approval', 'output_pending_assessment', 'escalated', 'failed'] as const;
  const pages = await Promise.all(
    states.map((state) =>
      taskActionSource.listTasks(tenantId, {
        workflow_id: workflowId,
        work_item_id: workItemId ?? undefined,
        state,
        page: 1,
        per_page: 100,
      }),
    ),
  );

  return pages
    .flatMap((page) => page.data)
    .map(normalizeActionableTask)
    .filter((task): task is ActionableTaskRecord => task !== null)
    .sort(compareActionableTasks);
}

function normalizeActionableTask(record: Record<string, unknown>): ActionableTaskRecord | null {
  const id = readOptionalString(record.id);
  const title = readOptionalString(record.title);
  const state = readOptionalString(record.state);
  if (!id || !title || !state) {
    return null;
  }
  return {
    id,
    title,
    role: readOptionalString(record.role),
    state,
    work_item_id: readOptionalString(record.work_item_id),
    updated_at: readOptionalString(record.updated_at),
    description: readOptionalString(record.description) ?? readOptionalString(asRecord(record.metadata).description),
    review_feedback:
      readOptionalString(asRecord(record.input).assessment_feedback)
      ?? readOptionalString(asRecord(record.metadata).assessment_feedback),
    verification_summary: buildTaskVerificationSummary(asRecord(record.verification)),
    subject_revision:
      readOptionalInteger(asRecord(record.input).subject_revision)
      ?? readOptionalInteger(asRecord(record.metadata).subject_revision)
      ?? readOptionalInteger(asRecord(record.metadata).output_revision),
    escalation_reason: readOptionalString(asRecord(record.metadata).escalation_reason),
    escalation_context: readOptionalString(asRecord(record.metadata).escalation_context),
    escalation_work_so_far: readOptionalString(asRecord(record.metadata).escalation_work_so_far),
  };
}

function compareActionableTasks(left: ActionableTaskRecord, right: ActionableTaskRecord): number {
  return (right.updated_at ?? '').localeCompare(left.updated_at ?? '') || left.id.localeCompare(right.id);
}

function normalizeWorkflowGate(record: Record<string, unknown>): WorkflowGateRecord | null {
  const gateId = readOptionalString(record.gate_id) ?? readOptionalString(record.id);
  const stageName = readOptionalString(record.stage_name);
  const status = readOptionalString(record.status) ?? readOptionalString(record.gate_status);
  if (!gateId || !stageName || !status) {
    return null;
  }
  return {
    gate_id: gateId,
    stage_name: stageName,
    status,
    request_summary: readOptionalString(record.request_summary) ?? readOptionalString(record.summary),
    recommendation: readOptionalString(record.recommendation),
    concerns: readStringArray(record.concerns),
    requested_by_work_item_id: readOptionalString(record.requested_by_work_item_id) ?? null,
    requested_by_task_title:
      readOptionalString(asRecord(record.requested_by_task).title)
      ?? readOptionalString(record.requested_by_task_title),
    requested_by_work_item_title:
      readOptionalString(asRecord(record.requested_by_task).work_item_title)
      ?? readOptionalString(record.requested_by_work_item_title),
  };
}

function buildActionableTaskMap(tasks: ActionableTaskRecord[]): Map<string, ActionableTaskRecord[]> {
  const taskMap = new Map<string, ActionableTaskRecord[]>();
  for (const task of tasks) {
    if (!task.work_item_id) {
      continue;
    }
    const entries = taskMap.get(task.work_item_id) ?? [];
    entries.push(task);
    taskMap.set(task.work_item_id, entries);
  }
  return taskMap;
}

function readDirectActionTask(
  actionKind: string,
  targetKind: WorkflowNeedsActionItem['target']['target_kind'],
  targetId: string,
  actionableTaskMap: Map<string, ActionableTaskRecord[]>,
): ActionableTaskRecord | null {
  if (targetKind === 'task') {
    for (const tasks of actionableTaskMap.values()) {
      const directTask = tasks.find((task) => task.id === targetId);
      if (directTask) {
        return directTask;
      }
    }
    return null;
  }
  if (targetKind !== 'work_item') {
    return null;
  }
  const tasks = actionableTaskMap.get(targetId) ?? [];
  const preferredStates = readPreferredActionTaskStates(actionKind);
  for (const state of preferredStates) {
    const matchingTask = tasks.find((task) => task.state === state);
    if (matchingTask) {
      return matchingTask;
    }
  }
  return tasks[0] ?? null;
}

function readPreferredActionTaskStates(actionKind: string): string[] {
  if (actionKind === 'resolve_escalation') {
    return ['escalated'];
  }
  if (actionKind === 'review_work_item') {
    return ['awaiting_approval', 'output_pending_assessment'];
  }
  return [];
}

function buildBoardNeedsActionPresentation(
  item: WorkflowBoardNeedsActionItem,
  directTask: ActionableTaskRecord | null,
  gate: WorkflowGateRecord | null,
): Pick<WorkflowNeedsActionItem, 'summary' | 'details'> {
  if (item.action_kind === 'resolve_escalation' && directTask) {
    return buildEscalationPresentation(item, directTask);
  }
  if ((item.action_kind === 'review_work_item' || item.action_kind === 'review_stage_gate') && directTask) {
    return buildTaskApprovalPresentation(item, directTask);
  }
  if ((item.action_kind === 'review_work_item' || item.action_kind === 'review_stage_gate') && gate?.status === 'awaiting_approval') {
    return buildGateApprovalPresentation(item, gate);
  }
  return { summary: item.summary };
}

function buildEscalationPresentation(
  item: WorkflowBoardNeedsActionItem,
  directTask: ActionableTaskRecord,
): Pick<WorkflowNeedsActionItem, 'summary' | 'details'> {
  const title = item.subject_label ?? 'Work item';
  const reason = directTask.escalation_reason;
  const details: WorkflowNeedsActionDetail[] = [];
  if (directTask.escalation_context) {
    details.push({ label: 'Context', value: directTask.escalation_context });
  }
  if (directTask.escalation_work_so_far) {
    details.push({ label: 'Work so far', value: directTask.escalation_work_so_far });
  }
  return {
    summary: reason
      ? `${title} needs escalation resolution: ${ensureSentence(reason)}`
      : `${title} has an open escalation.`,
    ...(details.length > 0 ? { details } : {}),
  };
}

function buildTaskApprovalPresentation(
  item: WorkflowBoardNeedsActionItem,
  directTask: ActionableTaskRecord,
): Pick<WorkflowNeedsActionItem, 'summary' | 'details'> {
  const title = item.subject_label ?? 'Work item';
  const isOutputReview = directTask.state === 'output_pending_assessment';
  const details: WorkflowNeedsActionDetail[] = [
    {
      label: isOutputReview ? 'Assessment target' : 'Approval target',
      value: directTask.title,
    },
  ];
  if (directTask.description) {
    details.push({ label: 'Context', value: directTask.description });
  }
  if (directTask.review_feedback) {
    details.push({ label: 'Latest feedback', value: directTask.review_feedback });
  }
  if (directTask.verification_summary) {
    details.push({ label: 'Verification', value: directTask.verification_summary });
  }
  if (directTask.subject_revision !== null) {
    details.push({ label: 'Revision', value: String(directTask.subject_revision) });
  }

  return {
    summary: isOutputReview
      ? `${title} is waiting for output review on ${directTask.title}.`
      : `${title} is waiting for operator approval on ${directTask.title}.`,
    ...(details.length > 0 ? { details } : {}),
  };
}

function buildGateApprovalPresentation(
  item: WorkflowBoardNeedsActionItem,
  gate: WorkflowGateRecord,
): Pick<WorkflowNeedsActionItem, 'summary' | 'details'> {
  const title = item.subject_label ?? gate.requested_by_work_item_title ?? (item.stage_name ? `Stage ${item.stage_name}` : 'Approval');
  const details: WorkflowNeedsActionDetail[] = [];
  if (gate.recommendation) {
    details.push({ label: 'Recommendation', value: humanizeToken(gate.recommendation) });
  }
  const requestedBy = gate.requested_by_task_title ?? gate.requested_by_work_item_title;
  if (requestedBy) {
    details.push({ label: 'Requested by', value: requestedBy });
  }
  const concernsSummary = summarizeConcerns(gate.concerns);
  if (concernsSummary) {
    details.push({ label: 'Concerns', value: concernsSummary });
  }

  return {
    summary: gate.request_summary
      ? `${title} is waiting for operator approval: ${ensureSentence(gate.request_summary)}`
      : item.summary,
    ...(details.length > 0 ? { details } : {}),
  };
}

function buildWorkflowGateWorkItemMap(gates: WorkflowGateRecord[]): Map<string, WorkflowGateRecord> {
  const gateMap = new Map<string, WorkflowGateRecord>();
  for (const gate of gates) {
    if (!gate.requested_by_work_item_id || gateMap.has(gate.requested_by_work_item_id)) {
      continue;
    }
    gateMap.set(gate.requested_by_work_item_id, gate);
  }
  return gateMap;
}

function buildWorkflowGateStageMap(gates: WorkflowGateRecord[]): Map<string, WorkflowGateRecord> {
  const gateMap = new Map<string, WorkflowGateRecord>();
  for (const gate of gates) {
    if (gateMap.has(gate.stage_name)) {
      continue;
    }
    gateMap.set(gate.stage_name, gate);
  }
  return gateMap;
}

function resolveNeedsActionGate(
  item: WorkflowBoardNeedsActionItem,
  gatesByWorkItem: Map<string, WorkflowGateRecord>,
  gatesByStage: Map<string, WorkflowGateRecord>,
): WorkflowGateRecord | null {
  if (item.target.target_kind === 'work_item') {
    const workItemGate = gatesByWorkItem.get(item.target.target_id);
    if (workItemGate) {
      return workItemGate;
    }
  }
  if (item.stage_name) {
    return gatesByStage.get(item.stage_name) ?? null;
  }
  return null;
}

function buildBoardNeedsActionResponses(
  actionKind: string,
  target: WorkflowNeedsActionItem['target'],
  directTask: ActionableTaskRecord | null,
  gate: WorkflowGateRecord | null,
): WorkflowNeedsActionResponseAction[] {
  if (actionKind === 'review_work_item' && directTask) {
    if (directTask.state === 'output_pending_assessment') {
      return [
        buildNeedsActionResponse('approve_task_output', 'Approve output', directTask.id, 'task', 'none'),
        buildNeedsActionResponse('reject_task', 'Reject', directTask.id, 'task', 'feedback', true),
        buildNeedsActionResponse('request_changes_task', 'Request changes', directTask.id, 'task', 'feedback', true),
      ];
    }
    return [
      buildNeedsActionResponse('approve_task', 'Approve', directTask.id, 'task', 'none'),
      buildNeedsActionResponse('reject_task', 'Reject', directTask.id, 'task', 'feedback', true),
      buildNeedsActionResponse('request_changes_task', 'Request changes', directTask.id, 'task', 'feedback', true),
    ];
  }
  if ((actionKind === 'review_work_item' || actionKind === 'review_stage_gate') && gate?.status === 'awaiting_approval') {
    return buildGateDecisionResponses(gate.gate_id);
  }
  if (actionKind === 'resolve_escalation' && directTask) {
    return [
      buildNeedsActionResponse(
        'resolve_escalation',
        'Resume with guidance',
        directTask.id,
        'task',
        'instructions',
        true,
        directTask.work_item_id,
      ),
    ];
  }
  if (actionKind === 'resolve_stage_gate' && gate) {
    return buildGateResolutionResponses(gate);
  }
  if (actionKind === 'unblock_work_item') {
    if (gate?.status === 'changes_requested') {
      return buildGateResolutionResponses(gate);
    }
    return [
      buildNeedsActionResponse('add_work_item', 'Add / Modify Work', target.target_id, target.target_kind, 'none'),
    ];
  }
  return [];
}

function buildGateDecisionResponses(gateId: string): WorkflowNeedsActionResponseAction[] {
  return [
    buildNeedsActionResponse('approve_gate', 'Approve', gateId, 'gate', 'none'),
    buildNeedsActionResponse('reject_gate', 'Reject', gateId, 'gate', 'feedback', true),
    buildNeedsActionResponse('request_changes_gate', 'Request changes', gateId, 'gate', 'feedback', true),
  ];
}

function buildGateResolutionResponses(gate: WorkflowGateRecord): WorkflowNeedsActionResponseAction[] {
  const responses: WorkflowNeedsActionResponseAction[] = [];
  if (gate.status === 'changes_requested') {
    responses.push(buildNeedsActionResponse('approve_gate', 'Approve', gate.gate_id, 'gate', 'none'));
  }
  if (gate.requested_by_work_item_id) {
    responses.push(
      buildNeedsActionResponse('add_work_item', 'Add / Modify Work', gate.requested_by_work_item_id, 'work_item', 'none'),
    );
  }
  return responses;
}

function buildInterventionResponses(
  actionKind: string,
  target: WorkflowNeedsActionItem['target'],
  workItemId: string | null,
): WorkflowNeedsActionResponseAction[] {
  if (actionKind === 'retry_task' && target.target_kind === 'task') {
    return [buildNeedsActionResponse('retry_task', 'Retry task', target.target_id, 'task', 'none')];
  }
  if (actionKind === 'resolve_escalation' && target.target_kind === 'task') {
    return [
      buildNeedsActionResponse(
        'resolve_escalation',
        'Resume with guidance',
        target.target_id,
        'task',
        'instructions',
        true,
        workItemId,
      ),
    ];
  }
  return [];
}

function buildQuickActionResponses(
  actionKind: string,
  target: WorkflowNeedsActionItem['target'],
): WorkflowNeedsActionResponseAction[] {
  if (actionKind === 'redrive_workflow') {
    return [buildNeedsActionResponse('redrive_workflow', 'Redrive workflow', target.target_id, 'workflow', 'none', true)];
  }
  if (actionKind === 'add_work_item') {
    return [buildNeedsActionResponse('add_work_item', 'Add / Modify Work', target.target_id, target.target_kind, 'none')];
  }
  return [];
}

function buildNeedsActionResponse(
  kind: string,
  label: string,
  targetId: string,
  targetKind: WorkflowNeedsActionResponseAction['target']['target_kind'],
  promptKind: WorkflowNeedsActionResponseAction['prompt_kind'],
  requiresConfirmation = false,
  workItemId?: string | null,
): WorkflowNeedsActionResponseAction {
  return {
    action_id: `${targetId}:${kind}`,
    kind,
    label,
    work_item_id: workItemId,
    target: {
      target_kind: targetKind,
      target_id: targetId,
    },
    requires_confirmation: requiresConfirmation,
    prompt_kind: promptKind,
  };
}

function humanizeActionKind(actionKind: string): string {
  return actionKind
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function resolveActionTarget(
  scope: MissionControlActionAvailability['scope'],
  workflowId: string,
  interventions: WorkflowInterventionRecord[],
  selectedWorkItemId: string | null,
): WorkflowNeedsActionItem['target'] {
  if (scope === 'workflow') {
    return { target_kind: 'workflow', target_id: workflowId };
  }
  if (scope === 'work_item') {
    return {
      target_kind: 'work_item',
      target_id: selectedWorkItemId ?? readFirstInterventionId(interventions, 'work_item') ?? workflowId,
    };
  }
  return {
    target_kind: 'task',
    target_id: readFirstInterventionId(interventions, 'task') ?? workflowId,
  };
}

function readFirstInterventionId(
  interventions: WorkflowInterventionRecord[],
  targetKind: WorkflowNeedsActionItem['target']['target_kind'],
): string | null {
  for (const intervention of interventions) {
    const target = readInterventionTarget(intervention, intervention.workflow_id);
    if (target.target_kind === targetKind) {
      return target.target_id;
    }
  }
  return null;
}

function isActionableIntervention(intervention: WorkflowInterventionRecord): boolean {
  return intervention.status === 'open' || intervention.status === 'pending';
}

function isNeedsActionQuickAction(action: MissionControlActionAvailability): boolean {
  return false;
}

function readBoardNeedsActionItems(board: Record<string, unknown>): WorkflowBoardNeedsActionItem[] {
  const workItems = Array.isArray(board.work_items) ? board.work_items : [];
  const items: WorkflowBoardNeedsActionItem[] = [];
  for (const workItem of workItems) {
    if (!workItem || typeof workItem !== 'object' || Array.isArray(workItem)) {
      continue;
    }
    const record = workItem as Record<string, unknown>;
    const workItemId = readOptionalString(record.id);
    if (!workItemId) {
      continue;
    }
    const title = readOptionalString(record.title) ?? 'Work item';
    const gateStatus = readOptionalString(record.gate_status);
    const escalationStatus = readOptionalString(record.escalation_status);
    const blockedState = readOptionalString(record.blocked_state);
    if (gateStatus === 'awaiting_approval') {
      items.push({
        action_id: `${workItemId}:awaiting_approval`,
        action_kind: 'review_work_item',
        label: 'Approval required',
        summary: `${title} is waiting for operator approval.`,
        subject_label: title,
        target: { target_kind: 'work_item', target_id: workItemId },
        stage_name: readOptionalString(record.stage_name) ?? null,
        priority: 'high',
        requires_confirmation: true,
        submission: { route_kind: 'workflow_intervention', method: 'POST' },
        responses: [],
      });
    }
    if (escalationStatus === 'open') {
      items.push({
        action_id: `${workItemId}:open_escalation`,
        action_kind: 'resolve_escalation',
        label: 'Resolve escalation',
        summary: `${title} has an open escalation.`,
        subject_label: title,
        target: { target_kind: 'work_item', target_id: workItemId },
        stage_name: readOptionalString(record.stage_name) ?? null,
        priority: 'high',
        requires_confirmation: false,
        submission: { route_kind: 'workflow_intervention', method: 'POST' },
        responses: [],
      });
    }
    if (blockedState === 'blocked') {
      items.push({
        action_id: `${workItemId}:blocked`,
        action_kind: 'unblock_work_item',
        label: 'Unblock work item',
        summary: buildBlockedSummary(title, record),
        subject_label: title,
        target: { target_kind: 'work_item', target_id: workItemId },
        stage_name: readOptionalString(record.stage_name) ?? null,
        priority: 'high',
        requires_confirmation: false,
        submission: { route_kind: 'workflow_intervention', method: 'POST' },
        responses: [],
      });
      continue;
    }
    if (isBlockedGateStatus(gateStatus)) {
      items.push({
        action_id: `${workItemId}:${gateStatus}`,
        action_kind: 'unblock_work_item',
        label: gateStatus === 'request_changes' || gateStatus === 'changes_requested'
          ? 'Address requested changes'
          : gateStatus === 'rejected'
            ? 'Resolve rejection'
            : 'Unblock work item',
        summary: buildBlockedSummary(title, record),
        subject_label: title,
        target: { target_kind: 'work_item', target_id: workItemId },
        stage_name: readOptionalString(record.stage_name) ?? null,
        priority: 'high',
        requires_confirmation: false,
        submission: { route_kind: 'workflow_intervention', method: 'POST' },
        responses: [],
      });
    }
  }
  return items;
}

function readBoardStageNeedsActionItems(
  board: Record<string, unknown>,
  workflowId: string,
): WorkflowBoardNeedsActionItem[] {
  const stageSummary = Array.isArray(board.stage_summary) ? board.stage_summary : [];
  const actionableWorkItemStages = readActionableWorkItemStages(board);
  const items: WorkflowBoardNeedsActionItem[] = [];
  for (const stage of stageSummary) {
    if (!stage || typeof stage !== 'object' || Array.isArray(stage)) {
      continue;
    }
    const record = stage as Record<string, unknown>;
    const stageName = readOptionalString(record.name);
    const gateStatus = readOptionalString(record.gate_status);
    if (!stageName || !gateStatus || actionableWorkItemStages.has(stageName)) {
      continue;
    }
    if (gateStatus === 'awaiting_approval') {
      items.push({
        action_id: `stage:${stageName}:awaiting_approval`,
        action_kind: 'review_stage_gate',
        label: 'Approval required',
        summary: `Stage ${stageName} is waiting for operator approval.`,
        target: { target_kind: 'workflow', target_id: workflowId },
        stage_name: stageName,
        priority: 'high',
        requires_confirmation: true,
        submission: { route_kind: 'workflow_intervention', method: 'POST' },
        responses: [],
      });
      continue;
    }
    if (['blocked', 'changes_requested', 'rejected'].includes(gateStatus)) {
      items.push({
        action_id: `stage:${stageName}:${gateStatus}`,
        action_kind: 'resolve_stage_gate',
        label: 'Stage requires intervention',
        summary: `Stage ${stageName} is ${humanizeGateStatus(gateStatus)} and needs operator intervention.`,
        target: { target_kind: 'workflow', target_id: workflowId },
        stage_name: stageName,
        priority: 'high',
        requires_confirmation: false,
        submission: { route_kind: 'workflow_intervention', method: 'POST' },
        responses: [],
      });
    }
  }
  return items;
}

function readActionableWorkItemStages(board: Record<string, unknown>): Set<string> {
  const workItems = Array.isArray(board.work_items) ? board.work_items : [];
  const stages = new Set<string>();
  for (const workItem of workItems) {
    if (!workItem || typeof workItem !== 'object' || Array.isArray(workItem)) {
      continue;
    }
    const record = workItem as Record<string, unknown>;
    const stageName = readOptionalString(record.stage_name);
    const gateStatus = readOptionalString(record.gate_status);
    const escalationStatus = readOptionalString(record.escalation_status);
    const blockedState = readOptionalString(record.blocked_state);
    if (!stageName) {
      continue;
    }
    if (
      gateStatus === 'awaiting_approval'
      || escalationStatus === 'open'
      || blockedState === 'blocked'
      || isBlockedGateStatus(gateStatus)
    ) {
      stages.add(stageName);
    }
  }
  return stages;
}

function readStructuredActionKind(intervention: WorkflowInterventionRecord): string | null {
  const value = intervention.structured_action?.kind;
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function isActionableGateStatus(status: string): boolean {
  return status === 'awaiting_approval'
    || status === 'changes_requested'
    || status === 'blocked'
    || status === 'rejected';
}

function readInterventionTarget(
  intervention: WorkflowInterventionRecord,
  workflowId: string,
): WorkflowNeedsActionItem['target'] {
  if (typeof intervention.task_id === 'string' && intervention.task_id.trim().length > 0) {
    return {
      target_kind: 'task',
      target_id: intervention.task_id,
    };
  }
  if (typeof intervention.work_item_id === 'string' && intervention.work_item_id.trim().length > 0) {
    return {
      target_kind: 'work_item',
      target_id: intervention.work_item_id,
    };
  }
  return {
    target_kind: 'workflow',
    target_id: workflowId,
  };
}

function readSessionStatus(session: WorkflowSteeringSessionRecord | null): string {
  if (!session) {
    return 'idle';
  }
  return session.status.trim().length > 0 ? session.status : 'open';
}

function compareNeedsActionPriority(
  left: WorkflowNeedsActionItem,
  right: WorkflowNeedsActionItem,
): number {
  return readNeedsActionPriorityRank(left.priority) - readNeedsActionPriorityRank(right.priority);
}

function readNeedsActionPriorityRank(priority: WorkflowNeedsActionItem['priority']): number {
  switch (priority) {
    case 'high':
      return 0;
    case 'medium':
      return 1;
    default:
      return 2;
  }
}

function buildBlockedSummary(title: string, record: Record<string, unknown>): string {
  const blockedReason =
    readOptionalString(record.blocked_reason) ?? readOptionalString(record.gate_decision_feedback);
  if (blockedReason) {
    return `${title} is blocked: ${blockedReason}`;
  }
  return `${title} is blocked and needs operator intervention.`;
}

function isBlockedGateStatus(gateStatus: string | null): boolean {
  return gateStatus === 'blocked'
    || gateStatus === 'request_changes'
    || gateStatus === 'changes_requested'
    || gateStatus === 'rejected';
}

function readRedriveLineage(workflow: Record<string, unknown>): Record<string, unknown> | null {
  const rootWorkflowId = readOptionalString(workflow.root_workflow_id);
  const previousAttemptWorkflowId = readOptionalString(workflow.previous_attempt_workflow_id);
  const attemptNumber = workflow.attempt_number;
  const attemptKind = readOptionalString(workflow.attempt_kind);
  if (!rootWorkflowId && !previousAttemptWorkflowId && attemptNumber == null && !attemptKind) {
    return null;
  }
  return {
    root_workflow_id: rootWorkflowId,
    previous_attempt_workflow_id: previousAttemptWorkflowId,
    attempt_number: attemptNumber ?? null,
    attempt_kind: attemptKind,
  };
}

function readOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readOptionalInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : null;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => readOptionalString(entry))
    .filter((entry): entry is string => entry !== null);
}

function ensureSentence(value: string): string {
  return /[.!?]$/.test(value) ? value : `${value}.`;
}

function buildTaskVerificationSummary(verification: Record<string, unknown>): string | null {
  const operatorSummary = readConciseRecordText(verification, ['summary', 'reason', 'details', 'assessment_prompt', 'message']);
  if (operatorSummary) {
    return operatorSummary;
  }
  if (typeof verification.passed === 'boolean') {
    return verification.passed ? 'Verification passed.' : 'Verification reported a failing check.';
  }
  const fieldCount = Object.keys(verification).length;
  if (fieldCount === 0) {
    return null;
  }
  return `${fieldCount} verification ${fieldCount === 1 ? 'field' : 'fields'} recorded.`;
}

function summarizeConcerns(concerns: string[]): string | null {
  if (concerns.length === 0) {
    return null;
  }
  if (concerns.length === 1) {
    return concerns[0];
  }
  return `${concerns[0]} (+${concerns.length - 1} more)`;
}

function readConciseRecordText(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = readOptionalString(record[key]);
    if (!value) {
      continue;
    }
    return value.length > 180 ? `${value.slice(0, 179)}…` : value;
  }
  return null;
}

function humanizeToken(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function humanizeGateStatus(value: string): string {
  return value.replaceAll('_', ' ');
}
