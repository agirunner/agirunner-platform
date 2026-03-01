/**
 * Rework Controller — FR-749
 *
 * Manages the rework lifecycle for the built-in worker. When output fails
 * schema validation (FR-748) or is rejected by a reviewer, the controller
 * appends feedback to the task context and re-queues the task for another
 * execution attempt — up to a configurable maximum.
 *
 * Design principles:
 *   - All limits come from config, never hardcoded.
 *   - Rework state is immutable per attempt — each attempt gets a full context snapshot.
 *   - Exhausted attempts result in permanent failure, not silent discard.
 */

export interface ReworkContext {
  /** Original task input provided by the pipeline. */
  originalInput: Record<string, unknown>;
  /** Feedback from the failed attempt (validation error or reviewer rejection). */
  feedback: string;
  /** Zero-indexed attempt number (0 = first rework, 1 = second, …). */
  attemptIndex: number;
}

export interface ReworkDecision {
  /** Whether another attempt should be made. */
  shouldRework: boolean;
  /** Prepared context for the next attempt (present only when shouldRework=true). */
  nextContext?: Record<string, unknown>;
  /** Human-readable reason for the decision. */
  reason: string;
}

/**
 * Decides whether a failed task output should trigger a rework attempt.
 *
 * FR-749: rework is triggered when:
 *   1. Output fails schema validation (FR-748), OR
 *   2. A reviewer explicitly rejects the output.
 *
 * Rework is denied when the attempt limit is reached — the task is then
 * permanently failed so the pipeline can escalate or terminate.
 *
 * @param attemptsSoFar  - Number of rework attempts already completed (0 on first failure).
 * @param maxAttempts    - Maximum rework attempts from config (FR-749: configurable).
 * @param feedback       - Reason for the failure / rejection.
 * @param currentContext - The task context from the failed attempt.
 */
export function decideRework(
  attemptsSoFar: number,
  maxAttempts: number,
  feedback: string,
  currentContext: Record<string, unknown>,
): ReworkDecision {
  if (attemptsSoFar >= maxAttempts) {
    return {
      shouldRework: false,
      reason: `Maximum rework attempts (${maxAttempts}) exhausted. Task permanently failed.`,
    };
  }

  const nextContext = buildReworkContext(currentContext, feedback, attemptsSoFar);

  return {
    shouldRework: true,
    nextContext,
    reason: `Rework attempt ${attemptsSoFar + 1} of ${maxAttempts} queued with feedback.`,
  };
}

/**
 * Builds the enriched context for the next rework attempt.
 *
 * Appends a structured rework history entry so the agent knows what failed
 * and can correct its approach. The original task context is preserved intact.
 */
export function buildReworkContext(
  previousContext: Record<string, unknown>,
  feedback: string,
  attemptIndex: number,
): Record<string, unknown> {
  const existingHistory = Array.isArray(previousContext['rework_history'])
    ? (previousContext['rework_history'] as ReworkHistoryEntry[])
    : [];

  const newEntry: ReworkHistoryEntry = {
    attempt: attemptIndex + 1,
    feedback,
    timestamp: new Date().toISOString(),
  };

  return {
    ...previousContext,
    rework_attempt: attemptIndex + 1,
    rework_history: [...existingHistory, newEntry],
    rework_instruction:
      'Your previous output was rejected. Review the rework_history feedback and produce a corrected output that satisfies all requirements.',
  };
}

/**
 * Extracts the current rework attempt count from a task context.
 * Returns 0 if no rework has occurred yet.
 */
export function extractReworkAttemptCount(context: Record<string, unknown>): number {
  const value = context['rework_attempt'];
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return value;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface ReworkHistoryEntry {
  attempt: number;
  feedback: string;
  timestamp: string;
}
