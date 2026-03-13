import { describe, expect, it, vi } from 'vitest';

import { PlatformApiClient } from './client.js';

describe('sdk full client coverage', () => {
  it('covers FR-041 typed client methods for task/workflow/agent/worker APIs', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ id: 't1' }], pagination: { total_pages: 1 } }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: 't2' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: 'p1' } }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ id: 'w1' }] }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ id: 'a1' }] }), { status: 200 }),
      ) as unknown as typeof fetch;

    const client = new PlatformApiClient({
      baseUrl: 'http://localhost:8080',
      accessToken: 'token',
      fetcher,
    });

    const list = await client.listTasks();
    const task = await client.getTask('t2');
    const workflow = await client.getWorkflow('p1');
    const workers = await client.listWorkers();
    const agents = await client.listAgents();

    expect(list.data[0].id).toBe('t1');
    expect(task.id).toBe('t2');
    expect(workflow.id).toBe('p1');
    expect(workers[0].id).toBe('w1');
    expect(agents[0].id).toBe('a1');
  });

  it('covers FR-042 background-friendly pagination helper iteration semantics', async () => {
    const client = new PlatformApiClient({
      baseUrl: 'http://localhost:8080',
      accessToken: 'token',
      fetcher: vi.fn() as unknown as typeof fetch,
    });

    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ data: [{ id: '1' }], pagination: { total_pages: 3 } })
      .mockResolvedValueOnce({ data: [{ id: '2' }], pagination: { total_pages: 3 } })
      .mockResolvedValueOnce({ data: [{ id: '3' }], pagination: { total_pages: 3 } });

    const rows = await client.paginate(fetchPage, { perPage: 1, startPage: 1 });

    expect((rows as Array<{ id: string }>).map((row) => row.id)).toEqual(['1', '2', '3']);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it('covers FR-043 worker convenience flow primitives (claim + complete) through sdk wrappers', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: 'task-1' } }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: 'task-1', state: 'completed' } }), {
          status: 200,
        }),
      ) as unknown as typeof fetch;

    const client = new PlatformApiClient({
      baseUrl: 'http://localhost:8080',
      accessToken: 'token',
      fetcher,
    });

    const claimed = await client.claimTask({ agent_id: 'agent-1', capabilities: ['ts'] });
    const completed = await client.completeTask('task-1', { ok: true });

    expect(claimed?.id).toBe('task-1');
    expect(completed.state).toBe('completed');
  });

  it('keeps auth token mutable for long-running clients', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ data: { id: 't1' } }), { status: 200 }),
      ) as unknown as typeof fetch;
    const client = new PlatformApiClient({
      baseUrl: 'http://localhost:8080',
      accessToken: 'old',
      fetcher,
    });

    client.setAccessToken('new-token');
    await client.getTask('t1');

    const [, options] = vi.mocked(fetcher).mock.calls[0];
    expect((options?.headers as Record<string, string>).Authorization).toBe('Bearer new-token');
  });

  it('covers project, workflow, document, and artifact parity methods through sdk wrappers', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ id: 'project-1' }] }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: 'project-1', memory: {} } }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: { id: 'project-1', memory: { last_run_summary: {} } } }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ workflow_id: 'pipe-1', kind: 'run_summary' }] }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: { workflow_id: 'pipe-1', resolved_config: { retries: 2 } } }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ logical_name: 'brief', scope: 'project', source: 'repository', metadata: {} }],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: { logical_name: 'brief', scope: 'workflow', source: 'external', metadata: {} },
          }),
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: { logical_name: 'brief', scope: 'workflow', source: 'external', metadata: {} },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: 'pipe-1' } }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ id: 'artifact-1', task_id: 'task-1' }] }), {
          status: 200,
        }),
      ) as unknown as typeof fetch;

    const client = new PlatformApiClient({
      baseUrl: 'http://localhost:8080',
      accessToken: 'token',
      fetcher,
    });

    const projects = await client.listProjects();
    const project = await client.getProject('project-1');
    const patched = await client.patchProjectMemory('project-1', {
      key: 'last_run_summary',
      value: {},
    });
    const timeline = await client.getProjectTimeline('project-1');
    const config = await client.getResolvedWorkflowConfig('pipe-1', true);
    const documents = await client.listWorkflowDocuments('pipe-1');
    const createdDocument = await client.createWorkflowDocument('pipe-1', {
      logical_name: 'brief',
      source: 'external',
      url: 'https://example.com/brief',
    });
    const updatedDocument = await client.updateWorkflowDocument('pipe-1', 'brief', {
      title: 'Brief',
    });
    await client.deleteWorkflowDocument('pipe-1', 'brief');
    const planning = await client.createPlanningWorkflow('project-1', { brief: 'Plan next run' });
    const artifacts = await client.listTaskArtifacts('task-1');

    expect(projects.data[0].id).toBe('project-1');
    expect(project.id).toBe('project-1');
    expect(patched.memory).toEqual({ last_run_summary: {} });
    expect(timeline[0].workflow_id).toBe('pipe-1');
    expect(config.resolved_config).toEqual({ retries: 2 });
    expect(documents[0].logical_name).toBe('brief');
    expect(createdDocument.scope).toBe('workflow');
    expect(updatedDocument.logical_name).toBe('brief');
    expect(planning.id).toBe('pipe-1');
    expect(artifacts[0].id).toBe('artifact-1');
  });

  it('covers v2 playbook, board, stage, activation, approval, and task-scope helpers', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ id: 'playbook-1', lifecycle: 'continuous' }] }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: 'playbook-1', lifecycle: 'continuous' } }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: 'playbook-2', lifecycle: 'standard' } }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: 'playbook-3', version: 2 } }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: 'playbook-4', version: 3 } }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: 'playbook-4', is_active: false } }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: 'playbook-4', is_active: true } }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: 'playbook-5', deleted: true } }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: 'wf-1', playbook_id: 'playbook-1' } }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              columns: [{ id: 'todo', name: 'todo', title: 'To Do', position: 1 }],
              work_items: [],
              stage_summary: [],
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'stage-1',
                name: 'build',
                position: 1,
                goal: 'Build',
                human_gate: false,
                status: 'active',
                gate_status: 'none',
                iteration_count: 0,
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'item-1',
                workflow_id: 'wf-1',
                parent_work_item_id: null,
                stage_name: 'build',
                title: 'Implement feature',
                column_id: 'todo',
                priority: 'normal',
                children_count: 2,
                is_milestone: true,
                children: [
                  {
                    id: 'item-1a',
                    workflow_id: 'wf-1',
                    parent_work_item_id: 'item-1',
                    stage_name: 'build',
                    title: 'Implement backend',
                    column_id: 'todo',
                    priority: 'normal',
                    children_count: 0,
                    is_milestone: false,
                  },
                ],
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: 'item-1',
              workflow_id: 'wf-1',
              parent_work_item_id: null,
              stage_name: 'build',
              title: 'Implement feature',
              column_id: 'todo',
              priority: 'normal',
              children_count: 2,
              is_milestone: true,
              children: [
                {
                  id: 'item-1a',
                  workflow_id: 'wf-1',
                  parent_work_item_id: 'item-1',
                  stage_name: 'build',
                  title: 'Implement backend',
                  column_id: 'todo',
                  priority: 'normal',
                  children_count: 0,
                  is_milestone: false,
                },
              ],
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'task-1',
                workflow_id: 'wf-1',
                work_item_id: 'item-1',
                title: 'Implement feature',
                state: 'ready',
                role: 'developer',
                stage_name: 'build',
                activation_id: 'activation-1',
                is_orchestrator_task: false,
                created_at: '2026-03-11T00:00:00Z',
                completed_at: null,
                depends_on: [],
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: '1',
                tenant_id: 'tenant-1',
                entity_type: 'work_item',
                entity_id: 'item-1',
                type: 'work_item.updated',
                payload: {
                  workflow_id: 'wf-1',
                  work_item_id: 'item-1',
                },
                created_at: '2026-03-11T00:10:00Z',
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: 'item-1',
              workflow_id: 'wf-1',
              stage_name: 'build',
              title: 'Implement feature',
              column_id: 'todo',
              priority: 'high',
              notes: 'Updated',
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: 'item-2',
              workflow_id: 'wf-1',
              stage_name: 'build',
              title: 'Review docs',
              column_id: 'todo',
              priority: 'high',
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'activation-1',
                activation_id: 'activation-batch-1',
                workflow_id: 'wf-1',
                reason: 'work_item.created',
                event_type: 'work_item.created',
                payload: {},
                state: 'queued',
                queued_at: '2026-03-11T00:00:00Z',
                recovery_status: 'stale_detected',
                recovery_reason: 'orchestrator task heartbeat expired',
                recovery_detected_at: '2026-03-11T00:05:00Z',
                stale_started_at: '2026-03-11T00:03:00Z',
                redispatched_task_id: 'task-redispatch-1',
                latest_event_at: '2026-03-11T00:05:00Z',
                event_count: 2,
                events: [
                  {
                    id: 'activation-event-1',
                    activation_id: 'activation-batch-1',
                    reason: 'work_item.created',
                    event_type: 'work_item.created',
                    payload: {},
                    state: 'queued',
                    queued_at: '2026-03-11T00:00:00Z',
                  },
                ],
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: 'wf-1', lifecycle: 'standard', current_stage: 'review' } }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              task_approvals: [
                {
                  id: 'task-1',
                  title: 'Review output',
                  state: 'output_pending_review',
                  created_at: '2026-03-11T00:00:00Z',
                },
              ],
              stage_gates: [],
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { memory: { architecture: 'v2' } } }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: { id: 'project-1', memory: { architecture: 'v2' } } }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'artifact-2',
                task_id: 'task-1',
                name: 'design.md',
                content_type: 'text/markdown',
                size_bytes: 128,
                created_at: '2026-03-11T00:00:00Z',
                metadata: {},
                download_url: '/api/v1/tasks/task-1/artifact-catalog/artifact-2',
              },
            ],
          }),
          { status: 200 },
        ),
      ) as unknown as typeof fetch;

    const client = new PlatformApiClient({
      baseUrl: 'http://localhost:8080',
      accessToken: 'token',
      fetcher,
    });

    const playbooks = await client.listPlaybooks();
    const playbook = await client.getPlaybook('playbook-1');
    const createdPlaybook = await client.createPlaybook({
      name: 'Delivery',
      outcome: 'Ship production code',
      definition: { lifecycle: 'standard', stages: [] },
    });
    const updatedPlaybook = await client.updatePlaybook('playbook-2', {
      description: 'Rev 2',
    });
    const replacedPlaybook = await client.replacePlaybook('playbook-3', {
      name: 'Delivery',
      outcome: 'Ship production code',
      definition: { lifecycle: 'continuous', stages: [] },
    });
    const archivedPlaybook = await client.archivePlaybook('playbook-4');
    const restoredPlaybook = await client.restorePlaybook('playbook-4');
    const deletedPlaybook = await client.deletePlaybook('playbook-5');
    const workflow = await client.createWorkflow({
      playbook_id: 'playbook-1',
      name: 'Delivery run',
    });
    const board = await client.getWorkflowBoard('wf-1');
    const stages = await client.listWorkflowStages('wf-1');
    const items = await client.listWorkflowWorkItems('wf-1', { grouped: true });
    const item = await client.getWorkflowWorkItem('wf-1', 'item-1', { include_children: true });
    const workItemTasks = await client.listWorkflowWorkItemTasks('wf-1', 'item-1');
    const workItemEvents = await client.listWorkflowWorkItemEvents('wf-1', 'item-1', 50);
    const updatedItem = await client.updateWorkflowWorkItem('wf-1', 'item-1', {
      parent_work_item_id: 'item-root',
      priority: 'high',
      notes: 'Updated',
    });
    const createdItem = await client.createWorkflowWorkItem('wf-1', {
      title: 'Review docs',
      stage_name: 'build',
    });
    const activations = await client.listWorkflowActivations('wf-1');
    const gated = await client.actOnStageGate('wf-1', 'review', { action: 'approve' });
    const approvals = await client.getApprovalQueue();
    const taskMemory = await client.getTaskMemory('task-1');
    const patchedMemory = await client.patchTaskMemory('task-1', {
      key: 'architecture',
      value: 'v2',
    });
    const catalog = await client.listTaskArtifactCatalog('task-1', { name_prefix: 'design' });

    expect(playbooks[0].id).toBe('playbook-1');
    expect(playbook.id).toBe('playbook-1');
    expect(createdPlaybook.id).toBe('playbook-2');
    expect(updatedPlaybook.version).toBe(2);
    expect(replacedPlaybook.version).toBe(3);
    expect(archivedPlaybook.is_active).toBe(false);
    expect(restoredPlaybook.is_active).toBe(true);
    expect(deletedPlaybook.deleted).toBe(true);
    expect(workflow.playbook_id).toBe('playbook-1');
    expect(board.columns[0].id).toBe('todo');
    expect(stages[0].name).toBe('build');
    expect(items[0].id).toBe('item-1');
    expect(items[0].children_count).toBe(2);
    expect(items[0].children?.[0]?.id).toBe('item-1a');
    expect(item.id).toBe('item-1');
    expect(item.is_milestone).toBe(true);
    expect(item.children?.[0]?.parent_work_item_id).toBe('item-1');
    expect(workItemTasks[0].id).toBe('task-1');
    expect(workItemEvents[0].entity_type).toBe('work_item');
    expect(updatedItem.priority).toBe('high');
    expect(updatedItem.notes).toBe('Updated');
    expect(createdItem.id).toBe('item-2');
    expect(activations[0].id).toBe('activation-1');
    expect(activations[0].activation_id).toBe('activation-batch-1');
    expect(activations[0].recovery_status).toBe('stale_detected');
    expect(activations[0].redispatched_task_id).toBe('task-redispatch-1');
    expect(activations[0].event_count).toBe(2);
    expect(activations[0].events?.[0]?.id).toBe('activation-event-1');
    expect(gated.current_stage).toBe('review');
    expect(approvals.task_approvals[0].id).toBe('task-1');
    expect(taskMemory.memory).toEqual({ architecture: 'v2' });
    expect(patchedMemory.memory).toEqual({ architecture: 'v2' });
    expect(catalog[0].id).toBe('artifact-2');
  });
});
