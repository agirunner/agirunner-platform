import { ValidationError } from '../errors/domain-errors.js';
import { sanitizeSecretLikeRecord, sanitizeSecretLikeValue } from './secret-redaction.js';

const BRIEF_REDACTION = 'redacted://workflow-brief-secret';
const UPDATE_REDACTION = 'redacted://workflow-update-secret';
const DELIVERABLE_REDACTION = 'redacted://workflow-deliverable-secret';

const DETAIL_SECTION_KEYS = [
  'deliverables',
  'next_steps',
  'risks_and_callouts',
  'links',
  'scope_and_objective',
  'decisions_made',
  'validation',
  'open_questions',
  'operator_action',
  'approval_and_review_context',
  'inputs_used',
  'delta_since_last_brief',
] as const;

const DELIVERABLE_STATES = ['draft', 'under_review', 'approved', 'superseded', 'final'] as const;
const DELIVERABLE_STAGES = ['in_progress', 'final'] as const;
const LIVE_VISIBILITY_MODES = ['standard', 'enhanced'] as const;
const PREVIEW_KINDS = ['text', 'markdown', 'code', 'json', 'binary', 'structured_summary'] as const;

export type WorkflowLiveVisibilityMode = (typeof LIVE_VISIBILITY_MODES)[number];

export function sanitizeOperatorShortBrief(input: Record<string, unknown>) {
  const record = sanitizeSecretLikeRecord(input, {
    redactionValue: BRIEF_REDACTION,
    allowSecretReferences: false,
  });
  return {
    headline: sanitizeRequiredText(record.headline, 'Operator brief headline is required'),
    status_label: sanitizeOptionalText(record.status_label),
    delta_label: sanitizeOptionalText(record.delta_label),
    next_action_label: sanitizeOptionalText(record.next_action_label),
  };
}

export function sanitizeOperatorDetailedBrief(input: Record<string, unknown>) {
  const record = sanitizeSecretLikeRecord(input, {
    redactionValue: BRIEF_REDACTION,
    allowSecretReferences: false,
  });
  const sanitized: Record<string, unknown> = {
    headline: sanitizeRequiredText(record.headline, 'Operator detailed brief headline is required'),
    status_kind: sanitizeRequiredText(record.status_kind, 'Operator detailed brief status kind is required'),
  };
  const summary = sanitizeOptionalText(record.summary);
  if (summary) {
    sanitized.summary = summary;
  }
  const sections = sanitizeDetailSections(record.sections);
  if (Object.keys(sections).length > 0) {
    sanitized.sections = sections;
  }
  return sanitized;
}

export function sanitizeOperatorUpdateHeadline(value: unknown): string {
  return sanitizeRequiredText(
    sanitizeSecretLikeValue(value, {
      redactionValue: UPDATE_REDACTION,
      allowSecretReferences: false,
    }),
    'Operator update headline is required',
  );
}

export function sanitizeOperatorUpdateSummary(value: unknown): string | null {
  return sanitizeOptionalText(
    sanitizeSecretLikeValue(value, {
      redactionValue: UPDATE_REDACTION,
      allowSecretReferences: false,
    }),
  );
}

export function sanitizeLinkedIdList(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input
    .map((value) => sanitizeOptionalText(value))
    .filter((value): value is string => value !== null);
}

export function sanitizeWorkflowLiveVisibilityMode(value: unknown): WorkflowLiveVisibilityMode {
  return sanitizeEnumValue(
    value,
    LIVE_VISIBILITY_MODES,
    'Workflow live visibility mode must be "standard" or "enhanced"',
  );
}

export function sanitizeOptionalWorkflowLiveVisibilityMode(
  value: unknown,
): WorkflowLiveVisibilityMode | null {
  if (value === null || value === undefined) {
    return null;
  }
  return sanitizeWorkflowLiveVisibilityMode(value);
}

export function sanitizeDeliverableState(value: unknown): string {
  return sanitizeEnumValue(value, DELIVERABLE_STATES, 'Workflow deliverable state is invalid');
}

export function sanitizeDeliverableStage(value: unknown): string {
  return sanitizeEnumValue(value, DELIVERABLE_STAGES, 'Workflow deliverable stage is invalid');
}

