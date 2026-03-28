import type { WorkflowDeliverableRecord } from '../workflow-deliverable-service.js';
import type { WorkflowInputPacketRecord } from '../workflow-input-packet-service.js';
import type { WorkflowOperatorBriefRecord } from '../workflow-operator-brief-service.js';
import type { WorkflowDeliverablesPacket } from './workflow-operations-types.js';
import {
  paginateOrderedItems,
  resolveFetchWindow,
} from './workflow-packet-cursors.js';

interface DeliverableSource {
  listDeliverables(
    tenantId: string,
    workflowId: string,
    input?: { workItemId?: string; limit?: number },
  ): Promise<WorkflowDeliverableRecord[]>;
}

interface BriefSource {
  listBriefs(
    tenantId: string,
    workflowId: string,
    input?: { workItemId?: string; limit?: number },
  ): Promise<WorkflowOperatorBriefRecord[]>;
}

interface InputPacketSource {
  listWorkflowInputPackets(tenantId: string, workflowId: string): Promise<WorkflowInputPacketRecord[]>;
}

export class WorkflowDeliverablesService {
  constructor(
    private readonly deliverableSource: DeliverableSource,
    private readonly briefSource: BriefSource,
    private readonly inputPacketSource: InputPacketSource,
  ) {}

  async getDeliverables(
    tenantId: string,
    workflowId: string,
    input: { limit?: number; workItemId?: string; after?: string } = {},
  ): Promise<WorkflowDeliverablesPacket & { all_deliverables: WorkflowDeliverableRecord[] }> {
    const limit = input.limit ?? 10;
    const fetchWindow = resolveFetchWindow(limit);
    const [deliverables, briefs, inputPackets] = await Promise.all([
      this.deliverableSource.listDeliverables(tenantId, workflowId, {
        workItemId: input.workItemId,
        limit: fetchWindow,
      }),
      this.briefSource.listBriefs(tenantId, workflowId, {
        workItemId: input.workItemId,
        limit,
      }),
      this.inputPacketSource.listWorkflowInputPackets(tenantId, workflowId),
    ]);
    const finalizedBriefIds = collectFinalizedBriefIds(briefs);
    const finalizedDescriptorIds = collectFinalizedDescriptorIds(briefs);

    const orderedDeliverables = [...deliverables].sort((left, right) =>
      compareDeliverables(left, right),
    );
    const page = paginateOrderedItems(orderedDeliverables, limit, input.after, (deliverable) => ({
      timestamp: deliverable.updated_at ?? deliverable.created_at,
      id: deliverable.descriptor_id,
    }));
    const allDeliverables = page.items;
    return {
      final_deliverables: allDeliverables.filter((deliverable) =>
        isFinalDeliverable(deliverable, finalizedBriefIds, finalizedDescriptorIds),
      ),
      in_progress_deliverables: allDeliverables.filter((deliverable) =>
        !isFinalDeliverable(deliverable, finalizedBriefIds, finalizedDescriptorIds),
      ),
      working_handoffs: briefs.filter(isDeliverableBrief),
      inputs_and_provenance: {
        launch_packet: pickSinglePacket(inputPackets, 'launch'),
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
        redrive_packet: pickSinglePacket(inputPackets, 'redrive_patch'),
      },
      next_cursor: page.nextCursor,
      all_deliverables: allDeliverables,
    };
  }
}

function isDeliverableBrief(brief: WorkflowOperatorBriefRecord): boolean {
  return readOptionalString(brief.brief_scope) === 'deliverable_context';
}

function isFinalDeliverable(
  deliverable: WorkflowDeliverableRecord,
  finalizedBriefIds: Set<string>,
  finalizedDescriptorIds: Set<string>,
): boolean {
  return (
    readOptionalString(deliverable.delivery_stage) === 'final' ||
    readOptionalString(deliverable.state) === 'final' ||
    finalizedBriefIds.has(deliverable.source_brief_id ?? '') ||
    finalizedDescriptorIds.has(deliverable.descriptor_id)
  );
}

function collectFinalizedBriefIds(briefs: WorkflowOperatorBriefRecord[]): Set<string> {
  return new Set(
    briefs
      .filter((brief) => isDeliverableOutcomeStatus(readOptionalString(brief.status_kind)))
      .map((brief) => brief.id),
  );
}

function collectFinalizedDescriptorIds(briefs: WorkflowOperatorBriefRecord[]): Set<string> {
  const ids = new Set<string>();
  for (const brief of briefs) {
    if (!isDeliverableOutcomeStatus(readOptionalString(brief.status_kind))) {
      continue;
    }
    for (const descriptorId of brief.related_output_descriptor_ids ?? []) {
      const normalizedId = readOptionalString(descriptorId);
      if (normalizedId) {
        ids.add(normalizedId);
      }
    }
  }
  return ids;
}

function isDeliverableOutcomeStatus(statusKind: string | null): boolean {
  return statusKind === 'completed' || statusKind === 'final' || statusKind === 'approved';
}

function pickSinglePacket(
  packets: WorkflowInputPacketRecord[],
  packetKind: string,
) : WorkflowInputPacketRecord | null {
  return packets.find((packet) => readOptionalString(packet.packet_kind) === packetKind) ?? null;
}

function filterPacketKinds(
  packets: WorkflowInputPacketRecord[],
  packetKinds: string[],
  workItemId?: string,
): WorkflowInputPacketRecord[] {
  return packets.filter((packet) => {
    if (!packetKinds.includes(readOptionalString(packet.packet_kind) ?? '')) {
      return false;
    }
    if (!workItemId) {
      return true;
    }
    return readOptionalString(packet.work_item_id) === workItemId;
  });
}

function readOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function compareDeliverables(
  left: WorkflowDeliverableRecord,
  right: WorkflowDeliverableRecord,
): number {
  const leftTimestamp = left.updated_at ?? left.created_at;
  const rightTimestamp = right.updated_at ?? right.created_at;
  return rightTimestamp.localeCompare(leftTimestamp) || right.descriptor_id.localeCompare(left.descriptor_id);
}
