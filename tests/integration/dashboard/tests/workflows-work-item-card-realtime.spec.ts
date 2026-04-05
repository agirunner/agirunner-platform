import { expect, test } from '@playwright/test';

import {
  loginToWorkflows,
  workflowRailButton,
} from '../lib/workflows-auth.js';
import { seedWorkflowsScenario } from '../lib/workflows-fixtures.js';

test('refreshes unopened work-item cards from targeted workspace activity without a click', async ({ page }) => {
  const scenario = await seedWorkflowsScenario();
  const workflowId = scenario.needsActionWorkflow.id;
  const workItemId = scenario.needsActionWorkItem.id;
  const workItemTitle = scenario.needsActionWorkItem.title;
  const workflowName = scenario.needsActionWorkflow.name ?? 'E2E Needs Action Delivery';
  const workflowStreamPattern = new RegExp(
    `/api/v1/operations/workflows/${workflowId}/stream\\?[^#]*tab_scope=workflow(?:&|$)`,
  );
  const workItemTasksPattern = new RegExp(
    `/api/v1/workflows/${workflowId}/work-items/${workItemId}/tasks(?:\\?.*)?$`,
  );

  let streamRequestCount = 0;
  let workItemTasksRequestCount = 0;
  let allowRefreshedTaskResponses = false;
  let releaseWorkflowStream: (() => void) | null = null;
  const workflowStreamReady = new Promise<void>((resolve) => {
    releaseWorkflowStream = resolve;
  });

  await page.route(workflowStreamPattern, async (route) => {
    streamRequestCount += 1;
    if (streamRequestCount > 1) {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'NOT_FOUND',
            message: 'Deterministic test stream is complete.',
          },
        }),
      });
      return;
    }

    await workflowStreamReady;
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: [
        'event: message',
        `data: ${JSON.stringify({
          cursor: 'cursor-work-item-card-refresh',
          generated_at: '2026-04-04T19:35:00.000Z',
          latest_event_id: 'event-work-item-card-refresh',
          snapshot_version: 2,
          events: [
            {
              event_type: 'live_console_append',
              payload: {
                items: [
                  {
                    item_id: 'live-console-work-item-card-refresh',
                    work_item_id: workItemId,
                    created_at: '2026-04-04T19:35:00.000Z',
                    headline: 'Specialist task created for unopened work item card',
                  },
                ],
              },
            },
          ],
        })}`,
        '',
        '',
      ].join('\n'),
    });
  });

  await page.route(workItemTasksPattern, async (route) => {
    workItemTasksRequestCount += 1;
    const response = await route.fetch();
    const payload = (await response.json()) as
      | Array<Record<string, unknown>>
      | { data?: Array<Record<string, unknown>> };
    const injectedTask = {
      id: 'task-realtime-card-refresh',
      title: 'Draft operator explainer',
      role: 'research_analyst',
      state: 'in_progress',
      work_item_id: workItemId,
    };

    if (allowRefreshedTaskResponses) {
      if (Array.isArray(payload)) {
        await route.fulfill({ response, json: [injectedTask, ...payload] });
        return;
      }
      if (Array.isArray(payload.data)) {
        await route.fulfill({
          response,
          json: {
            ...payload,
            data: [injectedTask, ...payload.data],
          },
        });
        return;
      }
    }

    await route.fulfill({ response, json: payload });
  });

  await loginToWorkflows(page);
  await workflowRailButton(page, workflowName).click();

  const boardCard = page
    .locator('[data-work-item-card="true"]')
    .filter({ hasText: workItemTitle })
    .first();

  await expect(boardCard).toBeVisible();
  await expect(boardCard.getByText('Draft operator explainer')).toHaveCount(0);

  allowRefreshedTaskResponses = true;
  releaseWorkflowStream?.();

  await expect.poll(() => workItemTasksRequestCount).toBeGreaterThanOrEqual(2);
  await expect(boardCard).toContainText('Draft operator explainer');
  await expect(boardCard).toContainText('Research Analyst');
});

