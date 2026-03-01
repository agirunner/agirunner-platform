import { z } from 'zod';
const obj = (shape, required = []) => z
    .object(shape)
    .partial()
    .superRefine((value, ctx) => {
    required.forEach((key) => {
        if (value[key] === undefined)
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: [String(key)], message: 'Required' });
    });
});
export const TOOL_DEFINITIONS = [
    { name: 'list_tasks', description: 'List tasks with optional filters', inputSchema: { type: 'object', properties: { state: { type: 'string' }, type: { type: 'string' }, pipeline_id: { type: 'string' }, page: { type: 'number' }, per_page: { type: 'number' } } } },
    { name: 'get_task', description: 'Get task by id', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
    { name: 'create_task', description: 'Create a new task', inputSchema: { type: 'object', properties: { title: { type: 'string' }, type: { type: 'string' }, description: { type: 'string' }, input: { type: 'object' } }, required: ['title', 'type'] } },
    { name: 'claim_task', description: 'Claim next task for an agent', inputSchema: { type: 'object', properties: { agent_id: { type: 'string' }, capabilities: { type: 'array', items: { type: 'string' } } }, required: ['agent_id'] } },
    { name: 'complete_task', description: 'Complete a task', inputSchema: { type: 'object', properties: { id: { type: 'string' }, output: { type: 'object' } }, required: ['id'] } },
    { name: 'list_pipelines', description: 'List pipelines', inputSchema: { type: 'object', properties: { state: { type: 'string' }, page: { type: 'number' }, per_page: { type: 'number' } } } },
    { name: 'create_pipeline', description: 'Create pipeline from template', inputSchema: { type: 'object', properties: { template_id: { type: 'string' }, name: { type: 'string' }, project_id: { type: 'string' }, parameters: { type: 'object' } }, required: ['template_id', 'name'] } },
    { name: 'cancel_pipeline', description: 'Cancel a pipeline', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
];
export const TOOL_SCHEMAS = {
    list_tasks: obj({ state: z.string().optional(), type: z.string().optional(), pipeline_id: z.string().optional(), page: z.number().optional(), per_page: z.number().optional() }),
    get_task: obj({ id: z.string().optional() }, ['id']),
    create_task: obj({ title: z.string().optional(), type: z.string().optional(), description: z.string().optional(), input: z.record(z.unknown()).optional() }, ['title', 'type']),
    claim_task: obj({ agent_id: z.string().optional(), capabilities: z.array(z.string()).optional() }, ['agent_id']),
    complete_task: obj({ id: z.string().optional(), output: z.record(z.unknown()).optional() }, ['id']),
    list_pipelines: obj({ state: z.string().optional(), page: z.number().optional(), per_page: z.number().optional() }),
    create_pipeline: obj({ template_id: z.string().optional(), name: z.string().optional(), project_id: z.string().optional(), parameters: z.record(z.unknown()).optional() }, ['template_id', 'name']),
    cancel_pipeline: obj({ id: z.string().optional() }, ['id']),
};
export function createToolHandlers(client) {
    return {
        list_tasks: (input) => client.listTasks(input),
        get_task: (input) => client.getTask(String(input.id)),
        create_task: (input) => client.createTask(input),
        claim_task: (input) => client.claimTask({ agent_id: String(input.agent_id), capabilities: Array.isArray(input.capabilities) ? input.capabilities : [] }),
        complete_task: (input) => client.completeTask(String(input.id), input.output ?? {}),
        list_pipelines: (input) => client.listPipelines(input),
        create_pipeline: (input) => client.createPipeline(input),
        cancel_pipeline: (input) => client.cancelPipeline(String(input.id)),
    };
}
