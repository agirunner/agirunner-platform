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

export const completionCalloutsSchema = z.object({
  residual_risks: z.array(
    z.object({
      code: calloutCodeSchema,
      summary: calloutSummarySchema,
      evidence_refs: z.array(z.string().min(1).max(255)).default([]),
    }).strict(),
  ).default([]),
  unmet_preferred_expectations: z.array(
    z.object({
      code: calloutCodeSchema,
      summary: calloutSummarySchema,
    }).strict(),
  ).default([]),
  waived_steps: z.array(guidedClosureWaivedStepSchema).default([]),
  unresolved_advisory_items: z.array(
    z.object({
      kind: z.string().min(1).max(120),
      id: z.string().min(1).max(255),
      summary: calloutSummarySchema,
    }).strict(),
  ).default([]),
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

export function emptyCompletionCallouts(): CompletionCallouts {
  return completionCalloutsSchema.parse({});
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
  const parsed = guidedClosureMutationResponseSchema.safeParse(response);
  if (!parsed.success) {
    return { mutationOutcome: null, recoveryClass: null };
  }

  return {
    mutationOutcome: parsed.data.mutation_outcome,
    recoveryClass:
      'recovery_class' in parsed.data ? parsed.data.recovery_class : null,
  };
}