test('refreshes unopened work-item cards after the workflow stream reconnects', async ({ page }) => {
  const scenario = await seedWorkflowsScenario();
  const workflowId = scenario.needsActionWorkflow.id;
  const workItemId = scenario.needsActionWorkItem.id;
  const workItemTitle = scenario.needsActionWorkItem.title;
  const workflowName = scenario.needsActionWorkflow.name ?? 'E2E Needs Action Delivery';
  const workflowStreamPattern = new RegExp(
    `/api/v1/operations/workflows/${workflowId}/stream\\?[^#]*tab_scope=workflow(?:&|$)`,
  );
  const workItemTasksPattern = new RegExp(
    `/api/v1/workflows/${workflowId}/work-items/${workItemId}/tasks(?:\\?.*)?$`,
  );

  let streamRequestCount = 0;
  let workItemTasksRequestCount = 0;
  let allowRefreshedTaskResponses = false;

  await page.route(workflowStreamPattern, async (route) => {
    streamRequestCount += 1;

    if (streamRequestCount === 1) {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: '',
      });
      return;
    }

    allowRefreshedTaskResponses = true;
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: [
        'event: message',
        `data: ${JSON.stringify({
          cursor: 'cursor-work-item-card-reconnect',
          generated_at: '2026-04-04T19:45:00.000Z',
          latest_event_id: 'event-work-item-card-reconnect',
          snapshot_version: 3,
          events: [],
        })}`,
        '',
        '',
      ].join('\n'),
    });
  });

  await page.route(workItemTasksPattern, async (route) => {
    workItemTasksRequestCount += 1;
    const response = await route.fetch();
    const payload = (await response.json()) as
      | Array<Record<string, unknown>>
      | { data?: Array<Record<string, unknown>> };
    const injectedTask = {
      id: 'task-realtime-card-reconnect',
      title: 'Cross-check published sources',
      role: 'research_analyst',
      state: 'in_progress',
      work_item_id: workItemId,
    };

    if (allowRefreshedTaskResponses) {
      if (Array.isArray(payload)) {
        await route.fulfill({ response, json: [injectedTask, ...payload] });
        return;
      }
      if (Array.isArray(payload.data)) {
        await route.fulfill({
          response,
          json: {
            ...payload,
            data: [injectedTask, ...payload.data],
          },
        });
        return;
      }
    }

    await route.fulfill({ response, json: payload });
  });

  await loginToWorkflows(page);
  await workflowRailButton(page, workflowName).click();

  const boardCard = page
    .locator('[data-work-item-card="true"]')
    .filter({ hasText: workItemTitle })
    .first();

  await expect(boardCard).toBeVisible();
  await expect(boardCard.getByText('Cross-check published sources')).toHaveCount(0);

  await expect.poll(() => streamRequestCount).toBeGreaterThanOrEqual(2);
  await expect.poll(() => workItemTasksRequestCount).toBeGreaterThanOrEqual(2);
  await expect(boardCard).toContainText('Cross-check published sources');
  await expect(boardCard).toContainText('Research Analyst');
});

