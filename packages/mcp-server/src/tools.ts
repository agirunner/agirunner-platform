import type { PlatformApiClient } from '@agirunner/sdk';
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
  {
    name: 'agirunner_list_tasks',
    description: 'List tasks with optional filters',
    inputSchema: {
      type: 'object',
      properties: {
        state: { type: 'string' },
        type: { type: 'string' },
        workflow_id: { type: 'string' },
        page: { type: 'number' },
        per_page: { type: 'number' },
      },
    },
  },
  {
    name: 'agirunner_get_task',
    description: 'Get task by id',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'agirunner_create_task',
    description: 'Create a new task',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        type: { type: 'string' },
        description: { type: 'string' },
        input: { type: 'object' },
      },
      required: ['title', 'type'],
    },
  },
  {
    name: 'agirunner_claim_task',
    description: 'Claim next task for an agent',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string' },
        capabilities: { type: 'array', items: { type: 'string' } },
      },
      required: ['agent_id'],
    },
  },
  {
    name: 'agirunner_complete_task',
    description: 'Complete a task',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, output: { type: 'object' } },
      required: ['id'],
    },
  },
  {
    name: 'agirunner_list_workflows',
    description: 'List workflows',
    inputSchema: {
      type: 'object',
      properties: {
        state: { type: 'string' },
        page: { type: 'number' },
        per_page: { type: 'number' },
      },
    },
  },
  {
    name: 'agirunner_get_workflow',
    description: 'Get workflow by id',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'agirunner_create_workflow',
    description: 'Create workflow from a playbook',
    inputSchema: {
      type: 'object',
      properties: {
        playbook_id: { type: 'string' },
        name: { type: 'string' },
        project_id: { type: 'string' },
        parameters: { type: 'object' },
        metadata: { type: 'object' },
        config_overrides: { type: 'object' },
        instruction_config: { type: 'object' },
      },
      required: ['playbook_id', 'name'],
    },
  },
  {
    name: 'agirunner_cancel_workflow',
    description: 'Cancel a workflow',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'agirunner_get_workflow_board',
    description: 'Get the v2 workflow board view',
    inputSchema: {
      type: 'object',
      properties: { workflow_id: { type: 'string' } },
      required: ['workflow_id'],
    },
  },
  {
    name: 'agirunner_list_workflow_stages',
    description: 'List workflow stages',
    inputSchema: {
      type: 'object',
      properties: { workflow_id: { type: 'string' } },
      required: ['workflow_id'],
    },
  },
  {
    name: 'agirunner_list_workflow_work_items',
    description: 'List workflow work items',
    inputSchema: {
      type: 'object',
      properties: { workflow_id: { type: 'string' } },
      required: ['workflow_id'],
    },
  },
  {
    name: 'agirunner_get_workflow_work_item',
    description: 'Get a workflow work item',
    inputSchema: {
      type: 'object',
      properties: {
        workflow_id: { type: 'string' },
        work_item_id: { type: 'string' },
      },
      required: ['workflow_id', 'work_item_id'],
    },
  },
  {
    name: 'agirunner_list_workflow_activations',
    description: 'List workflow activations',
    inputSchema: {
      type: 'object',
      properties: { workflow_id: { type: 'string' } },
      required: ['workflow_id'],
    },
  },
  {
    name: 'agirunner_create_workflow_work_item',
    description: 'Create a workflow work item',
    inputSchema: {
      type: 'object',
      properties: {
        workflow_id: { type: 'string' },
        title: { type: 'string' },
        stage_name: { type: 'string' },
        goal: { type: 'string' },
        acceptance_criteria: { type: 'string' },
        column_id: { type: 'string' },
        owner_role: { type: 'string' },
        priority: { type: 'string' },
        notes: { type: 'string' },
        metadata: { type: 'object' },
      },
      required: ['workflow_id', 'title'],
    },
  },
  {
    name: 'agirunner_update_workflow_work_item',
    description: 'Update a workflow work item',
    inputSchema: {
      type: 'object',
      properties: {
        workflow_id: { type: 'string' },
        work_item_id: { type: 'string' },
        title: { type: 'string' },
        stage_name: { type: 'string' },
        goal: { type: 'string' },
        acceptance_criteria: { type: 'string' },
        column_id: { type: 'string' },
        owner_role: { type: 'string' },
        priority: { type: 'string' },
        notes: { type: 'string' },
        metadata: { type: 'object' },
      },
      required: ['workflow_id', 'work_item_id'],
    },
  },
  {
    name: 'agirunner_list_playbooks',
    description: 'List playbooks',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'agirunner_get_playbook',
    description: 'Get playbook by id',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'agirunner_create_playbook',
    description: 'Create a playbook',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        slug: { type: 'string' },
        description: { type: 'string' },
        outcome: { type: 'string' },
        lifecycle: { type: 'string' },
        definition: { type: 'object' },
      },
      required: ['name', 'outcome', 'definition'],
    },
  },
  {
    name: 'agirunner_get_approval_queue',
    description: 'List pending task approvals and stage gates',
    inputSchema: { type: 'object', properties: {} },
  },
] as const;

