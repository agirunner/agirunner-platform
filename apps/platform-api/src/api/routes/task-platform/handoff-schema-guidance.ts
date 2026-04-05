import { z } from 'zod';

import { SchemaValidationFailedError, ValidationError } from '../../../errors/domain-errors.js';
import { logSafetynetTriggered } from '../../../services/safetynet/logging.js';
import {
  PLATFORM_HANDOFF_SCHEMA_GUIDANCE_ID,
  mustGetSafetynetEntry,
} from '../../../services/safetynet/registry.js';

const HANDOFF_SCHEMA_GUIDANCE_SAFETYNET = mustGetSafetynetEntry(
  PLATFORM_HANDOFF_SCHEMA_GUIDANCE_ID,
);

const structuredFieldGuidance = {
  role_data:
    'role_data must be an object when provided. Omit it or send native JSON, not a quoted JSON string.',
  completion_callouts:
    'completion_callouts must be an object when provided. Omit it or send native JSON, not a quoted JSON string.',
  recommended_next_actions:
    'recommended_next_actions must be an array of objects. Do not quote the JSON or use freeform string entries.',
  waived_steps:
    'waived_steps must be an array of objects. Do not quote the JSON or use freeform string entries.',
} satisfies Record<string, string>;

type StructuredField = keyof typeof structuredFieldGuidance;

const conciseFieldGuidance = {
  summary:
    'summary must stay concise. Do not paste a full document into the handoff summary; persist the long-form content separately and cite it from artifacts, logical paths, or other structured references.',
  successor_context:
    'successor_context must stay concise. Use it for short takeover guidance, not a full document body.',
  focus_areas:
    'Each focus_areas entry must stay concise. Use short inspection pointers, not paragraph-length content.',
  known_risks:
    'Each known_risks entry must stay concise. Use short risk statements, not long-form writeups.',
} satisfies Record<string, string>;

type ConciseField = keyof typeof conciseFieldGuidance;

export function parseTaskHandoffBodyOrThrow<T>(
  result: z.SafeParseReturnType<unknown, T>,
  taskId?: string,
  workflowId?: string,
): T {
  if (result.success) {
    return result.data;
  }

  const issues = result.error.flatten();
  const fields = invalidStructuredHandoffFields(issues.fieldErrors);
  if (fields.length > 0) {
    const message = [
      'submit_handoff structured fields must use native JSON objects or arrays, not quoted JSON strings.',
      ...fields.map((field) => structuredFieldGuidance[field]),
    ].join(' ');

    logSafetynetTriggered(
      HANDOFF_SCHEMA_GUIDANCE_SAFETYNET,
      'submit_handoff used known structured fields with invalid nested JSON shape and platform returned recoverable guidance',
      {
        task_id: taskId,
        workflow_id: workflowId,
        reason_code: 'submit_handoff_invalid_nested_shape',
        invalid_fields: fields,
      },
    );

    throw new ValidationError(message, {
      issues,
      recoverable: true,
      reason_code: 'submit_handoff_invalid_nested_shape',
      recovery_hint: 'resubmit_handoff_with_native_json',
      safetynet_behavior_id: HANDOFF_SCHEMA_GUIDANCE_SAFETYNET.id,
      invalid_fields: fields,
      recovery: {
        status: 'action_required',
        reason: 'submit_handoff_invalid_nested_shape',
        action: 'resubmit_handoff_with_native_json',
      },
    });
  }

  const conciseFields = oversizedConciseHandoffFields(issues.fieldErrors);
  if (conciseFields.length > 0) {
    const message = [
      'submit_handoff concise text fields must stay concise and point to long-form content instead of embedding it inline.',
      ...conciseFields.map((field) => conciseFieldGuidance[field]),
    ].join(' ');

    logSafetynetTriggered(
      HANDOFF_SCHEMA_GUIDANCE_SAFETYNET,
      'submit_handoff used known concise fields as long-form document bodies and platform returned recoverable guidance',
      {
        task_id: taskId,
        workflow_id: workflowId,
        reason_code: 'submit_handoff_concise_text_required',
        invalid_fields: conciseFields,
      },
    );

    throw new ValidationError(message, {
      issues,
      recoverable: true,
      reason_code: 'submit_handoff_concise_text_required',
      recovery_hint: 'resubmit_handoff_with_concise_text_fields',
      safetynet_behavior_id: HANDOFF_SCHEMA_GUIDANCE_SAFETYNET.id,
      invalid_fields: conciseFields,
      recovery: {
        status: 'action_required',
        reason: 'submit_handoff_concise_text_required',
        action: 'resubmit_handoff_with_concise_text_fields',
      },
    });
  }

  throw new SchemaValidationFailedError('Invalid request body', { issues });
}

function invalidStructuredHandoffFields(
  fieldErrors: Record<string, string[]>,
): StructuredField[] {
  return (Object.keys(structuredFieldGuidance) as StructuredField[]).filter((field) =>
    indicatesStructuredShapeMismatch(fieldErrors[field]),
  );
}

function oversizedConciseHandoffFields(
  fieldErrors: Record<string, string[]>,
): ConciseField[] {
  return (Object.keys(conciseFieldGuidance) as ConciseField[]).filter((field) =>
    indicatesOversizedField(fieldErrors[field]),
  );
}

function indicatesStructuredShapeMismatch(messages: string[] | undefined): boolean {
  if (!Array.isArray(messages) || messages.length === 0) {
    return false;
  }
  return messages.some((message) => {
    const normalized = message.trim().toLowerCase();
    return normalized.includes('expected object, received')
      || normalized.includes('expected array, received');
  });
}

function indicatesOversizedField(messages: string[] | undefined): boolean {
  if (!Array.isArray(messages) || messages.length === 0) {
    return false;
  }
  return messages.some((message) => message.trim().toLowerCase().includes('at most'));
}
