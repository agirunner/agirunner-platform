import { z } from 'zod';

export const closureEffectSchema = z.enum(['blocking', 'advisory']);

const calloutCodeSchema = z.string().min(1).max(255);
const calloutSummarySchema = z.string().min(1).max(4000);

export const guidedClosureWaivedStepSchema = z.object({
  code: calloutCodeSchema,
  summary: calloutSummarySchema.optional(),
  role: z.string().min(1).max(255).optional(),
  reason: z.string().min(1).max(4000),
}).strict();

export const guidedClosureResidualRiskSchema = z.object({
  code: calloutCodeSchema,
  summary: calloutSummarySchema,
  evidence_refs: z.array(z.string().min(1).max(255)).default([]),
}).strict();

export const guidedClosureUnmetExpectationSchema = z.object({
  code: calloutCodeSchema,
  summary: calloutSummarySchema,
}).strict();

export const guidedClosureUnresolvedAdvisoryItemSchema = z.object({
  kind: z.string().min(1).max(120),
  id: z.string().min(1).max(255),
  summary: calloutSummarySchema,
}).strict();

export const completionCalloutsSchema = z.object({
  residual_risks: z.array(guidedClosureResidualRiskSchema).default([]),
  unmet_preferred_expectations: z.array(guidedClosureUnmetExpectationSchema).default([]),
  waived_steps: z.array(guidedClosureWaivedStepSchema).default([]),
  unresolved_advisory_items: z.array(guidedClosureUnresolvedAdvisoryItemSchema).default([]),
  completion_notes: z.string().min(1).max(4000).nullable().default(null),
}).strict();

export type CompletionCallouts = z.infer<typeof completionCalloutsSchema>;

export const guidedClosureControlSummarySchema = z.object({
  kind: z.string().min(1).max(120),
  id: z.string().min(1).max(255),
  closure_effect: closureEffectSchema,
  summary: z.string().min(1).max(4000).optional(),
}).strict();

export const guidedClosureStateSnapshotSchema = z.object({
  workflow_id: z.string().min(1).max(255),
  work_item_id: z.string().min(1).max(255).nullable(),
  task_id: z.string().min(1).max(255).nullable(),
  current_stage: z.string().min(1).max(255).nullable(),
  active_blocking_controls: z.array(guidedClosureControlSummarySchema).default([]),
  active_advisory_controls: z.array(guidedClosureControlSummarySchema).default([]),
}).strict();

export const guidedClosureSuggestedActionSchema = z.object({
  action_code: z.string().min(1).max(255),
  target_type: z.string().min(1).max(120),
  target_id: z.string().min(1).max(255),
  why: z.string().min(1).max(4000),
  requires_orchestrator_judgment: z.boolean(),
}).strict();

export const guidedClosureSuggestedTargetIdsSchema = z.object({
  workflow_id: z.string().min(1).max(255),
  work_item_id: z.string().min(1).max(255).nullable().optional(),
  task_id: z.string().min(1).max(255).nullable().optional(),
}).strict();

export const guidedClosureCalloutRecommendationSchema = z.object({
  code: calloutCodeSchema,
  summary: calloutSummarySchema,
}).strict();

export const guidedClosurePreferredObligationSchema = z.object({
  code: calloutCodeSchema,
  status: z.enum(['unmet', 'in_progress', 'satisfied']),
  subject: z.string().min(1).max(255),
}).strict();

export const guidedClosureRecoveryOutcomeSummarySchema = z.object({
  recovery_class: z.string().min(1).max(255),
  suggested_next_actions: z.array(guidedClosureSuggestedActionSchema).default([]),
}).strict();

export const guidedClosureRecentFailureSchema = z.object({
  task_id: z.string().min(1).max(255),
  role: z.string().min(1).max(255).nullable().default(null),
  state: z.string().min(1).max(120),
  why: z.string().min(1).max(4000),
}).strict();

export const guidedClosureRetryWindowSchema = z.object({
  retry_available_at: z.string().min(1).max(255),
  backoff_seconds: z.number().int().nonnegative(),
}).strict();

export const guidedClosureContextSchema = z.object({
  workflow_can_close_now: z.boolean(),
  work_item_can_close_now: z.boolean(),
  active_blocking_controls: z.array(guidedClosureControlSummarySchema).default([]),
  active_advisory_controls: z.array(guidedClosureControlSummarySchema).default([]),
  preferred_obligations: z.array(guidedClosurePreferredObligationSchema).default([]),
  closure_readiness: z.enum(['blocked', 'not_ready', 'can_close_with_callouts', 'ready_to_close']),
  open_specialist_task_count: z.number().int().nonnegative().default(0),
  open_specialist_task_roles: z.array(z.string().min(1).max(255)).default([]),
  recent_recovery_outcomes: z.array(guidedClosureRecoveryOutcomeSummarySchema).default([]),
  attempt_count_by_work_item: z.record(z.number().int().nonnegative()).default({}),
  attempt_count_by_role: z.record(z.number().int().nonnegative()).default({}),
  recent_failures: z.array(guidedClosureRecentFailureSchema).default([]),
  last_retry_reason: z.string().min(1).max(4000).nullable().default(null),
  retry_window: guidedClosureRetryWindowSchema.nullable().default(null),
  reroute_candidates: z.array(z.string().min(1).max(255)).default([]),
}).strict();

export const guidedClosureAppliedMutationSchema = z.object({
  mutation_outcome: z.literal('applied'),
  result: z.record(z.unknown()),
}).strict();

