import type { WorkflowDeliverableRecord } from '../workflow-deliverables/workflow-deliverable-service.js';
import type { WorkflowDeliverableHandoffRecord } from '../workflow-deliverables/workflow-deliverable-handoff-service.js';
import type { WorkflowInputPacketRecord } from './workflow-input-packet-service.js';
import type { WorkflowOperatorBriefRecord } from '../workflow-operator/workflow-operator-brief-service.js';
import type { ResolvedDocumentReference } from '../document-reference/document-reference-service.js';
import type { WorkflowDeliverablesPacket } from './workflow-operations-types.js';

import {
  appendSynthesizedWorkflowDocumentDeliverables,
  normalizeDeliverableTargets,
  suppressMirroredWorkflowRollupDuplicates,
} from './workflow-deliverables-service/document-deliverables.js';
import {
  appendSynthesizedBriefDeliverables,
  appendSynthesizedHandoffDeliverables,
  suppressShadowedOrchestratorBriefPackets,
} from './workflow-deliverables-service/synthesis.js';
import {
  compareDeliverables,
  packetMatchesScope,
} from './workflow-deliverables-service/shared.js';
import {
  buildDeliverableWorkItemAttribution,
  collectFinalizedBriefIds,
  collectFinalizedDescriptorIds,
  collectLinkedTargetCandidateIds,
  resolveDeliverableWorkItemId,
  selectDeliverableScopeDeliverables,
  selectDeliverableScopeRecords,
  shouldRollUpChildScopeBrief,
} from './workflow-deliverables-service/scoping.js';
import {
  isCurrentFinalDeliverable,
  isDeliverableBrief,
  normalizeDeliverableForPresentation,
  shouldExposeCurrentDeliverable,
} from './workflow-deliverables-service/classification.js';
import {
  paginateOrderedItems,
  resolveFetchWindow,
} from './workflow-packet-cursors.js';

interface DeliverableSource {
  listDeliverables(
    tenantId: string,
    workflowId: string,
    input?: {
      workItemId?: string;
      includeWorkflowScope?: boolean;
      includeAllWorkItemScopes?: boolean;
      limit?: number;
    },
  ): Promise<WorkflowDeliverableRecord[]>;
}

interface BriefSource {
  listBriefs(
    tenantId: string,
    workflowId: string,
    input?: {
      workItemId?: string;
      includeWorkflowScope?: boolean;
      includeAllWorkItemScopes?: boolean;
      limit?: number;
    },
  ): Promise<WorkflowOperatorBriefRecord[]>;
}

interface InputPacketSource {
  listWorkflowInputPackets(tenantId: string, workflowId: string): Promise<WorkflowInputPacketRecord[]>;
}

interface HandoffSource {
  listLatestCompletedWorkItemHandoffs(
    tenantId: string,
    workflowId: string,
    input?: { workItemId?: string },
  ): Promise<WorkflowDeliverableHandoffRecord[]>;
}

interface IncompleteWorkItemSource {
  listIncompleteWorkItemIds(
    tenantId: string,
    workflowId: string,
    input?: { workItemId?: string },
  ): Promise<string[]>;

  listExistingWorkItemIds?(
    tenantId: string,
    workflowId: string,
    input?: { candidateIds?: string[] },
  ): Promise<string[]>;
}

interface WorkflowDocumentSource {
  listWorkflowDocuments(
    tenantId: string,
    workflowId: string,
  ): Promise<ResolvedDocumentReference[]>;
}

export class WorkflowDeliverablesService {
  constructor(
    private readonly deliverableSource: DeliverableSource,
    private readonly briefSource: BriefSource,
    private readonly inputPacketSource: InputPacketSource,
    private readonly handoffSource?: HandoffSource,
    private readonly incompleteWorkItemSource?: IncompleteWorkItemSource,
    private readonly workflowDocumentSource?: WorkflowDocumentSource,
  ) {}