type CanonicalToolName = (typeof CANONICAL_TOOL_DEFINITIONS)[number]['name'];
type CompatibilityAlias = {
  alias: string;
  canonical: CanonicalToolName;
};
type ToolHandler = (input: Record<string, unknown>) => Promise<unknown>;

const COMPATIBILITY_ALIASES = [
  { alias: 'list_tasks', canonical: 'agirunner_list_tasks' },
  { alias: 'get_task', canonical: 'agirunner_get_task' },
  { alias: 'create_task', canonical: 'agirunner_create_task' },
  { alias: 'claim_task', canonical: 'agirunner_claim_task' },
  { alias: 'complete_task', canonical: 'agirunner_complete_task' },
  { alias: 'list_workflows', canonical: 'agirunner_list_workflows' },
  { alias: 'get_workflow', canonical: 'agirunner_get_workflow' },
  { alias: 'create_workflow', canonical: 'agirunner_create_workflow' },
  { alias: 'cancel_workflow', canonical: 'agirunner_cancel_workflow' },
  { alias: 'get_workflow_board', canonical: 'agirunner_get_workflow_board' },
  { alias: 'list_workflow_stages', canonical: 'agirunner_list_workflow_stages' },
  { alias: 'list_workflow_work_items', canonical: 'agirunner_list_workflow_work_items' },
  { alias: 'get_workflow_work_item', canonical: 'agirunner_get_workflow_work_item' },
  { alias: 'list_workflow_activations', canonical: 'agirunner_list_workflow_activations' },
  { alias: 'create_workflow_work_item', canonical: 'agirunner_create_workflow_work_item' },
  { alias: 'update_workflow_work_item', canonical: 'agirunner_update_workflow_work_item' },
  { alias: 'list_playbooks', canonical: 'agirunner_list_playbooks' },
  { alias: 'get_playbook', canonical: 'agirunner_get_playbook' },
  { alias: 'create_playbook', canonical: 'agirunner_create_playbook' },
  { alias: 'get_approval_queue', canonical: 'agirunner_get_approval_queue' },
] as const satisfies readonly CompatibilityAlias[];

type CompatibilityAliasName = (typeof COMPATIBILITY_ALIASES)[number]['alias'];

