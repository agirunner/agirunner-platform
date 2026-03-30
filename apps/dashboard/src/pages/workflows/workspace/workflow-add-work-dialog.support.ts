import type { DashboardWorkflowInputPacketRecord } from '../../../lib/api.js';

export interface WorkflowAddWorkInputDraft {
  id: string;
  key: string;
  value: string;
}

export function buildInitialWorkItemInputDrafts(input: {
  mode: 'create' | 'modify' | 'repeat';
  sourceWorkItemId: string | null;
  inputPackets: Array<
    Pick<DashboardWorkflowInputPacketRecord, 'work_item_id' | 'created_at' | 'structured_inputs'>
  >;
}): WorkflowAddWorkInputDraft[] {
  if (input.mode !== 'repeat' || !input.sourceWorkItemId) {
    return [];
  }

  const latestPacket = [...input.inputPackets]
    .filter((packet) => packet.work_item_id === input.sourceWorkItemId)
    .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))[0];

  if (!latestPacket) {
    return [];
  }

  return buildWorkItemInputDraftsFromStructuredInputs(latestPacket.structured_inputs);
}

export function buildWorkItemInputDraftsFromStructuredInputs(
  structuredInputs: Record<string, unknown> | null | undefined,
): WorkflowAddWorkInputDraft[] {
  if (!structuredInputs) {
    return [];
  }

  return Object.entries(structuredInputs)
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([key, value], index) => ({
      id: `prefill-${index}`,
      key,
      value: stringifyStructuredInputValue(value),
    }));
}

function stringifyStructuredInputValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return String(value);
  }
  return JSON.stringify(value);
}