test('shows the active orchestrator task on unopened work-item cards after specialist completion', async ({ page }) => {
  const scenario = await seedWorkflowsScenario();
  const workflowId = scenario.needsActionWorkflow.id;
  const workItemId = scenario.needsActionWorkItem.id;
  const workItemTitle = scenario.needsActionWorkItem.title;
  const workflowName = scenario.needsActionWorkflow.name ?? 'E2E Needs Action Delivery';
  const workflowStreamPattern = new RegExp(
    `/api/v1/operations/workflows/${workflowId}/stream\\?[^#]*tab_scope=workflow(?:&|$)`,
  );
  const workItemTasksPattern = new RegExp(
    `/api/v1/workflows/${workflowId}/work-items/${workItemId}/tasks(?:\\?.*)?$`,
  );

  let workItemTasksRequestCount = 0;
  let useOrchestratorTask = false;
  let releaseWorkflowStream: (() => void) | null = null;
  const workflowStreamReady = new Promise<void>((resolve) => {
    releaseWorkflowStream = resolve;
  });

  await page.route(workflowStreamPattern, async (route) => {
    await workflowStreamReady;
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: [
        'event: message',
        `data: ${JSON.stringify({
          cursor: 'cursor-work-item-card-orchestrator',
          generated_at: '2026-04-04T20:10:00.000Z',
          latest_event_id: 'event-work-item-card-orchestrator',
          snapshot_version: 4,
          events: [
            {
              event_type: 'task_created',
              payload: {
                task_id: 'task-realtime-card-orchestrator',
                work_item_id: workItemId,
                role: 'orchestrator',
                title: 'Orchestrate Research Analysis: What is a quantum computer?',
                state: 'in_progress',
              },
            },
          ],
        })}`,
        '',
        '',
      ].join('\n'),
    });
  });

  await page.route(workItemTasksPattern, async (route) => {
    workItemTasksRequestCount += 1;
    const response = await route.fetch();
    const payload = (await response.json()) as
      | Array<Record<string, unknown>>
      | { data?: Array<Record<string, unknown>> };
    const specialistTask = {
      id: 'task-realtime-card-specialist-complete',
      title: "Review evidence for 'What is a quantum computer?'",
      role: 'research_analyst',
      state: useOrchestratorTask ? 'completed' : 'in_progress',
      work_item_id: workItemId,
      is_orchestrator_task: false,
    };
    const orchestratorTask = {
      id: 'task-realtime-card-orchestrator',
      title: 'Orchestrate Research Analysis: What is a quantum computer?',
      role: 'orchestrator',
      state: 'in_progress',
      work_item_id: workItemId,
      is_orchestrator_task: true,
    };

    if (Array.isArray(payload)) {
      await route.fulfill({
        response,
        json: useOrchestratorTask ? [orchestratorTask, specialistTask, ...payload] : [specialistTask, ...payload],
      });
      return;
    }

    if (Array.isArray(payload.data)) {
      await route.fulfill({
        response,
        json: {
          ...payload,
          data: useOrchestratorTask
            ? [orchestratorTask, specialistTask, ...payload.data]
            : [specialistTask, ...payload.data],
        },
      });
      return;
    }

    await route.fulfill({ response, json: payload });
  });

  await loginToWorkflows(page);
  await workflowRailButton(page, workflowName).click();

  const boardCard = page
    .locator('[data-work-item-card="true"]')
    .filter({ hasText: workItemTitle })
    .first();

  await expect(boardCard).toBeVisible();
  await expect(boardCard).toContainText("Review evidence for 'What is a quantum computer?'");
  await expect(boardCard.getByText('Orchestrate Research Analysis: What is a quantum computer?')).toHaveCount(0);

  useOrchestratorTask = true;
  releaseWorkflowStream?.();

  await expect.poll(() => workItemTasksRequestCount).toBeGreaterThanOrEqual(2);
  await expect(boardCard).toContainText('Orchestrate Research Analysis: What is a quantum computer?');
  await expect(boardCard).toContainText('Orchestrator');
});