export const guidedClosureRecoverableMutationSchema = z.object({
  mutation_outcome: z.literal('recoverable_not_applied'),
  recovery_class: z.string().min(1).max(255),
  blocking: z.boolean(),
  reason_code: z.string().min(1).max(255),
  state_snapshot: guidedClosureStateSnapshotSchema,
  suggested_next_actions: z.array(guidedClosureSuggestedActionSchema),
  suggested_target_ids: guidedClosureSuggestedTargetIdsSchema,
  callout_recommendations: z.array(guidedClosureCalloutRecommendationSchema),
  closure_still_possible: z.boolean(),
}).strict();

export const guidedClosureIntegrityBlockSchema = guidedClosureRecoverableMutationSchema.extend({
  mutation_outcome: z.literal('integrity_block'),
  blocking: z.literal(true),
}).strict();

export const guidedClosureMutationResponseSchema = z.union([
  guidedClosureAppliedMutationSchema,
  guidedClosureRecoverableMutationSchema,
  guidedClosureIntegrityBlockSchema,
]);

export type GuidedClosureMutationResponse = z.infer<typeof guidedClosureMutationResponseSchema>;
export type GuidedClosureStateSnapshot = z.infer<typeof guidedClosureStateSnapshotSchema>;
export type GuidedClosureSuggestedAction = z.infer<typeof guidedClosureSuggestedActionSchema>;
export type GuidedClosureCalloutRecommendation = z.infer<typeof guidedClosureCalloutRecommendationSchema>;
export type GuidedClosureContext = z.infer<typeof guidedClosureContextSchema>;

export function emptyCompletionCallouts(): CompletionCallouts {
  return completionCalloutsSchema.parse({});
}

function dedupeByJson<T>(entries: T[]): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];
  for (const entry of entries) {
    const key = JSON.stringify(entry);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(entry);
  }
  return deduped;
}

function normalizeOptionalCompletionNotes(value: unknown): string | null {
  if (value === undefined) {
    return null;
  }
  if (value === null) {
    return null;
  }
  const parsed = z.string().min(1).max(4000).parse(value);
  return parsed.trim();
}

export function normalizeCompletionCalloutsInput(input: {
  completion_callouts?: unknown;
  waived_steps?: unknown;
  unresolved_advisory_items?: unknown;
  completion_notes?: unknown;
}): CompletionCallouts {
  const base = completionCalloutsSchema.parse(input.completion_callouts ?? {});
  const explicitWaivedSteps = guidedClosureWaivedStepSchema.array().max(100).parse(
    Array.isArray(input.waived_steps) ? input.waived_steps : [],
  );
  const explicitUnresolved = guidedClosureUnresolvedAdvisoryItemSchema.array().max(100).parse(
    Array.isArray(input.unresolved_advisory_items) ? input.unresolved_advisory_items : [],
  );
  const explicitNotes = normalizeOptionalCompletionNotes(input.completion_notes);

  return completionCalloutsSchema.parse({
    ...base,
    waived_steps: explicitWaivedSteps.length > 0 ? explicitWaivedSteps : base.waived_steps,
    unresolved_advisory_items:
      explicitUnresolved.length > 0 ? explicitUnresolved : base.unresolved_advisory_items,
    completion_notes: input.completion_notes === undefined ? base.completion_notes : explicitNotes,
  });
}

export function mergeCompletionCallouts(...values: unknown[]): CompletionCallouts {
  const merged = values
    .filter((value) => value !== undefined && value !== null)
    .map((value) => completionCalloutsSchema.parse(value))
    .reduce<CompletionCallouts>(
      (accumulator, current) => ({
        residual_risks: dedupeByJson([...accumulator.residual_risks, ...current.residual_risks]),
        unmet_preferred_expectations: dedupeByJson([
          ...accumulator.unmet_preferred_expectations,
          ...current.unmet_preferred_expectations,
        ]),
        waived_steps: dedupeByJson([...accumulator.waived_steps, ...current.waived_steps]),
        unresolved_advisory_items: dedupeByJson([
          ...accumulator.unresolved_advisory_items,
          ...current.unresolved_advisory_items,
        ]),
        completion_notes: current.completion_notes ?? accumulator.completion_notes,
      }),
      emptyCompletionCallouts(),
    );
  return completionCalloutsSchema.parse(merged);
}

export function buildAppliedMutationResult<T extends Record<string, unknown>>(result: T) {
  return guidedClosureAppliedMutationSchema.parse({
    mutation_outcome: 'applied',
    result,
  });
}

interface BuildRecoverableMutationResultInput {
  recovery_class: string;
  blocking: boolean;
  reason_code: string;
  state_snapshot: GuidedClosureStateSnapshot;
  suggested_next_actions: GuidedClosureSuggestedAction[];
  suggested_target_ids: z.infer<typeof guidedClosureSuggestedTargetIdsSchema>;
  callout_recommendations: GuidedClosureCalloutRecommendation[];
  closure_still_possible: boolean;
}

export function buildRecoverableMutationResult(input: BuildRecoverableMutationResultInput) {
  return guidedClosureRecoverableMutationSchema.parse({
    mutation_outcome: 'recoverable_not_applied',
    ...input,
  });
}

export function readGuidedClosureMutationMetadata(response: Record<string, unknown>): {
  mutationOutcome: 'applied' | 'recoverable_not_applied' | 'integrity_block' | null;
  recoveryClass: string | null;
} {
  const mutationOutcome = response.mutation_outcome;
  if (
    mutationOutcome !== 'applied'
    && mutationOutcome !== 'recoverable_not_applied'
    && mutationOutcome !== 'integrity_block'
  ) {
    return { mutationOutcome: null, recoveryClass: null };
  }

  return {
    mutationOutcome,
    recoveryClass: typeof response.recovery_class === 'string' ? response.recovery_class : null,
  };
}
