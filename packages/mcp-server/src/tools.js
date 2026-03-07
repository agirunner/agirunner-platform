import { z } from 'zod';
const obj = (shape, required = []) => z
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
    { name: 'baton_list_tasks', description: 'List tasks with optional filters', inputSchema: { type: 'object', properties: { state: { type: 'string' }, type: { type: 'string' }, workflow_id: { type: 'string' }, page: { type: 'number' }, per_page: { type: 'number' } } } },
    { name: 'baton_get_task', description: 'Get task by id', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
    { name: 'baton_create_task', description: 'Create a new task', inputSchema: { type: 'object', properties: { title: { type: 'string' }, type: { type: 'string' }, description: { type: 'string' }, input: { type: 'object' } }, required: ['title', 'type'] } },
    { name: 'baton_claim_task', description: 'Claim next task for an agent', inputSchema: { type: 'object', properties: { agent_id: { type: 'string' }, capabilities: { type: 'array', items: { type: 'string' } } }, required: ['agent_id'] } },
    { name: 'baton_complete_task', description: 'Complete a task', inputSchema: { type: 'object', properties: { id: { type: 'string' }, output: { type: 'object' } }, required: ['id'] } },
    { name: 'baton_list_workflows', description: 'List workflows', inputSchema: { type: 'object', properties: { state: { type: 'string' }, page: { type: 'number' }, per_page: { type: 'number' } } } },
    { name: 'baton_create_workflow', description: 'Create workflow from template', inputSchema: { type: 'object', properties: { template_id: { type: 'string' }, name: { type: 'string' }, project_id: { type: 'string' }, parameters: { type: 'object' } }, required: ['template_id', 'name'] } },
    { name: 'baton_cancel_workflow', description: 'Cancel a workflow', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
];
const LEGACY_ALIASES = [
    { alias: 'list_tasks', canonical: 'baton_list_tasks' },
    { alias: 'get_task', canonical: 'baton_get_task' },
    { alias: 'create_task', canonical: 'baton_create_task' },
    { alias: 'claim_task', canonical: 'baton_claim_task' },
    { alias: 'complete_task', canonical: 'baton_complete_task' },
    { alias: 'list_workflows', canonical: 'baton_list_workflows' },
    { alias: 'create_workflow', canonical: 'baton_create_workflow' },
    { alias: 'cancel_workflow', canonical: 'baton_cancel_workflow' },
];
export const TOOL_DEFINITIONS = [
    ...CANONICAL_TOOL_DEFINITIONS,
    ...LEGACY_ALIASES.map((alias) => {
        const target = CANONICAL_TOOL_DEFINITIONS.find((tool) => tool.name === alias.canonical);
        return {
            ...target,
            name: alias.alias,
            description: `${target.description} (deprecated alias; use ${alias.canonical})`,
        };
    }),
];
export const TOOL_SCHEMAS = {
    baton_list_tasks: obj({ state: z.string().optional(), type: z.string().optional(), workflow_id: z.string().optional(), page: z.number().optional(), per_page: z.number().optional() }),
    baton_get_task: obj({ id: z.string().optional() }, ['id']),
    baton_create_task: obj({ title: z.string().optional(), type: z.string().optional(), description: z.string().optional(), input: z.record(z.unknown()).optional() }, ['title', 'type']),
    baton_claim_task: obj({ agent_id: z.string().optional(), capabilities: z.array(z.string()).optional() }, ['agent_id']),
    baton_complete_task: obj({ id: z.string().optional(), output: z.record(z.unknown()).optional() }, ['id']),
    baton_list_workflows: obj({ state: z.string().optional(), page: z.number().optional(), per_page: z.number().optional() }),
    baton_create_workflow: obj({ template_id: z.string().optional(), name: z.string().optional(), project_id: z.string().optional(), parameters: z.record(z.unknown()).optional() }, ['template_id', 'name']),
    baton_cancel_workflow: obj({ id: z.string().optional() }, ['id']),
    // Backward-compatible aliases.
    list_tasks: obj({ state: z.string().optional(), type: z.string().optional(), workflow_id: z.string().optional(), page: z.number().optional(), per_page: z.number().optional() }),
    get_task: obj({ id: z.string().optional() }, ['id']),
    create_task: obj({ title: z.string().optional(), type: z.string().optional(), description: z.string().optional(), input: z.record(z.unknown()).optional() }, ['title', 'type']),
    claim_task: obj({ agent_id: z.string().optional(), capabilities: z.array(z.string()).optional() }, ['agent_id']),
    complete_task: obj({ id: z.string().optional(), output: z.record(z.unknown()).optional() }, ['id']),
    list_workflows: obj({ state: z.string().optional(), page: z.number().optional(), per_page: z.number().optional() }),
    create_workflow: obj({ template_id: z.string().optional(), name: z.string().optional(), project_id: z.string().optional(), parameters: z.record(z.unknown()).optional() }, ['template_id', 'name']),
    cancel_workflow: obj({ id: z.string().optional() }, ['id']),
};
export function createToolHandlers(client) {
    const canonicalHandlers = {
        baton_list_tasks: (input) => client.listTasks(input),
        baton_get_task: (input) => client.getTask(String(input.id)),
        baton_create_task: (input) => client.createTask(input),
        baton_claim_task: (input) => client.claimTask({
            agent_id: String(input.agent_id),
            capabilities: Array.isArray(input.capabilities) ? input.capabilities : [],
        }),
        baton_complete_task: (input) => client.completeTask(String(input.id), input.output ?? {}),
        baton_list_workflows: (input) => client.listWorkflows(input),
        baton_create_workflow: (input) => client.createWorkflow(input),
        baton_cancel_workflow: (input) => client.cancelWorkflow(String(input.id)),
    };
    const aliasHandlers = {
        list_tasks: canonicalHandlers.baton_list_tasks,
        get_task: canonicalHandlers.baton_get_task,
        create_task: canonicalHandlers.baton_create_task,
        claim_task: canonicalHandlers.baton_claim_task,
        complete_task: canonicalHandlers.baton_complete_task,
        list_workflows: canonicalHandlers.baton_list_workflows,
        create_workflow: canonicalHandlers.baton_create_workflow,
        cancel_workflow: canonicalHandlers.baton_cancel_workflow,
    };
    return {
        ...canonicalHandlers,
        ...aliasHandlers,
    };
}