test('keeps live orchestrator activity visible when a recent work item moves into the done lane', async ({ page }) => {
  const scenario = await seedWorkflowsScenario();
  const workflowId = scenario.needsActionWorkflow.id;
  const workItemId = scenario.needsActionWorkItem.id;
  const workItemTitle = scenario.needsActionWorkItem.title;
  const workflowName = scenario.needsActionWorkflow.name ?? 'E2E Needs Action Delivery';
  const recentCompletionAt = new Date().toISOString();
  const workflowStreamPattern = new RegExp(
    `/api/v1/operations/workflows/${workflowId}/stream\\?[^#]*tab_scope=workflow(?:&|$)`,
  );
  const workItemTasksPattern = new RegExp(
    `/api/v1/workflows/${workflowId}/work-items/${workItemId}/tasks(?:\\?.*)?$`,
  );

  let workItemTasksRequestCount = 0;
  let useCompletedLaneState = false;
  let releaseWorkflowStream: (() => void) | null = null;
  const workflowStreamReady = new Promise<void>((resolve) => {
    releaseWorkflowStream = resolve;
  });

  await page.route(workflowStreamPattern, async (route) => {
    await workflowStreamReady;
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: [
        'event: message',
        `data: ${JSON.stringify({
          cursor: 'cursor-work-item-card-completed-routing',
          generated_at: '2026-04-04T20:20:00.000Z',
          latest_event_id: 'event-work-item-card-completed-routing',
          snapshot_version: 5,
          events: [
            {
              event_type: 'workspace_board_update',
              payload: {
                columns: [
                  { id: 'planned', label: 'Planned' },
                  { id: 'active', label: 'Active' },
                  { id: 'done', label: 'Done', is_terminal: true },
                ],
                work_items: [
                  {
                    ...scenario.needsActionWorkItem,
                    workflow_id: workflowId,
                    stage_name: scenario.needsActionWorkItem.stage_name ?? 'source-review',
                    priority: scenario.needsActionWorkItem.priority ?? 'normal',
                    column_id: 'done',
                    completed_at: recentCompletionAt,
                    task_count: 2,
                  },
                ],
                active_stages: ['synthesis'],
                awaiting_gate_count: 0,
                stage_summary: [],
              },
            },
          ],
        })}`,
        '',
        '',
      ].join('\n'),
    });
  });

  await page.route(workItemTasksPattern, async (route) => {
    workItemTasksRequestCount += 1;
    const response = await route.fetch();
    const payload = (await response.json()) as
      | Array<Record<string, unknown>>
      | { data?: Array<Record<string, unknown>> };
    const specialistTask = {
      id: 'task-realtime-card-completed-specialist',
      title: 'Compare sources for quantum computer analysis',
      role: 'research_analyst',
      state: useCompletedLaneState ? 'completed' : 'in_progress',
      work_item_id: workItemId,
      is_orchestrator_task: false,
    };
    const orchestratorTask = {
      id: 'task-realtime-card-completed-orchestrator',
      title: 'Orchestrate Research Analysis: What is a quantum computer?',
      role: 'orchestrator',
      state: 'in_progress',
      work_item_id: workItemId,
      is_orchestrator_task: true,
    };

    if (Array.isArray(payload)) {
      await route.fulfill({
        response,
        json: useCompletedLaneState
          ? [orchestratorTask, specialistTask, ...payload]
          : [specialistTask, ...payload],
      });
      return;
    }

    if (Array.isArray(payload.data)) {
      await route.fulfill({
        response,
        json: {
          ...payload,
          data: useCompletedLaneState
            ? [orchestratorTask, specialistTask, ...payload.data]
            : [specialistTask, ...payload.data],
        },
      });
      return;
    }

    await route.fulfill({ response, json: payload });
  });

  await loginToWorkflows(page);
  await workflowRailButton(page, workflowName).click();

  const boardCard = page
    .locator('[data-work-item-card="true"]')
    .filter({ hasText: workItemTitle })
    .first();

  await expect(boardCard).toBeVisible();
  await expect(boardCard).toContainText('Compare sources for quantum computer analysis');
  await expect(boardCard.getByText('Orchestrate Research Analysis: What is a quantum computer?')).toHaveCount(0);

  useCompletedLaneState = true;
  releaseWorkflowStream?.();

  await expect.poll(() => workItemTasksRequestCount).toBeGreaterThanOrEqual(2);
  await expect(boardCard).toContainText('Orchestrate Research Analysis: What is a quantum computer?');
  await expect(boardCard).toContainText('Active task');
  await expect(boardCard).toContainText('Orchestrator');
});
