import { FIELD_DEFINITIONS } from './runtime-defaults.schema.js';
import type { FieldDefinition, FormValues } from './runtime-defaults.types.js';
import {
  validateContainerCpu,
  validateContainerImage,
  validateContainerMemory,
} from '../../lib/container-resources.validation.js';

export function buildValidationErrors(
  values: FormValues,
  fieldDefinitions: FieldDefinition[] = FIELD_DEFINITIONS,
): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const field of fieldDefinitions) {
    const value = values[field.key]?.trim();
    if (!value) {
      errors[field.key] = `${field.label} is required.`;
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
  validateContainerAllocation(values, errors, {
    imageKey: 'specialist_runtime_default_image',
    cpuKey: 'specialist_runtime_default_cpu',
    memoryKey: 'specialist_runtime_default_memory',
    labelPrefix: 'Specialist Agent',
  });
  validateContainerAllocation(values, errors, {
    imageKey: 'specialist_execution_default_image',
    cpuKey: 'specialist_execution_default_cpu',
    memoryKey: 'specialist_execution_default_memory',
    labelPrefix: 'Specialist Execution',
  });
}

function validateContainerAllocation(
  values: FormValues,
  errors: Record<string, string>,
  config: {
    imageKey: string;
    cpuKey: string;
    memoryKey: string;
    labelPrefix: string;
  },
): void {
  const imageValue = values[config.imageKey]?.trim();
  if (imageValue) {
    const imageError = validateContainerImage(imageValue, `${config.labelPrefix} image`);
    if (imageError) {
      errors[config.imageKey] = imageError;
    }
  }

  const cpuValue = values[config.cpuKey]?.trim();
  if (cpuValue) {
    const cpuError = validateContainerCpu(cpuValue, `${config.labelPrefix} CPU`);
    if (cpuError) {
      errors[config.cpuKey] = cpuError;
    }
  }

  const memoryValue = values[config.memoryKey]?.trim();
  if (memoryValue) {
    const memoryError = validateContainerMemory(memoryValue, `${config.labelPrefix} memory`);
    if (memoryError) {
      errors[config.memoryKey] = memoryError;
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
      'Agent reconnect maximum must be at least the minimum reconnect value.';
  }
}
