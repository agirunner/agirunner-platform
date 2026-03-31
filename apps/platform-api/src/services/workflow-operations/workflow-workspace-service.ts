import type { WorkflowService } from '../workflow-service/workflow-service.js';
import type { WorkflowDeliverableRecord } from '../workflow-deliverables/workflow-deliverable-service.js';
import type {
  WorkflowInterventionService,
} from '../workflow-intervention-service.js';
import type {
  WorkflowSteeringSessionService,
} from '../workflow-steering-session-service/workflow-steering-session-service.js';
import type { WorkflowDeliverablesService } from './workflow-deliverables-service.js';
import type { WorkflowHistoryService } from './workflow-history-service.js';
import type { WorkflowLiveConsoleService } from './workflow-live-console-service.js';
import type { WorkflowRailService } from './workflow-rail-service.js';
import type { WorkflowWorkspacePacket } from './workflow-operations-types.js';
import {
  buildNeedsActionItems,
  buildNeedsActionPacket,
} from './workflow-workspace/workflow-workspace-needs-action-core.js';
import {
  loadActionableTasks,
  loadWorkflowGates,
  loadWorkflowTaskBindings,
} from './workflow-workspace/workflow-workspace-needs-action-loaders.js';
import {
  buildWorkspaceDeliverablesPacket,
  normalizeWorkspaceDeliverablesPacket,
} from './workflow-workspace/workflow-workspace-deliverables.js';
import {
  buildBoardTaskToWorkItemMap,
  buildBottomTabs,
  buildEmptyBriefsPacket,
  buildStickyStrip,
  filterBriefsForSelectedScope,
  filterHistoryForSelectedScope,
  filterLiveConsoleForSelectedScope,
  mergeTaskToWorkItemMaps,
  normalizeLiveConsolePacketForVisibleRows,
  readBoardWorkItemIds,
  readPacketTotalCount,
  resolveSelectedScope,
  buildTaskToWorkItemMap,
} from './workflow-workspace/workflow-workspace-scope.js';
import {
  canAcceptWorkflowSteering,
  filterSteeringInterventionsForSelectedScope,
  filterSteeringQuickActions,
  mergeSteeringMessagesIntoLiveConsole,
  readSessionStatus,
  selectSteeringSessionForSelectedScope,
  selectSteeringSessionsForSelectedScope,
} from './workflow-workspace/workflow-workspace-steering.js';
import { readRedriveLineage } from './workflow-workspace/workflow-workspace-common.js';
import type {
  GateActionSource,
  TaskActionSource,
  WorkflowWorkspaceQuery,
} from './workflow-workspace/workflow-workspace-types.js';

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
    const shouldFilterSelectedScope =
      selectedScope.scope_kind === 'selected_work_item' || selectedScope.scope_kind === 'selected_task';
    const scopedWorkItemId =
      shouldFilterSelectedScope
        ? selectedScope.work_item_id
        : undefined;
    const scopedTaskId = selectedScope.scope_kind === 'selected_task'
      ? selectedScope.task_id
      : undefined;
    const briefScope = shouldFilterSelectedScope
      ? { workItemId: undefined, taskId: undefined }
      : { workItemId: scopedWorkItemId ?? undefined, taskId: scopedTaskId ?? undefined };

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
      workflowTaskBindings,
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
          workItemId: briefScope.workItemId,
          taskId: briefScope.taskId,
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
        loadWorkflowTaskBindings(
          shouldFilterSelectedScope ? this.taskActionSource : undefined,
          tenantId,
          workflowId,
        ),
        loadWorkflowGates(this.gateActionSource, tenantId, workflowId),
      ]);

    const allNeedsActionItems = buildNeedsActionItems(
      workflowId,
      board as Record<string, unknown>,
      interventions,
      actionableTasks,
      gates,
    );
    const needsAction = buildNeedsActionPacket(allNeedsActionItems, selectedScope);

    const normalizedDeliverables = normalizeWorkspaceDeliverablesPacket(deliverables);
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

    const boardTaskToWorkItemIds = mergeTaskToWorkItemMaps(
      buildBoardTaskToWorkItemMap(board as Record<string, unknown>),
      buildTaskToWorkItemMap(workflowTaskBindings),
    );
    const effectiveBriefs = filterBriefsForSelectedScope(
      briefs ?? buildEmptyBriefsPacket(history),
      selectedScope,
      boardTaskToWorkItemIds,
    );
    const effectiveHistory = filterHistoryForSelectedScope(history, selectedScope);
    const scopedInterventions = filterSteeringInterventionsForSelectedScope(interventions, selectedScope);
    const scopedSteeringSessions = selectSteeringSessionsForSelectedScope(sessions, selectedScope);
    const scopedSteeringSessionEntries = await Promise.all(
      scopedSteeringSessions.map(async (session) => ({
        sessionId: session.id,
        messages: await this.steeringSessionService.listMessages(tenantId, workflowId, session.id),
      })),
    );
    const scopedSteeringMessages = scopedSteeringSessionEntries.flatMap((entry) => entry.messages);
    const activeSession = selectSteeringSessionForSelectedScope(sessions, selectedScope);
    const steeringQuickActions = filterSteeringQuickActions(workflowCard?.availableActions ?? []);
    const sessionMessages = activeSession
      ? scopedSteeringSessionEntries.find((entry) => entry.sessionId === activeSession.id)?.messages ?? []
      : [];

    const liveConsoleWithSteering = mergeSteeringMessagesIntoLiveConsole(liveConsole, scopedSteeringMessages);
    const normalizedLiveConsole = normalizeLiveConsolePacketForVisibleRows(liveConsoleWithSteering);
    const effectiveLiveConsole = filterLiveConsoleForSelectedScope(
      normalizedLiveConsole,
      selectedScope,
      readBoardWorkItemIds(board as Record<string, unknown>),
      boardTaskToWorkItemIds,
    );

    const bottomTabs = buildBottomTabs(
      needsAction.total_count,
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
              sessions.length > 0 || interventions.length > 0 || steeringQuickActions.some((action) => action.enabled),
            )
          : null,
      board: board as Record<string, unknown>,
      bottom_tabs: bottomTabs,
      needs_action: needsAction,
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
          can_accept_request: canAcceptWorkflowSteering(workflowCard),
          active_session_id: activeSession ? String(activeSession.id) : null,
          last_summary: workflowCard?.pulse.summary ?? null,
        },
        recent_interventions: scopedInterventions.slice(0, 10),
        session: {
          session_id: activeSession ? String(activeSession.id) : null,
          status: readSessionStatus(activeSession),
          messages: sessionMessages,
        },
      },
      live_console: effectiveLiveConsole,
      briefs: effectiveBriefs,
      history: effectiveHistory,
      deliverables: workspaceDeliverables as {
        final_deliverables: WorkflowDeliverableRecord[];
        in_progress_deliverables: WorkflowDeliverableRecord[];
      } & WorkflowWorkspacePacket['deliverables'],
      redrive_lineage: readRedriveLineage(workflow),
    };
  }
}
