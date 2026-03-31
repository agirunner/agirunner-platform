import type { WorkflowDeliverableRecord } from '../../workflow-deliverable-service.js';
import type { WorkflowInputPacketRecord } from '../../workflow-input-packet-service.js';

import {
  asRecord,
  humanizeToken,
  readOptionalString,
} from '../workflow-workspace/workflow-workspace-common.js';

export const CANONICAL_DELIVERABLE_PACKET_KIND = 'deliverable_packet';
export const ROLLUP_SOURCE_DESCRIPTOR_ID_KEY = 'rollup_source_descriptor_id';
export const ROLLUP_SOURCE_WORK_ITEM_ID_KEY = 'rollup_source_work_item_id';
export const SYNTHETIC_DERIVED_DELIVERABLE_PREFIXES = ['brief:', 'handoff:'] as const;

export function compareDeliverables(
  left: WorkflowDeliverableRecord,
  right: WorkflowDeliverableRecord,
): number {
  const leftTimestamp = left.updated_at ?? left.created_at;
  const rightTimestamp = right.updated_at ?? right.created_at;
  return rightTimestamp.localeCompare(leftTimestamp) || right.descriptor_id.localeCompare(left.descriptor_id);
}

export function buildDeliverableScopeKey(workItemId: string | null): string {
  return workItemId ?? '__workflow__';
}

export function isPacketLikeDeliverable(deliverable: WorkflowDeliverableRecord): boolean {
  const descriptorKind = readOptionalString(deliverable.descriptor_kind);
  return descriptorKind === 'handoff_packet'
    || descriptorKind === 'brief_packet'
    || descriptorKind === CANONICAL_DELIVERABLE_PACKET_KIND;
}

export function readRollupSourceDescriptorId(deliverable: WorkflowDeliverableRecord): string | null {
  return readOptionalString(asRecord(deliverable.content_preview)[ROLLUP_SOURCE_DESCRIPTOR_ID_KEY]);
}

export function readRollupSourceWorkItemId(deliverable: WorkflowDeliverableRecord): string | null {
  return readOptionalString(asRecord(deliverable.content_preview)[ROLLUP_SOURCE_WORK_ITEM_ID_KEY]);
}

export function readDeliverableTargetIdentityKey(
  deliverable: WorkflowDeliverableRecord,
): string | null {
  const target = asDeliverableIdentityTargetRecord(deliverable.primary_target);
  const targetKind = readOptionalString(target.target_kind);
  const targetUrl = readOptionalString(target.url);
  const targetPath = readOptionalString(target.path);
  const targetRepoRef = readOptionalString(target.repo_ref);
  const targetArtifactId = readOptionalString(target.artifact_id);

  if (!targetKind && !targetUrl && !targetPath && !targetRepoRef && !targetArtifactId) {
    return null;
  }

  return [
    targetKind ?? '',
    targetUrl ?? '',
    targetPath ?? '',
    targetRepoRef ?? '',
    targetArtifactId ?? '',
  ].join('|');
}

export function packetMatchesScope(
  packet: WorkflowInputPacketRecord,
  workItemId?: string,
): boolean {
  const packetWorkItemId = readOptionalString(packet.work_item_id);
  if (workItemId) {
    return packetWorkItemId === workItemId;
  }
  return packetWorkItemId === null;
}

export function humanizeRole(value: string): string {
  return humanizeToken(value);
}

function asDeliverableIdentityTargetRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}
