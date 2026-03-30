import { z } from 'zod';

import {
  completionCalloutsSchema,
  guidedClosureUnresolvedAdvisoryItemSchema,
  guidedClosureWaivedStepSchema,
} from '../../../services/guided-closure/types.js';

export const orchestratorTaskTypeSchema = z.enum([
  'analysis',
  'code',
  'assessment',
  'test',
  'docs',
  'custom',
]);

export const credentialRefsSchema = z.record(z.string().min(1).max(255)).refine(
  (record) => Object.values(record).every((value) => value.trim().startsWith('secret:')),
  { message: 'credentials must use secret: references' },
);

export const workItemCreateSchema = z.object({
  request_id: z.string().min(1).max(255),
  parent_work_item_id: z.string().uuid().optional(),
  stage_name: z.string().min(1).max(120),
  title: z.string().min(1).max(500),
  goal: z.string().min(1).max(4000),
  acceptance_criteria: z.string().min(1).max(4000),
  column_id: z.string().min(1).max(120).optional(),
  owner_role: z.string().max(120).optional(),
  priority: z.enum(['critical', 'high', 'normal', 'low']).optional(),
  notes: z.string().max(4000).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const workItemUpdateSchema = z.object({
  request_id: z.string().min(1).max(255),
  parent_work_item_id: z.string().uuid().nullable().optional(),
  title: z.string().min(1).max(500).optional(),
  goal: z.string().max(4000).optional(),
  acceptance_criteria: z.string().max(4000).optional(),
  stage_name: z.string().min(1).max(120).optional(),
  column_id: z.string().min(1).max(120).optional(),
  owner_role: z.string().max(120).nullable().optional(),
  priority: z.enum(['critical', 'high', 'normal', 'low']).optional(),
  notes: z.string().max(4000).nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const workItemCompleteSchema = z
  .object({
    request_id: z.string().min(1).max(255),
    completion_callouts: completionCalloutsSchema.optional(),
    waived_steps: z.array(guidedClosureWaivedStepSchema).max(100).optional(),
    unresolved_advisory_items: z.array(guidedClosureUnresolvedAdvisoryItemSchema).max(100).optional(),
    completion_notes: z.string().min(1).max(4000).nullable().optional(),
  })
  .strict();

export const orchestratorTaskCreateSchema = z
  .object({
    request_id: z.string().min(1).max(255),
    title: z.string().min(1).max(500),
    description: z.string().min(1).max(5000),
    work_item_id: z.string().uuid(),
    stage_name: z.string().min(1).max(120),
    role: z.string().min(1).max(120),
    subject_task_id: z.string().uuid().optional(),
    subject_work_item_id: z.string().uuid().optional(),
    subject_handoff_id: z.string().uuid().optional(),
    subject_revision: z.number().int().positive().optional(),
    type: orchestratorTaskTypeSchema.optional(),
    priority: z.enum(['critical', 'high', 'normal', 'low']).optional(),
    input: z.record(z.unknown()).optional(),
    context: z.record(z.unknown()).optional(),
    depends_on: z.array(z.string().uuid()).optional(),
    credentials: credentialRefsSchema.optional(),
    assessment_prompt: z.string().max(2000).optional(),
    role_config: z.record(z.unknown()).optional(),
    environment: z.record(z.unknown()).optional(),
    resource_bindings: z.array(z.unknown()).optional(),
    timeout_minutes: z.number().int().min(1).max(240).optional(),
    token_budget: z.number().int().positive().optional(),
    cost_cap_usd: z.number().positive().optional(),
    auto_retry: z.boolean().optional(),
    max_retries: z.number().int().min(0).max(10).optional(),
    max_iterations: z.number().int().min(1).optional(),
    llm_max_retries: z.number().int().min(1).optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

export const orchestratorTaskInputUpdateSchema = z.object({
  request_id: z.string().min(1).max(255),
  input: z.record(z.unknown()),
});

export const orchestratorTaskMutationSchema = z.object({
  request_id: z.string().min(1).max(255),
});

export const orchestratorTaskRetrySchema = orchestratorTaskMutationSchema.extend({
  override_input: z.record(z.unknown()).optional(),
  force: z.boolean().optional(),
});

export const rerunTaskWithCorrectedBriefSchema = z
  .object({
    request_id: z.string().min(1).max(255),
    corrected_input: z.record(z.unknown()),
  })
  .strict();

export const orchestratorTaskReworkSchema = orchestratorTaskMutationSchema.extend({
  feedback: z.string().min(1).max(4000),
  override_input: z.record(z.unknown()).optional(),
  preferred_agent_id: z.string().uuid().optional(),
  preferred_worker_id: z.string().uuid().optional(),
});

export const orchestratorTaskReassignSchema = orchestratorTaskMutationSchema.extend({
  preferred_agent_id: z.string().uuid().optional(),
  preferred_worker_id: z.string().uuid().optional(),
  reason: z.string().min(1).max(4000),
});

export const reattachOrReplaceStaleOwnerSchema = z
  .object({
    request_id: z.string().min(1).max(255),
    reason: z.string().min(1).max(4000),
    preferred_agent_id: z.string().uuid().optional(),
    preferred_worker_id: z.string().uuid().optional(),
  })
  .strict();

export const orchestratorTaskEscalateSchema = orchestratorTaskMutationSchema.extend({
  reason: z.string().min(1).max(4000),
  context: z.record(z.unknown()).optional(),
  recommendation: z.string().max(4000).optional(),
  blocking_task_id: z.string().uuid().optional(),
  urgency: z.enum(['info', 'important', 'critical']).optional(),
});

export const orchestratorTaskMessageSchema = orchestratorTaskMutationSchema.extend({
  message: z.string().min(1).max(4000),
  urgency: z.enum(['info', 'important', 'critical']).optional(),
});

export const gateRequestSchema = z.object({
  request_id: z.string().min(1).max(255),
  summary: z.string().min(1).max(4000),
  recommendation: z.string().max(4000).optional(),
  key_artifacts: z.array(z.record(z.unknown())).max(50).optional(),
  concerns: z.array(z.string().min(1).max(4000)).max(50).optional(),
});

export const stageAdvanceSchema = z.object({
  request_id: z.string().min(1).max(255),
  to_stage_name: z.string().min(1).max(120).optional(),
  summary: z.string().max(4000).optional(),
});

export const workflowCompleteSchema = z
  .object({
    request_id: z.string().min(1).max(255),
    summary: z.string().min(1).max(4000),
    final_artifacts: z.array(z.string().min(1).max(2000)).max(100).optional(),
    completion_callouts: completionCalloutsSchema.optional(),
    waived_steps: z.array(guidedClosureWaivedStepSchema).max(100).optional(),
    unresolved_advisory_items: z.array(guidedClosureUnresolvedAdvisoryItemSchema).max(100).optional(),
    completion_notes: z.string().min(1).max(4000).nullable().optional(),
  })
  .strict();

export const reopenWorkItemForMissingHandoffSchema = z
  .object({
    request_id: z.string().min(1).max(255),
    reason: z.string().min(1).max(4000),
  })
  .strict();

export const waivePreferredStepSchema = z
  .object({
    request_id: z.string().min(1).max(255),
    code: z.string().min(1).max(255),
    reason: z.string().min(1).max(4000),
    summary: z.string().min(1).max(4000).optional(),
    role: z.string().min(1).max(120).optional(),
  })
  .strict();

export const workspaceMemoryUpdatesSchema = z
  .record(z.string().min(1).max(256), z.unknown())
  .refine((value) => Object.keys(value).length > 0, {
    message: 'updates must contain at least one entry',
  });

export const workspaceMemoryWriteSchema = z.union([
  z.object({
    request_id: z.string().min(1).max(255),
    key: z.string().min(1).max(256),
    value: z.unknown(),
    work_item_id: z.string().uuid().optional(),
  }),
  z.object({
    request_id: z.string().min(1).max(255),
    updates: workspaceMemoryUpdatesSchema,
    work_item_id: z.string().uuid().optional(),
  }),
]);

export const childWorkflowCreateSchema = z.object({
  request_id: z.string().min(1).max(255),
  playbook_id: z.string().uuid(),
  name: z.string().min(1).max(255),
  parent_context: z.string().max(8000).optional(),
  parameters: z.record(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
  config_overrides: z.record(z.unknown()).optional(),
  instruction_config: z.record(z.unknown()).optional(),
});

export const orchestratorActivationCheckpointSchema = z
  .object({
    request_id: z.string().min(1).max(255),
    activation_checkpoint: z
      .object({
        activation_id: z.string().min(1).max(255).optional(),
        trigger: z.string().min(1).max(255).optional(),
        what_changed: z.array(z.string().min(1).max(4000)).max(100).optional(),
        current_working_state: z.string().min(1).max(4000).optional(),
        next_expected_event: z.string().min(1).max(255).optional(),
        important_ids: z.array(z.string().min(1).max(255)).max(100).optional(),
        important_artifacts: z.array(z.string().min(1).max(2000)).max(100).optional(),
        recent_memory_keys: z.array(z.string().min(1).max(256)).max(100).optional(),
      })
      .strict(),
  })
  .strict();

export const orchestratorActivationFinishSchema = z.object({
  request_id: z.string().min(1).max(255),
}).strict();

export const orchestratorContinuityWriteSchema = z
  .object({
    request_id: z.string().min(1).max(255),
    work_item_id: z.string().uuid().optional(),
    next_expected_actor: z.string().min(1).max(120).nullable().optional(),
    next_expected_action: z.string().min(1).max(4000).nullable().optional(),
    status_summary: z.string().min(1).max(4000).optional(),
    next_expected_event: z.string().min(1).max(255).optional(),
    blocked_on: z.array(z.string().min(1).max(4000)).max(50).optional(),
    active_subordinate_tasks: z.array(z.string().min(1).max(255)).max(100).optional(),
  })
  .strict();

export const workspaceMemoryDeleteQuerySchema = z.object({
  request_id: z.string().min(1).max(255),
});
