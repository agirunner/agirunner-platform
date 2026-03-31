import { ValidationError } from '../../errors/domain-errors.js';

export function sanitizeOptionalText(value?: string): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function sanitizeRequiredText(value: string, errorMessage: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ValidationError(errorMessage);
  }
  return trimmed;
}

export function sanitizeOptionalBody(value?: string): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function deriveSessionTitle(request: string): string {
  return deriveMessageHeadline(request);
}

export function deriveMessageHeadline(request: string): string {
  const trimmed = sanitizeRequiredText(request, 'Steering request is required');
  return trimmed.length <= 255 ? trimmed : `${trimmed.slice(0, 252)}...`;
}

export function deriveMessageBody(request: string): string | undefined {
  const trimmed = sanitizeRequiredText(request, 'Steering request is required');
  return trimmed.length > 255 ? trimmed : undefined;
}

export function firstArrayValue(values?: string[]): string | undefined {
  return dedupeNonEmptyStrings(values)[0];
}

export function dedupeNonEmptyStrings(values?: string[]): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

export function toOptionalString(value: string | null): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
