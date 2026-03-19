import { FIELD_DEFINITIONS } from './runtime-defaults.schema.js';
import type { FormValues } from './runtime-defaults.types.js';

const MEMORY_ALLOCATION_PATTERN =
  /^\d+(?:\.\d+)?(?:b|k|m|g|t|p|e|kb|mb|gb|tb|pb|eb|ki|mi|gi|ti|pi|ei|kib|mib|gib|tib|pib|eib)?$/i;

export function buildValidationErrors(values: FormValues): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const field of FIELD_DEFINITIONS) {
    const value = values[field.key]?.trim();
    if (!value) {
      continue;
    }
    if (field.options && field.options.length > 0 && !field.options.includes(value)) {
      errors[field.key] = `${field.label} must be one of: ${field.options.join(', ')}.`;
      continue;
    }
    if (field.configType !== 'number') {
      continue;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      errors[field.key] = `${field.label} must be a number.`;
      continue;
    }
    if (field.inputMode === 'numeric' && !Number.isInteger(parsed)) {
      errors[field.key] = `${field.label} must be a whole number.`;
      continue;
    }
    if (field.min !== undefined && parsed < field.min) {
      errors[field.key] = `${field.label} must be at least ${field.min}.`;
      continue;
    }
    if (field.max !== undefined && parsed > field.max) {
      errors[field.key] = `${field.label} must be at most ${field.max}.`;
    }
  }

  validateContainerDefaults(values, errors);
  validateHistoryRelationships(values, errors);
  validateRealtimeTransportRanges(values, errors);
  return errors;
}

function validateHistoryRelationships(
  values: FormValues,
  errors: Record<string, string>,
): void {
  const historyBudget = readNumber(values['agent.history_max_messages']);
  const preserveSpecialist = readNumber(values['agent.history_preserve_recent']);
  const specialistTail = readNumber(values['agent.specialist_context_tail_messages']);
  const preserveOrchestrator = readNumber(values['agent.orchestrator_history_preserve_recent']);

  if (
    historyBudget !== null &&
    preserveSpecialist !== null &&
    preserveSpecialist > historyBudget
  ) {
    errors['agent.history_preserve_recent'] =
      'Preserved specialist history must stay within the overall history budget.';
  }
  if (historyBudget !== null && specialistTail !== null && specialistTail > historyBudget) {
    errors['agent.specialist_context_tail_messages'] =
      'Specialist preserved tail must stay within the overall history budget.';
  }
  if (
    historyBudget !== null &&
    preserveOrchestrator !== null &&
    preserveOrchestrator > historyBudget
  ) {
    errors['agent.orchestrator_history_preserve_recent'] =
      'Preserved orchestrator history must stay within the overall history budget.';
  }
}

function readNumber(value: string | undefined): number | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function validateContainerDefaults(
  values: FormValues,
  errors: Record<string, string>,
): void {
  const runtimeImage = values['default_runtime_image']?.trim();
  if (runtimeImage) {
    if (/\s/.test(runtimeImage) || runtimeImage.includes('://')) {
      errors['default_runtime_image'] =
        'Runtime image must look like image:tag or image@sha256:digest. Remove spaces or URL prefixes, or clear the field to use the platform default image.';
    }
  }

  const cpuValue = values['default_cpu']?.trim();
  if (cpuValue) {
    const parsed = Number(cpuValue);
    if (Number.isFinite(parsed) && parsed <= 0) {
      errors['default_cpu'] =
        'Default CPU allocation must be greater than 0. Use a positive value such as 1 or 0.5, or clear the field to use the platform default.';
    }
  }

  const memoryValue = values['default_memory']?.trim();
  if (memoryValue) {
    if (!MEMORY_ALLOCATION_PATTERN.test(memoryValue)) {
      errors['default_memory'] =
        'Default memory allocation must look like 512m, 2g, or 2Gi. Clear the field to use the platform default memory limit.';
      return;
    }
    const numeric = Number.parseFloat(memoryValue);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      errors['default_memory'] =
        'Default memory allocation must be greater than 0. Use a value such as 512m or 2Gi, or clear the field to use the platform default memory limit.';
    }
  }
}

function validateRealtimeTransportRanges(
  values: FormValues,
  errors: Record<string, string>,
): void {
  const minReconnect = readNumber(values['platform.worker_reconnect_min_ms']);
  const maxReconnect = readNumber(values['platform.worker_reconnect_max_ms']);

  if (minReconnect !== null && maxReconnect !== null && minReconnect > maxReconnect) {
    errors['platform.worker_reconnect_max_ms'] =
      'Worker reconnect maximum must be at least the minimum reconnect value.';
  }
}