const CANONICAL_TOOL_SCHEMAS = {
  agirunner_list_tasks: obj({
    state: z.string().optional(),
    type: z.string().optional(),
    workflow_id: z.string().optional(),
    page: z.number().optional(),
    per_page: z.number().optional(),
  }),
  agirunner_get_task: obj({ id: z.string().optional() }, ['id']),
  agirunner_create_task: obj(
    {
      title: z.string().optional(),
      type: z.string().optional(),
      description: z.string().optional(),
      input: z.record(z.unknown()).optional(),
    },
    ['title', 'type'],
  ),
  agirunner_claim_task: obj(
    { agent_id: z.string().optional(), capabilities: z.array(z.string()).optional() },
    ['agent_id'],
  ),
  agirunner_complete_task: obj(
    { id: z.string().optional(), output: z.record(z.unknown()).optional() },
    ['id'],
  ),
  agirunner_list_workflows: obj({
    state: z.string().optional(),
    page: z.number().optional(),
    per_page: z.number().optional(),
  }),
  agirunner_get_workflow: obj({ id: z.string().optional() }, ['id']),
  agirunner_create_workflow: obj(
    {
      playbook_id: z.string().optional(),
      name: z.string().optional(),
      project_id: z.string().optional(),
      parameters: z.record(z.unknown()).optional(),
      metadata: z.record(z.unknown()).optional(),
      config_overrides: z.record(z.unknown()).optional(),
      instruction_config: z.record(z.unknown()).optional(),
    },
    ['playbook_id', 'name'],
  ),
  agirunner_cancel_workflow: obj({ id: z.string().optional() }, ['id']),
  agirunner_get_workflow_board: obj({ workflow_id: z.string().optional() }, ['workflow_id']),
  agirunner_list_workflow_stages: obj({ workflow_id: z.string().optional() }, ['workflow_id']),
  agirunner_list_workflow_work_items: obj({ workflow_id: z.string().optional() }, ['workflow_id']),
  agirunner_get_workflow_work_item: obj(
    {
      workflow_id: z.string().optional(),
      work_item_id: z.string().optional(),
    },
    ['workflow_id', 'work_item_id'],
  ),
  agirunner_list_workflow_activations: obj({ workflow_id: z.string().optional() }, ['workflow_id']),
  agirunner_create_workflow_work_item: obj(
    {
      workflow_id: z.string().optional(),
      title: z.string().optional(),
      stage_name: z.string().optional(),
      goal: z.string().optional(),
      acceptance_criteria: z.string().optional(),
      column_id: z.string().optional(),
      owner_role: z.string().optional(),
      priority: z.string().optional(),
      notes: z.string().optional(),
      metadata: z.record(z.unknown()).optional(),
    },
    ['workflow_id', 'title'],
  ),
  agirunner_update_workflow_work_item: obj(
    {
      workflow_id: z.string().optional(),
      work_item_id: z.string().optional(),
      title: z.string().optional(),
      stage_name: z.string().optional(),
      goal: z.string().optional(),
      acceptance_criteria: z.string().optional(),
      column_id: z.string().optional(),
      owner_role: z.string().optional(),
      priority: z.string().optional(),
      notes: z.string().optional(),
      metadata: z.record(z.unknown()).optional(),
    },
    ['workflow_id', 'work_item_id'],
  ),
  agirunner_list_playbooks: obj({}),
  agirunner_get_playbook: obj({ id: z.string().optional() }, ['id']),
  agirunner_create_playbook: obj(
    {
      name: z.string().optional(),
      slug: z.string().optional(),
      description: z.string().optional(),
      outcome: z.string().optional(),
      lifecycle: z.enum(['planned', 'ongoing']).optional(),
      definition: z.record(z.unknown()).optional(),
    },
    ['name', 'outcome', 'definition'],
  ),
  agirunner_get_approval_queue: obj({}),
} satisfies Record<CanonicalToolName, z.ZodType<Record<string, unknown>>>;

export const TOOL_DEFINITIONS = [...CANONICAL_TOOL_DEFINITIONS] as const;

export const TOOL_SCHEMAS = {
  ...CANONICAL_TOOL_SCHEMAS,
  ...buildCompatibilitySchemaMap(),
} as const;

