import { createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import type { DashboardWorkflowActivationRecord } from '../../lib/api.js';
import { WorkflowActivationsCard } from './workflow-detail-activations-card.js';

describe('workflow detail activations card', () => {
  it('renders manual wake-up controls and activation payload details', () => {
    const markup = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(
          MemoryRouter,
          null,
          createElement(WorkflowActivationsCard, {
            workflowId: 'workflow-1',
            workflowState: 'active',
            isLoading: false,
            hasError: false,
            canEnqueueManualActivation: true,
            activations: [createActivation()],
          }),
        ),
      ),
    );

    expect(markup).toContain('Orchestrator Activations');
    expect(markup).toContain('Manual Wake-Up');
    expect(markup).toContain('Queue activation');
    expect(markup).toContain('Operator wake-up queued');
    expect(markup).toContain('Gate review packet is ready for operator review.');
    expect(markup).toContain('Activation attention');
    expect(markup).toContain('Open activation payload');
    expect(markup).toContain('Open event batch (1)');
    expect(markup).not.toContain('[object Object]');
  });
});

function createActivation(): DashboardWorkflowActivationRecord {
  return {
    id: 'activation-row-1',
    workflow_id: 'workflow-1',
    activation_id: 'activation-1',
    state: 'processing',
    event_type: 'operator.manual_enqueue',
    reason: 'Operator requested a fresh orchestrator pass.',
    summary: 'Gate review packet is ready for operator review.',
    payload: {
      source: 'workflow-detail-activations-card',
      workflow_state: 'active',
      focus: ['Gate review'],
    },
    queued_at: '2026-03-31T00:00:00.000Z',
    event_count: 1,
    recovery_status: 'recovered',
    recovery_reason: 'Recovered after stale activation detection.',
    stale_started_at: '2026-03-31T00:10:00.000Z',
    recovery_detected_at: '2026-03-31T00:12:00.000Z',
    redispatched_task_id: 'task-1',
    events: [
      {
        id: 'event-1',
        activation_id: 'activation-1',
        state: 'completed',
        event_type: 'workflow.updated',
        reason: 'Gate review payload refreshed.',
        summary: 'Timeline event packet ready.',
        payload: {
          stage_name: 'qa',
          work_item_id: 'work-item-1',
        },
        queued_at: '2026-03-31T00:01:00.000Z',
      },
    ],
  } as DashboardWorkflowActivationRecord;
}
