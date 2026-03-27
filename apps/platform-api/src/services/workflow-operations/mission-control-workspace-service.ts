import { filterPacketsByCategories } from './mission-control-packet-support.js';
import type { MissionControlWorkspaceResponse } from './mission-control-types.js';
import { MissionControlHistoryService } from './mission-control-history-service.js';
import { MissionControlLiveService } from './mission-control-live-service.js';
import type { WorkflowService } from '../workflow-service.js';

export class MissionControlWorkspaceService {
  constructor(
    private readonly workflowService: Pick<WorkflowService, 'getWorkflow' | 'getWorkflowBoard'>,
    private readonly liveService: MissionControlLiveService,
    private readonly historyService: MissionControlHistoryService,
  ) {}

  async getWorkspace(
    tenantId: string,
    workflowId: string,
    input: { historyLimit?: number; outputLimit?: number } = {},
  ): Promise<MissionControlWorkspaceResponse> {
    const [workflow, board, cards, outputs, history] = await Promise.all([
      this.workflowService.getWorkflow(tenantId, workflowId),
      this.workflowService.getWorkflowBoard(tenantId, workflowId),
      this.liveService.listWorkflowCards(tenantId, { workflowIds: [workflowId] }),
      this.liveService.listWorkflowOutputDescriptors(tenantId, [workflowId], input.outputLimit ?? 5),
      this.historyService.getHistory(tenantId, { workflowId, limit: input.historyLimit ?? 50 }),
    ]);

    const workflowCard = cards[0] ?? null;
    const deliverables = outputs.get(workflowId) ?? [];

    return {
      version: history.version,
      workflow: workflowCard,
      overview: workflowCard
        ? {
            currentOperatorAsk: workflowCard.pulse.summary,
            latestOutput: deliverables[0] ?? null,
            inputSummary: {
              parameterCount: Object.keys(asRecord(workflow.parameters)).length,
              parameterKeys: Object.keys(asRecord(workflow.parameters)).slice(0, 10),
              contextKeys: Object.keys(asRecord(workflow.context)).slice(0, 10),
            },
            relationSummary: asRecord(workflow.workflow_relations),
            riskSummary: {
              blockedWorkItemCount: workflowCard.metrics.blockedWorkItemCount,
              openEscalationCount: workflowCard.metrics.openEscalationCount,
              failedTaskCount: workflowCard.metrics.failedTaskCount,
              recoverableIssueCount: workflowCard.metrics.recoverableIssueCount,
            },
          }
        : null,
      board: board as Record<string, unknown>,
      outputs: {
        deliverables,
        feed: filterPacketsByCategories(history.packets, ['output', 'progress']),
      },
      steering: {
        availableActions: workflowCard?.availableActions ?? [],
        interventionHistory: filterPacketsByCategories(history.packets, ['decision', 'intervention']),
      },
      history: {
        packets: history.packets,
      },
    };
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}