export function createToolHandlers(client: PlatformApiClient) {
  const canonicalHandlers = {
    agirunner_list_tasks: (input: Record<string, unknown>) =>
      client.listTasks(input as Record<string, string | number | boolean | undefined>),
    agirunner_get_task: (input: Record<string, unknown>) => client.getTask(String(input.id)),
    agirunner_create_task: (input: Record<string, unknown>) => client.createTask(input as never),
    agirunner_claim_task: (input: Record<string, unknown>) =>
      client.claimTask({
        agent_id: String(input.agent_id),
        capabilities: Array.isArray(input.capabilities) ? (input.capabilities as string[]) : [],
      }),
    agirunner_complete_task: (input: Record<string, unknown>) =>
      client.completeTask(String(input.id), input.output ?? {}),
    agirunner_list_workflows: (input: Record<string, unknown>) =>
      client.listWorkflows(input as Record<string, string | number | boolean | undefined>),
    agirunner_get_workflow: (input: Record<string, unknown>) =>
      client.getWorkflow(String(input.id)),
    agirunner_create_workflow: (input: Record<string, unknown>) =>
      client.createWorkflow(input as never),
    agirunner_cancel_workflow: (input: Record<string, unknown>) =>
      client.cancelWorkflow(String(input.id)),
    agirunner_get_workflow_board: (input: Record<string, unknown>) =>
      client.getWorkflowBoard(String(input.workflow_id)),
    agirunner_list_workflow_stages: (input: Record<string, unknown>) =>
      client.listWorkflowStages(String(input.workflow_id)),
    agirunner_list_workflow_work_items: (input: Record<string, unknown>) =>
      client.listWorkflowWorkItems(String(input.workflow_id)),
    agirunner_get_workflow_work_item: (input: Record<string, unknown>) =>
      client.getWorkflowWorkItem(String(input.workflow_id), String(input.work_item_id)),
    agirunner_list_workflow_activations: (input: Record<string, unknown>) =>
      client.listWorkflowActivations(String(input.workflow_id)),
    agirunner_create_workflow_work_item: (input: Record<string, unknown>) =>
      client.createWorkflowWorkItem(String(input.workflow_id), {
        title: String(input.title),
        stage_name: input.stage_name as string | undefined,
        goal: input.goal as string | undefined,
        acceptance_criteria: input.acceptance_criteria as string | undefined,
        column_id: input.column_id as string | undefined,
        owner_role: input.owner_role as string | undefined,
        priority: input.priority as 'critical' | 'high' | 'normal' | 'low' | undefined,
        notes: input.notes as string | undefined,
        metadata: input.metadata as Record<string, unknown> | undefined,
      }),
    agirunner_update_workflow_work_item: (input: Record<string, unknown>) =>
      client.updateWorkflowWorkItem(String(input.workflow_id), String(input.work_item_id), {
        title: input.title as string | undefined,
        stage_name: input.stage_name as string | undefined,
        goal: input.goal as string | undefined,
        acceptance_criteria: input.acceptance_criteria as string | undefined,
        column_id: input.column_id as string | undefined,
        owner_role: input.owner_role as string | null | undefined,
        priority: input.priority as 'critical' | 'high' | 'normal' | 'low' | undefined,
        notes: input.notes as string | null | undefined,
        metadata: input.metadata as Record<string, unknown> | undefined,
      }),
    agirunner_list_playbooks: () => client.listPlaybooks(),
    agirunner_get_playbook: (input: Record<string, unknown>) =>
      client.getPlaybook(String(input.id)),
    agirunner_create_playbook: (input: Record<string, unknown>) =>
      client.createPlaybook(input as never),
    agirunner_get_approval_queue: () => client.getApprovalQueue(),
  } satisfies Record<CanonicalToolName, ToolHandler>;

  const handlers: Record<string, ToolHandler> = { ...canonicalHandlers };
  COMPATIBILITY_ALIASES.forEach(({ alias, canonical }) => {
    handlers[alias] = canonicalHandlers[canonical];
  });

  return handlers as typeof canonicalHandlers & Record<CompatibilityAliasName, ToolHandler>;
}

function buildCompatibilitySchemaMap(): Record<
  CompatibilityAliasName,
  z.ZodType<Record<string, unknown>>
> {
  const schemas = {} as Record<CompatibilityAliasName, z.ZodType<Record<string, unknown>>>;
  COMPATIBILITY_ALIASES.forEach(({ alias, canonical }) => {
    schemas[alias] = CANONICAL_TOOL_SCHEMAS[canonical];
  });
  return schemas;
}
