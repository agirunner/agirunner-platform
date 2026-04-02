import { z } from 'zod';

import { SchemaValidationFailedError, ValidationError } from '../../../errors/domain-errors.js';
import { logSafetynetTriggered } from '../../../services/safetynet/logging.js';
import {
  PLATFORM_OPERATOR_BRIEF_SCHEMA_GUIDANCE_ID,
  mustGetSafetynetEntry,
} from '../../../services/safetynet/registry.js';

const OPERATOR_BRIEF_SCHEMA_GUIDANCE_SAFETYNET = mustGetSafetynetEntry(
  PLATFORM_OPERATOR_BRIEF_SCHEMA_GUIDANCE_ID,
);

const linkedDeliverableGuidance =
  'record_operator_brief payload.linked_deliverables shorthand entries must include both label and path. If you only know the path, derive a short human-readable label and resend the same brief.';

export function parseWorkflowOperatorBriefBodyOrThrow<T>(
  result: z.SafeParseReturnType<unknown, T>,
  rawBody: unknown,
  workflowId?: string,
): T {
  if (result.success) {
    return result.data;
  }

  const issues = result.error.flatten();
  if (!hasInvalidShorthandLinkedDeliverable(rawBody)) {
    throw new SchemaValidationFailedError('Invalid request body', { issues });
  }

  logSafetynetTriggered(
    OPERATOR_BRIEF_SCHEMA_GUIDANCE_SAFETYNET,
    'record_operator_brief used shorthand linked deliverables without the required label/path pair and platform returned recoverable guidance',
    {
      workflow_id: workflowId,
      reason_code: 'record_operator_brief_invalid_linked_deliverable_shorthand',
      invalid_fields: ['payload.linked_deliverables'],
    },
  );

  throw new ValidationError(linkedDeliverableGuidance, {
    issues,
    recoverable: true,
    reason_code: 'record_operator_brief_invalid_linked_deliverable_shorthand',
    recovery_hint: 'resubmit_operator_brief_with_deliverable_label',
    safetynet_behavior_id: OPERATOR_BRIEF_SCHEMA_GUIDANCE_SAFETYNET.id,
    invalid_fields: ['payload.linked_deliverables'],
    recovery: {
      status: 'action_required',
      reason: 'record_operator_brief_invalid_linked_deliverable_shorthand',
      action: 'record_operator_brief',
    },
  });
}

function hasInvalidShorthandLinkedDeliverable(rawBody: unknown): boolean {
  if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
    return false;
  }
  const payload = (rawBody as Record<string, unknown>).payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return false;
  }
  const linkedDeliverables = (payload as Record<string, unknown>).linked_deliverables;
  if (!Array.isArray(linkedDeliverables)) {
    return false;
  }

  return linkedDeliverables.some((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return false;
    }
    const record = entry as Record<string, unknown>;
    const hasPath = typeof record.path === 'string' && record.path.trim().length > 0;
    const hasLabel = typeof record.label === 'string' && record.label.trim().length > 0;
    return hasPath != hasLabel;
  });
}