export function sanitizeDeliverableSummary(value: unknown): string | null {
  return sanitizeOptionalText(
    sanitizeSecretLikeValue(value, {
      redactionValue: DELIVERABLE_REDACTION,
      allowSecretReferences: false,
    }),
  );
}

export function sanitizeDeliverablePreviewCapabilities(input: unknown): Record<string, unknown> {
  const record = sanitizeSecretLikeRecord(input, {
    redactionValue: DELIVERABLE_REDACTION,
    allowSecretReferences: false,
  });
  const sanitized: Record<string, unknown> = {
    can_inline_preview: Boolean(record.can_inline_preview),
    can_download: Boolean(record.can_download),
    can_open_external: Boolean(record.can_open_external),
    can_copy_path: Boolean(record.can_copy_path),
  };
  const previewKind = sanitizeOptionalText(record.preview_kind);
  if (previewKind && PREVIEW_KINDS.includes(previewKind as (typeof PREVIEW_KINDS)[number])) {
    sanitized.preview_kind = previewKind;
  }
  return sanitized;
}

export function sanitizeDeliverableTarget(
  input: unknown,
  required = true,
): Record<string, unknown> {
  const record = sanitizeSecretLikeRecord(input, {
    redactionValue: DELIVERABLE_REDACTION,
    allowSecretReferences: false,
  });
  if (!required && Object.keys(record).length === 0) {
    return {};
  }
  const targetKind = sanitizeRequiredText(record.target_kind, 'Workflow deliverable target kind is required');
  const sanitized: Record<string, unknown> = {
    target_kind: targetKind,
    label: sanitizeRequiredText(record.label, 'Workflow deliverable target label is required'),
  };
  const url = sanitizeOptionalText(record.url);
  if (url) {
    sanitized.url = url;
  } else if (targetKind !== 'inline_summary') {
    throw new ValidationError('Workflow deliverable target url is required');
  }
  const optionalKeys = ['path', 'repo_ref', 'artifact_id'] as const;
  for (const key of optionalKeys) {
    const value = sanitizeOptionalText(record[key]);
    if (value) {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

export function sanitizeDeliverableTargets(input: unknown): Record<string, unknown>[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input.map((value) => sanitizeDeliverableTarget(value));
}

export function sanitizeDeliverableContentPreview(input: unknown): Record<string, unknown> {
  return sanitizeSecretLikeRecord(input, {
    redactionValue: DELIVERABLE_REDACTION,
    allowSecretReferences: false,
  });
}

export function sanitizeOptionalText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function sanitizeRequiredText(value: unknown, message: string): string {
  const sanitized = sanitizeOptionalText(value);
  if (!sanitized) {
    throw new ValidationError(message);
  }
  return sanitized;
}

function sanitizeEnumValue<const Values extends readonly string[]>(
  value: unknown,
  allowedValues: Values,
  message: string,
): Values[number] {
  const sanitized = sanitizeRequiredText(value, message);
  if (!allowedValues.includes(sanitized as Values[number])) {
    throw new ValidationError(message);
  }
  return sanitized as Values[number];
}

function sanitizeDetailSections(input: unknown): Record<string, unknown[]> {
  const record = sanitizeSecretLikeRecord(input, {
    redactionValue: BRIEF_REDACTION,
    allowSecretReferences: false,
  });
  const sections: Record<string, unknown[]> = {};
  for (const key of DETAIL_SECTION_KEYS) {
    const items = sanitizeSectionItems(record[key]);
    if (items.length > 0) {
      sections[key] = items;
    }
  }
  return sections;
}

function sanitizeSectionItems(input: unknown): unknown[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input
    .map((value) =>
      sanitizeSecretLikeValue(value, {
        redactionValue: BRIEF_REDACTION,
        allowSecretReferences: false,
      }),
    )
    .filter((value) => {
      if (value === null || value === undefined) {
        return false;
      }
      if (typeof value === 'string') {
        return value.trim().length > 0;
      }
      if (Array.isArray(value)) {
        return value.length > 0;
      }
      if (typeof value === 'object') {
        return Object.keys(value as Record<string, unknown>).length > 0;
      }
      return true;
    });
}
