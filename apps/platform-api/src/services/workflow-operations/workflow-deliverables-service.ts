import type { MissionControlOutputDescriptor } from './mission-control-types.js';
import type { WorkflowDeliverablesPacket } from './workflow-operations-types.js';

interface DeliverableSource {
  listWorkflowOutputDescriptors(
    tenantId: string,
    workflowIds: string[],
    limitPerWorkflow?: number,
  ): Promise<Map<string, MissionControlOutputDescriptor[]>>;
}

export class WorkflowDeliverablesService {
  constructor(private readonly source: DeliverableSource) {}

  async getDeliverables(
    tenantId: string,
    workflowId: string,
    input: { limit?: number } = {},
  ): Promise<WorkflowDeliverablesPacket & { all_deliverables: MissionControlOutputDescriptor[] }> {
    const descriptors = (await this.source.listWorkflowOutputDescriptors(
      tenantId,
      [workflowId],
      input.limit ?? 10,
    )).get(workflowId) ?? [];
    return {
      final_deliverables: descriptors.filter((descriptor) => descriptor.status === 'final'),
      in_progress_deliverables: descriptors.filter((descriptor) => descriptor.status !== 'final'),
      working_handoffs: [],
      inputs_and_provenance: {
        launch_packet: null,
        supplemental_packets: [],
        intervention_attachments: [],
        redrive_packet: null,
      },
      next_cursor: null,
      all_deliverables: descriptors,
    };
  }
}
