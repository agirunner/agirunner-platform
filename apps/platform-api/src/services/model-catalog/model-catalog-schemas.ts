import { z } from 'zod';

const createProviderSchema = z.object({
  name: z.string().min(1).max(100),
  baseUrl: z.string().url(),
  apiKeySecretRef: z.string().optional(),
  isEnabled: z.boolean().default(true),
  rateLimitRpm: z.number().int().positive().optional(),
  metadata: z.record(z.unknown()).default({}),
});

const updateProviderSchema = createProviderSchema.partial();

const reasoningConfigSchema = z.object({
  type: z.enum(['reasoning_effort', 'effort', 'thinking_level', 'thinking_budget']),
  options: z.array(z.string()).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  default: z.union([z.string(), z.number()]),
}).nullable().default(null);

const createModelSchema = z.object({
  providerId: z.string().uuid(),
  modelId: z.string().min(1).max(200),
  contextWindow: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  supportsToolUse: z.boolean().default(true),
  supportsVision: z.boolean().default(false),
  inputCostPerMillionUsd: z.number().nonnegative().optional(),
  outputCostPerMillionUsd: z.number().nonnegative().optional(),
  isEnabled: z.boolean().default(true),
  endpointType: z.string().optional(),
  reasoningConfig: reasoningConfigSchema,
});

const updateModelSchema = createModelSchema.partial().omit({ providerId: true });

export type CreateProviderInput = z.infer<typeof createProviderSchema>;
export type UpdateProviderInput = z.infer<typeof updateProviderSchema>;
export type CreateModelInput = z.infer<typeof createModelSchema>;
export type UpdateModelInput = z.infer<typeof updateModelSchema>;

export {
  createModelSchema,
  createProviderSchema,
  updateModelSchema,
  updateProviderSchema,
};
