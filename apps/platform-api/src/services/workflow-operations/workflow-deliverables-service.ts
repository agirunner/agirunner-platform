import type { WorkflowDeliverableRecord } from '../workflow-deliverable-service.js';
import type { WorkflowInputPacketRecord } from '../workflow-input-packet-service.js';
import type { WorkflowInterventionRecord } from '../workflow-intervention-service.js';
import type { WorkflowOperatorBriefRecord } from '../workflow-operator-brief-service.js';
import type { WorkflowDeliverablesPacket } from './workflow-operations-types.js';

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

interface InterventionSource {
  listWorkflowInterventions(tenantId: string, workflowId: string): Promise<WorkflowInterventionRecord[]>;
}

export class WorkflowDeliverablesService {
  constructor(
    private readonly deliverableSource: DeliverableSource,
    private readonly briefSource: BriefSource,
    private readonly inputPacketSource: InputPacketSource,
    private readonly interventionSource: InterventionSource,
  ) {}

  async getDeliverables(
    tenantId: string,
    workflowId: string,
    input: { limit?: number; workItemId?: string } = {},
  ): Promise<WorkflowDeliverablesPacket & { all_deliverables: WorkflowDeliverableRecord[] }> {
    const limit = input.limit ?? 10;
    const [deliverables, briefs, inputPackets, interventions] = await Promise.all([
      this.deliverableSource.listDeliverables(tenantId, workflowId, {
        workItemId: input.workItemId,
        limit,
      }),
      this.briefSource.listBriefs(tenantId, workflowId, {
        workItemId: input.workItemId,
        limit,
      }),
      this.inputPacketSource.listWorkflowInputPackets(tenantId, workflowId),
      this.interventionSource.listWorkflowInterventions(tenantId, workflowId),
    ]);

    const allDeliverables = deliverables;
    return {
      final_deliverables: allDeliverables.filter(isFinalDeliverable),
      in_progress_deliverables: allDeliverables.filter((deliverable) => !isFinalDeliverable(deliverable)),
      working_handoffs: briefs.filter((brief) => readOptionalString(brief.brief_scope) !== 'workflow_timeline'),
      inputs_and_provenance: {
        launch_packet: pickSinglePacket(inputPackets, 'launch'),
        supplemental_packets: filterSupplementalPackets(inputPackets, input.workItemId),
        intervention_attachments: filterInterventionAttachments(interventions, input.workItemId),
        redrive_packet: pickSinglePacket(inputPackets, 'redrive'),
      },
      next_cursor: null,
      all_deliverables: allDeliverables,
    };
  }
}

function isFinalDeliverable(deliverable: WorkflowDeliverableRecord): boolean {
  return (
    readOptionalString(deliverable.delivery_stage) === 'final' ||
    readOptionalString(deliverable.state) === 'final'
  );
}

function pickSinglePacket(
  packets: WorkflowInputPacketRecord[],
  packetKind: string,
) : WorkflowInputPacketRecord | null {
  return packets.find((packet) => readOptionalString(packet.packet_kind) === packetKind) ?? null;
}

function filterSupplementalPackets(
  packets: WorkflowInputPacketRecord[],
  workItemId?: string,
): WorkflowInputPacketRecord[] {
  return packets.filter((packet) => {
    if (readOptionalString(packet.packet_kind) !== 'supplemental') {
      return false;
    }
    if (!workItemId) {
      return true;
    }
    return readOptionalString(packet.work_item_id) === workItemId;
  });
}

function filterInterventionAttachments(
  interventions: WorkflowInterventionRecord[],
  workItemId?: string,
): WorkflowInterventionRecord[] {
  return interventions.filter((intervention) => {
    const files = intervention.files;
    if (!Array.isArray(files) || files.length === 0) {
      return false;
    }
    if (!workItemId) {
      return true;
    }
    return readOptionalString(intervention.work_item_id) === workItemId;
  });
}

function readOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