  async getDeliverables(
    tenantId: string,
    workflowId: string,
    input: { limit?: number; workItemId?: string; after?: string } = {},
  ): Promise<WorkflowDeliverablesPacket & { all_deliverables: WorkflowDeliverableRecord[] }> {
    const limit = input.limit ?? 10;
    const fetchWindow = resolveFetchWindow(limit);
    const includeWorkflowScope = Boolean(input.workItemId);
    const includeAllWorkItemScopes = !input.workItemId;
    const allowIncompleteReclassification = true;
    const [deliverables, briefs, inputPackets, handoffs, incompleteWorkItemIds, workflowDocuments] = await Promise.all([
      this.deliverableSource.listDeliverables(tenantId, workflowId, {
        workItemId: input.workItemId,
        includeWorkflowScope,
        includeAllWorkItemScopes,
        limit: fetchWindow,
      }),
      this.briefSource.listBriefs(tenantId, workflowId, {
        workItemId: input.workItemId,
        includeWorkflowScope,
        includeAllWorkItemScopes,
        limit: fetchWindow,
      }),
      this.inputPacketSource.listWorkflowInputPackets(tenantId, workflowId),
      this.handoffSource?.listLatestCompletedWorkItemHandoffs(tenantId, workflowId, {
        workItemId: input.workItemId,
      }) ?? Promise.resolve([]),
      this.incompleteWorkItemSource?.listIncompleteWorkItemIds(tenantId, workflowId, {
        workItemId: input.workItemId,
      }) ?? Promise.resolve([]),
      this.workflowDocumentSource?.listWorkflowDocuments(tenantId, workflowId) ?? Promise.resolve([]),
    ]);

    const linkedWorkItemIds = await this.incompleteWorkItemSource?.listExistingWorkItemIds?.(
      tenantId,
      workflowId,
      {
        candidateIds: collectLinkedTargetCandidateIds(briefs),
      },
    ) ?? [];
    const linkedWorkItemIdSet = new Set(linkedWorkItemIds);
    const incompleteWorkItemIdSet = new Set(incompleteWorkItemIds);
    const deliverableWorkItemAttribution = buildDeliverableWorkItemAttribution(
      briefs,
      linkedWorkItemIdSet,
    );
    const deliverableScopeBriefs = selectDeliverableScopeRecords(
      briefs,
      input.workItemId,
      (brief) => resolveDeliverableWorkItemId(brief, linkedWorkItemIdSet),
      (brief) => shouldRollUpChildScopeBrief(brief, linkedWorkItemIdSet),
    );
    const scopedHandoffs = selectDeliverableScopeRecords(
      handoffs,
      input.workItemId,
      (handoff) => handoff.work_item_id,
      () => true,
    );
    const finalizedBriefIds = collectFinalizedBriefIds(deliverableScopeBriefs);
    const finalizedDescriptorIds = collectFinalizedDescriptorIds(deliverableScopeBriefs);
    const deliverableScopeRecords = selectDeliverableScopeDeliverables(
      deliverables,
      input.workItemId,
      deliverableWorkItemAttribution,
      finalizedBriefIds,
      finalizedDescriptorIds,
    );
    const hydratedDeliverables = suppressShadowedOrchestratorBriefPackets(
      appendSynthesizedBriefDeliverables(
        appendSynthesizedHandoffDeliverables(deliverableScopeRecords, scopedHandoffs),
        deliverableScopeBriefs,
        linkedWorkItemIdSet,
      ),
      deliverableScopeBriefs,
    );
    const normalizedDeliverables = suppressMirroredWorkflowRollupDuplicates(
      appendSynthesizedWorkflowDocumentDeliverables(
        hydratedDeliverables,
        workflowDocuments,
        workflowId,
      ).map(normalizeDeliverableTargets),
      input.workItemId,
    );

    const orderedDeliverables = [...normalizedDeliverables].sort((left, right) =>
      compareDeliverables(left, right),
    );
    const visibleDeliverables = orderedDeliverables.filter((deliverable) =>
      shouldExposeCurrentDeliverable(
        deliverable,
        incompleteWorkItemIdSet,
        finalizedBriefIds,
        finalizedDescriptorIds,
      ),
    );
    const page = paginateOrderedItems(visibleDeliverables, limit, input.after, (deliverable) => ({
      timestamp: deliverable.updated_at ?? deliverable.created_at,
      id: deliverable.descriptor_id,
    }));
    const allDeliverables = orderedDeliverables.map((deliverable) =>
      normalizeDeliverableForPresentation(deliverable, incompleteWorkItemIdSet),
    );

    return {
      final_deliverables: page.items
        .filter((deliverable) =>
          isCurrentFinalDeliverable(
            deliverable,
            incompleteWorkItemIdSet,
            allowIncompleteReclassification,
            finalizedBriefIds,
            finalizedDescriptorIds,
          ),
        )
        .map((deliverable) =>
          normalizeDeliverableForPresentation(deliverable, incompleteWorkItemIdSet),
        ),
      in_progress_deliverables: page.items
        .filter((deliverable) =>
          !isCurrentFinalDeliverable(
            deliverable,
            incompleteWorkItemIdSet,
            allowIncompleteReclassification,
            finalizedBriefIds,
            finalizedDescriptorIds,
          ),
        )
        .map((deliverable) =>
          normalizeDeliverableForPresentation(deliverable, incompleteWorkItemIdSet),
        ),
      working_handoffs: deliverableScopeBriefs.filter(isDeliverableBrief),
      inputs_and_provenance: {
        launch_packet: pickSinglePacket(inputPackets, 'launch', input.workItemId),
        supplemental_packets: filterPacketKinds(
          inputPackets,
          ['intake', 'plan_update'],
          input.workItemId,
        ),
        intervention_attachments: filterPacketKinds(
          inputPackets,
          ['intervention_attachment'],
          input.workItemId,
        ),
        redrive_packet: pickSinglePacket(inputPackets, 'redrive_patch', input.workItemId),
      },
      next_cursor: page.nextCursor,
      all_deliverables: allDeliverables,
    };
  }
}

function pickSinglePacket(
  packets: WorkflowInputPacketRecord[],
  packetKind: string,
  workItemId?: string,
): WorkflowInputPacketRecord | null {
  return packets.find((packet) =>
    packet.packet_kind?.trim() === packetKind
    && packetMatchesScope(packet, workItemId),
  ) ?? null;
}

function filterPacketKinds(
  packets: WorkflowInputPacketRecord[],
  packetKinds: string[],
  workItemId?: string,
): WorkflowInputPacketRecord[] {
  return packets.filter((packet) => {
    if (!packetKinds.includes(packet.packet_kind?.trim() ?? '')) {
      return false;
    }
    return packetMatchesScope(packet, workItemId);
  });
}
