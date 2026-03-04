function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Explicit failure-mode contract for deterministic AP-7 impossible-scope runs.
 *
 * When this mode is set in task.context.failure_mode, workers must fail the task
 * deterministically before invoking any model/executor output path.
 */
export const DETERMINISTIC_IMPOSSIBLE_FAILURE_MODE = 'deterministic_impossible';

/**
 * Reads a normalized failure mode from task context if present.
 */
export function getTaskFailureMode(task: Record<string, unknown>): string | undefined {
  const context = asRecord(task.context);
  const mode = readString(context.failure_mode);
  return mode ? normalize(mode) : undefined;
}

/**
 * True when a task explicitly declares deterministic impossible failure mode.
 */
export function hasDeterministicImpossibleFailureMode(task: Record<string, unknown>): boolean {
  return getTaskFailureMode(task) === DETERMINISTIC_IMPOSSIBLE_FAILURE_MODE;
}

export function isImpossibleRewriteObjective(text: string): boolean {
  const normalized = normalize(text);
  if (!normalized) {
    return false;
  }

  const hasRust = /\brust\b/.test(normalized);
  const hasRewriteSignal = /\brewrite\b/.test(normalized);
  const hasNoJavaScriptSignal =
    /\bno\s+javascript\b/.test(normalized) || /\bwithout\s+javascript\b/.test(normalized);
  const hasWholeScopeSignal =
    /\bentire\b/.test(normalized) ||
    /\bwhole\b/.test(normalized) ||
    /\bapplication\b/.test(normalized);

  return hasRust && hasRewriteSignal && hasNoJavaScriptSignal && hasWholeScopeSignal;
}

/**
 * Detects objectives that are outside built-in live-lane scope and must fail
 * closed before executor dispatch.
 */
export function shouldRejectImpossibleScopeTask(task: Record<string, unknown>): boolean {
  if (hasDeterministicImpossibleFailureMode(task)) {
    return true;
  }

  const input = asRecord(task.input);
  const context = asRecord(task.context);

  const objectiveText = [
    readString(task.title),
    readString(input.goal),
    readString(input.instruction),
    readString(input.description),
    readString(context.goal),
    readString(context.instruction),
  ]
    .filter((value) => value.length > 0)
    .join(' ');

  return isImpossibleRewriteObjective(objectiveText);
}
