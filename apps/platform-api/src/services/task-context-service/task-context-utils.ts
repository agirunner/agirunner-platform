import { createHash } from 'node:crypto';

import { normalizeInstructionDocument } from '../platform-config/instruction-policy.js';
import { sanitizeSecretLikeValue } from '../secret-redaction.js';
import { TASK_CONTEXT_SECRET_REDACTION, UPSTREAM_OUTPUT_MAX_BYTES } from './task-context-constants.js';

export function sanitizeTaskContextValue(value: unknown): unknown {
  return sanitizeSecretLikeValue(value, {
    redactionValue: TASK_CONTEXT_SECRET_REDACTION,
    allowSecretReferences: false,
  });
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

export function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function readWorkflowIdArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    : [];
}

export function toWorkflowRelationRef(workflowId: string, row?: Record<string, unknown>) {
  return {
    workflow_id: workflowId,
    name: asOptionalString(row?.name) ?? null,
    state: asOptionalString(row?.state) ?? 'unknown',
    playbook_id: asOptionalString(row?.playbook_id) ?? null,
    playbook_name: asOptionalString(row?.playbook_name) ?? null,
    created_at: row?.created_at ?? null,
    started_at: row?.started_at ?? null,
    completed_at: row?.completed_at ?? null,
    is_terminal: ['completed', 'failed', 'cancelled'].includes(asOptionalString(row?.state) ?? ''),
    link: `/workflows/${workflowId}`,
  };
}

export function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function readPositiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

export function formatDateValue(value: unknown): string | null {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }
  return null;
}

export function readSuppressedLayers(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }
  return Array.isArray((value as Record<string, unknown>).suppress_layers)
    ? ((value as Record<string, unknown>).suppress_layers as unknown[]).filter(
      (entry): entry is string => typeof entry === 'string',
    )
    : [];
}

export function readAgentProfileInstructions(value: unknown): string {
  const metadata = asRecord(value);
  const profile = asRecord(metadata.profile);
  if (typeof profile.instructions === 'string' && profile.instructions.trim().length > 0) {
    return profile.instructions;
  }
  if (typeof metadata.instructions === 'string' && metadata.instructions.trim().length > 0) {
    return metadata.instructions;
  }
  return '';
}

export function readFlatInstructions(roleConfig: Record<string, unknown>, agentMetadata: unknown): string {
  const roleInstructions = normalizeInstructionDocument(
    roleConfig.system_prompt ?? roleConfig.instructions,
    'role instructions',
  );
  return roleInstructions?.content ?? readAgentProfileInstructions(agentMetadata);
}

export function hashCanonicalJson(value: unknown): string {
  return createHash('sha256').update(stableJsonStringify(value)).digest('hex');
}

export function stableJsonStringify(value: unknown): string {
  return JSON.stringify(normalizeForStableStringify(value));
}

export function truncateOutput(output: unknown): unknown {
  const serialized = JSON.stringify(output);
  if (serialized.length <= UPSTREAM_OUTPUT_MAX_BYTES) {
    return output;
  }
  return {
    _truncated: true,
    _original_size: serialized.length,
    summary: serialized.slice(0, UPSTREAM_OUTPUT_MAX_BYTES),
  };
}

function normalizeForStableStringify(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeForStableStringify(entry));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left.localeCompare(right),
  );

  const normalized: Record<string, unknown> = {};
  for (const [key, entry] of entries) {
    if (entry === undefined) {
      continue;
    }
    normalized[key] = normalizeForStableStringify(entry);
  }
  return normalized;
}
