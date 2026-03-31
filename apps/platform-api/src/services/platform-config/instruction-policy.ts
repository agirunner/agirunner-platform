import { ValidationError } from '../errors/domain-errors.js';

export type InstructionFormat = 'text' | 'markdown';
export type InstructionLayerName = 'platform' | 'workspace' | 'playbook' | 'role' | 'task';

export interface InstructionDocument {
  content: string;
  format: InstructionFormat;
}

const TEMPLATE_DELIMITER_PATTERN = /{{|}}/;
const allowedFormats = new Set<InstructionFormat>(['text', 'markdown']);

export function normalizeInstructionDocument(
  value: unknown,
  fieldName: string,
): InstructionDocument | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === 'string') {
    return validateInstructionDocument({ content: value, format: 'text' }, fieldName);
  }

  if (Array.isArray(value)) {
    return normalizeInstructionArray(value, fieldName);
  }

  if (!value || typeof value !== 'object') {
    throw new ValidationError(`${fieldName} must be a string or object`);
  }

  const content = typeof (value as Record<string, unknown>).content === 'string'
    ? String((value as Record<string, unknown>).content)
    : '';
  const format = ((value as Record<string, unknown>).format ?? 'text') as InstructionFormat;
  return validateInstructionDocument({ content, format }, fieldName);
}

function normalizeInstructionArray(
  value: unknown[],
  fieldName: string,
): InstructionDocument | null {
  const entries = value.flatMap((entry) => {
    if (typeof entry !== 'string') {
      throw new ValidationError(`${fieldName} array entries must be strings`);
    }

    const trimmed = entry.trim();
    return trimmed.length > 0 ? [trimmed] : [];
  });

  if (entries.length === 0) {
    return null;
  }

  if (entries.length === 1) {
    return validateInstructionDocument({ content: entries[0], format: 'text' }, fieldName);
  }

  return validateInstructionDocument(
    {
      content: entries.map((entry) => `- ${entry}`).join('\n'),
      format: 'markdown',
    },
    fieldName,
  );
}

function validateInstructionDocument(
  value: InstructionDocument,
  fieldName: string,
): InstructionDocument | null {
  const content = value.content.trim();
  if (content.length === 0) {
    return null;
  }
  if (!allowedFormats.has(value.format)) {
    throw new ValidationError(`${fieldName} format must be text or markdown`);
  }
  if (TEMPLATE_DELIMITER_PATTERN.test(content)) {
    throw new ValidationError(`${fieldName} must not contain template delimiters`);
  }
  return { content, format: value.format };
}

export function normalizeSuppressedLayers(value: unknown): InstructionLayerName[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new ValidationError('instruction_config.suppress_layers must be an array');
  }

  const normalized = new Set<InstructionLayerName>();
  for (const entry of value) {
    if (
      entry === 'platform' ||
      entry === 'workspace' ||
      entry === 'playbook' ||
      entry === 'role' ||
      entry === 'task'
    ) {
      normalized.add(entry);
      continue;
    }
    throw new ValidationError(`Unsupported suppressed instruction layer '${String(entry)}'`);
  }

  return [...normalized];
}
