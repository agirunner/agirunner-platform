import { z } from 'zod';

import { SchemaValidationFailedError } from '../../../errors/domain-errors.js';

export const taskCreateSchema = z.object({
  title: z.string().min(1).max(500),
  type: z.enum(['analysis', 'code', 'assessment', 'test', 'docs', 'orchestration', 'custom']),
  task_kind: z.enum(['delivery', 'assessment', 'approval', 'orchestrator']).optional(),
  description: z.string().max(5000).optional(),
  priority: z.enum(['critical', 'high', 'normal', 'low']).optional(),
  workflow_id: z.string().uuid().optional(),
  work_item_id: z.string().uuid().optional(),
  workspace_id: z.string().uuid().optional(),
  stage_name: z.string().max(120).optional(),
  activation_id: z.string().uuid().optional(),
  request_id: z.string().max(255).optional(),
  is_orchestrator_task: z.boolean().optional(),
  execution_backend: z.enum(['runtime_only', 'runtime_plus_task']).optional(),
  parent_id: z.string().uuid().optional(),
  role: z.string().max(120).optional(),
  subject_task_id: z.string().uuid().optional(),
  subject_work_item_id: z.string().uuid().optional(),
  subject_handoff_id: z.string().uuid().optional(),
  subject_revision: z.number().int().min(1).optional(),
  input: z.record(z.unknown()).optional(),
  context: z.record(z.unknown()).optional(),
  depends_on: z.array(z.string().uuid()).optional(),
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
  retry_policy: z.record(z.unknown()).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.is_orchestrator_task && value.execution_backend === 'runtime_plus_task') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['execution_backend'],
      message: 'orchestrator tasks must use execution_backend runtime_only',
    });
  }
  if (value.is_orchestrator_task === false && value.execution_backend === 'runtime_only') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['execution_backend'],
      message: 'specialist tasks must use execution_backend runtime_plus_task',
    });
  }
});

export const taskPatchSchema = z.object({
  request_id: z.string().min(1).max(255).optional(),
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(5000).optional(),
  priority: z.enum(['critical', 'high', 'normal', 'low']).optional(),
  timeout_minutes: z.number().int().min(1).max(240).optional(),
  metadata: z.record(z.unknown()).optional(),
  parent_id: z.string().uuid().optional(),
  state: z.never().optional(),
}).strict();

export const claimSchema = z.object({
  agent_id: z.string().uuid(),
  worker_id: z.string().uuid().optional(),
  routing_tags: z.array(z.string()).default([]),
  workflow_id: z.string().uuid().optional(),
  playbook_id: z.string().uuid().optional(),
  include_context: z.boolean().optional(),
}).strict();

export const claimCredentialResolveSchema = z.object({
  llm_api_key_claim_handle: z.string().min(1).optional(),
  llm_extra_headers_claim_handle: z.string().min(1).optional(),
  mcp_claim_handles: z.array(z.string().min(1)).min(1).optional(),
}).refine(
  (value) =>
    Boolean(
      value.llm_api_key_claim_handle
      || value.llm_extra_headers_claim_handle
      || value.mcp_claim_handles?.length,
    ),
  { message: 'At least one claim credential handle is required.' },
);

export const taskOperatorMutationSchema = z.object({
  request_id: z.string().min(1).max(255).optional(),
});

export const taskControlSchema = taskOperatorMutationSchema.extend({
  agent_id: z.string().uuid().optional(),
  worker_id: z.string().uuid().optional(),
  started_at: z.string().datetime().optional(),
});

export const completeSchema = taskOperatorMutationSchema.extend({
  output: z.any(),
  metrics: z.record(z.unknown()).optional(),
  git_info: z.record(z.unknown()).optional(),
  verification: z.record(z.unknown()).optional(),
  agent_id: z.string().uuid().optional(),
  worker_id: z.string().uuid().optional(),
});

export const failSchema = taskOperatorMutationSchema.extend({
  error: z.record(z.unknown()),
  metrics: z.record(z.unknown()).optional(),
  git_info: z.record(z.unknown()).optional(),
  agent_id: z.string().uuid().optional(),
  worker_id: z.string().uuid().optional(),
});

export const retrySchema = taskOperatorMutationSchema.extend({
  override_input: z.record(z.unknown()).optional(),
  force: z.boolean().optional(),
});

export const rejectSchema = taskOperatorMutationSchema.extend({
  feedback: z.string().min(1).max(4000),
});

export const requestChangesSchema = taskOperatorMutationSchema.extend({
  feedback: z.string().min(1).max(4000),
  override_input: z.record(z.unknown()).optional(),
  preferred_agent_id: z.string().uuid().optional(),
  preferred_worker_id: z.string().uuid().optional(),
});

export const skipSchema = taskOperatorMutationSchema.extend({
  reason: z.string().min(1).max(4000),
});

export const reassignSchema = taskOperatorMutationSchema.extend({
  preferred_agent_id: z.string().uuid().optional(),
  preferred_worker_id: z.string().uuid().optional(),
  reason: z.string().min(1).max(4000),
});

export const escalateSchema = taskOperatorMutationSchema.extend({
  reason: z.string().min(1).max(4000),
  escalation_target: z.string().max(255).optional(),
});

export const escalationResponseSchema = taskOperatorMutationSchema.extend({
  instructions: z.string().min(1).max(4000),
  context: z.record(z.unknown()).optional(),
});

export const agentEscalateSchema = taskOperatorMutationSchema.extend({
  reason: z.string().min(1).max(4000),
  context_summary: z.string().max(4000).optional(),
  work_so_far: z.string().max(8000).optional(),
});

export const resolveEscalationSchema = taskOperatorMutationSchema.extend({
  instructions: z.string().min(1).max(4000),
  context: z.record(z.unknown()).optional(),
});

export const overrideOutputSchema = taskOperatorMutationSchema.extend({
  output: z.unknown(),
  reason: z.string().min(1).max(4000),
});

export function parseOrThrow<T>(result: z.SafeParseReturnType<unknown, T>): T {
  if (result.success) {
    return result.data;
  }
  throw new SchemaValidationFailedError('Invalid request body', { issues: result.error.flatten() });
}
