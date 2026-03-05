import type { PlatformApiClient } from '@agentbaton/sdk';
import { z } from 'zod';

const obj = <T extends z.ZodRawShape>(shape: T, required: (keyof T)[] = []) =>
  z
    .object(shape)
    .partial()
    .superRefine((value, ctx) => {
      required.forEach((key) => {
        if (value[key] === undefined) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: [String(key)], message: 'Required' });
        }
      });
    });

const CANONICAL_TOOL_DEFINITIONS = [
  { name: 'baton_list_tasks', description: 'List tasks with optional filters', inputSchema: { type: 'object', properties: { state: { type: 'string' }, type: { type: 'string' }, pipeline_id: { type: 'string' }, page: { type: 'number' }, per_page: { type: 'number' } } } },
  { name: 'baton_get_task', description: 'Get task by id', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'baton_create_task', description: 'Create a new task', inputSchema: { type: 'object', properties: { title: { type: 'string' }, type: { type: 'string' }, description: { type: 'string' }, input: { type: 'object' } }, required: ['title', 'type'] } },
  { name: 'baton_claim_task', description: 'Claim next task for an agent', inputSchema: { type: 'object', properties: { agent_id: { type: 'string' }, capabilities: { type: 'array', items: { type: 'string' } } }, required: ['agent_id'] } },
  { name: 'baton_complete_task', description: 'Complete a task', inputSchema: { type: 'object', properties: { id: { type: 'string' }, output: { type: 'object' } }, required: ['id'] } },
  { name: 'baton_list_pipelines', description: 'List pipelines', inputSchema: { type: 'object', properties: { state: { type: 'string' }, page: { type: 'number' }, per_page: { type: 'number' } } } },
  { name: 'baton_create_pipeline', description: 'Create pipeline from template', inputSchema: { type: 'object', properties: { template_id: { type: 'string' }, name: { type: 'string' }, project_id: { type: 'string' }, parameters: { type: 'object' } }, required: ['template_id', 'name'] } },
  { name: 'baton_cancel_pipeline', description: 'Cancel a pipeline', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
] as const;

const LEGACY_ALIASES: ReadonlyArray<{ alias: string; canonical: (typeof CANONICAL_TOOL_DEFINITIONS)[number]['name'] }> = [
  { alias: 'list_tasks', canonical: 'baton_list_tasks' },
  { alias: 'get_task', canonical: 'baton_get_task' },
  { alias: 'create_task', canonical: 'baton_create_task' },
  { alias: 'claim_task', canonical: 'baton_claim_task' },
  { alias: 'complete_task', canonical: 'baton_complete_task' },
  { alias: 'list_pipelines', canonical: 'baton_list_pipelines' },
  { alias: 'create_pipeline', canonical: 'baton_create_pipeline' },
  { alias: 'cancel_pipeline', canonical: 'baton_cancel_pipeline' },
];

export const TOOL_DEFINITIONS = [
  ...CANONICAL_TOOL_DEFINITIONS,
  ...LEGACY_ALIASES.map((alias) => {
    const target = CANONICAL_TOOL_DEFINITIONS.find((tool) => tool.name === alias.canonical)!;
    return {
      ...target,
      name: alias.alias,
      description: `${target.description} (deprecated alias; use ${alias.canonical})`,
    };
  }),
] as const;

export const TOOL_SCHEMAS = {
  baton_list_tasks: obj({ state: z.string().optional(), type: z.string().optional(), pipeline_id: z.string().optional(), page: z.number().optional(), per_page: z.number().optional() }),
  baton_get_task: obj({ id: z.string().optional() }, ['id']),
  baton_create_task: obj({ title: z.string().optional(), type: z.string().optional(), description: z.string().optional(), input: z.record(z.unknown()).optional() }, ['title', 'type']),
  baton_claim_task: obj({ agent_id: z.string().optional(), capabilities: z.array(z.string()).optional() }, ['agent_id']),
  baton_complete_task: obj({ id: z.string().optional(), output: z.record(z.unknown()).optional() }, ['id']),
  baton_list_pipelines: obj({ state: z.string().optional(), page: z.number().optional(), per_page: z.number().optional() }),
  baton_create_pipeline: obj({ template_id: z.string().optional(), name: z.string().optional(), project_id: z.string().optional(), parameters: z.record(z.unknown()).optional() }, ['template_id', 'name']),
  baton_cancel_pipeline: obj({ id: z.string().optional() }, ['id']),

  // Backward-compatible aliases.
  list_tasks: obj({ state: z.string().optional(), type: z.string().optional(), pipeline_id: z.string().optional(), page: z.number().optional(), per_page: z.number().optional() }),
  get_task: obj({ id: z.string().optional() }, ['id']),
  create_task: obj({ title: z.string().optional(), type: z.string().optional(), description: z.string().optional(), input: z.record(z.unknown()).optional() }, ['title', 'type']),
  claim_task: obj({ agent_id: z.string().optional(), capabilities: z.array(z.string()).optional() }, ['agent_id']),
  complete_task: obj({ id: z.string().optional(), output: z.record(z.unknown()).optional() }, ['id']),
  list_pipelines: obj({ state: z.string().optional(), page: z.number().optional(), per_page: z.number().optional() }),
  create_pipeline: obj({ template_id: z.string().optional(), name: z.string().optional(), project_id: z.string().optional(), parameters: z.record(z.unknown()).optional() }, ['template_id', 'name']),
  cancel_pipeline: obj({ id: z.string().optional() }, ['id']),
} as const;

export function createToolHandlers(client: PlatformApiClient) {
  const canonicalHandlers = {
    baton_list_tasks: (input: Record<string, unknown>) => client.listTasks(input as Record<string, string | number | boolean | undefined>),
    baton_get_task: (input: Record<string, unknown>) => client.getTask(String(input.id)),
    baton_create_task: (input: Record<string, unknown>) => client.createTask(input as never),
    baton_claim_task: (input: Record<string, unknown>) =>
      client.claimTask({
        agent_id: String(input.agent_id),
        capabilities: Array.isArray(input.capabilities) ? (input.capabilities as string[]) : [],
      }),
    baton_complete_task: (input: Record<string, unknown>) =>
      client.completeTask(String(input.id), input.output ?? {}),
    baton_list_pipelines: (input: Record<string, unknown>) =>
      client.listPipelines(input as Record<string, string | number | boolean | undefined>),
    baton_create_pipeline: (input: Record<string, unknown>) => client.createPipeline(input as never),
    baton_cancel_pipeline: (input: Record<string, unknown>) =>
      client.cancelPipeline(String(input.id)),
  } as const;

  const aliasHandlers = {
    list_tasks: canonicalHandlers.baton_list_tasks,
    get_task: canonicalHandlers.baton_get_task,
    create_task: canonicalHandlers.baton_create_task,
    claim_task: canonicalHandlers.baton_claim_task,
    complete_task: canonicalHandlers.baton_complete_task,
    list_pipelines: canonicalHandlers.baton_list_pipelines,
    create_pipeline: canonicalHandlers.baton_create_pipeline,
    cancel_pipeline: canonicalHandlers.baton_cancel_pipeline,
  };

  return {
    ...canonicalHandlers,
    ...aliasHandlers,
  };
}
