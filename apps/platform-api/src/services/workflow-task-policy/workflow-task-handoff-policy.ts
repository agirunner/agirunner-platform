import { readWorkflowTaskKind } from './assessment-subject-service.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readPresentString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function taskRequiresStructuredHandoff(task: Record<string, unknown>) {
  return readPresentString(task.workflow_id) !== null;
}

export function taskAllowsHandoffResolution(task: Record<string, unknown>) {
  const metadata = isRecord(task.metadata) ? task.metadata : null;
  const isOrchestratorTask = task.is_orchestrator_task === true;
  const taskKind = readWorkflowTaskKind(metadata, isOrchestratorTask);
  return taskKind === 'assessment' || taskKind === 'approval';
}

export function taskHandoffSatisfiesCompletion(task: Record<string, unknown>) {
  return taskAllowsHandoffResolution(task);
}
