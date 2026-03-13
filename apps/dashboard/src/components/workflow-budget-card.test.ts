import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { WorkflowBudgetCard } from './workflow-budget-card.js';

describe('WorkflowBudgetCard', () => {
  it('renders warning posture with launch guardrails and inspector navigation in the workflow detail view', () => {
    const html = renderBudgetCard({
      workflowId: 'workflow-1',
      context: 'workflow-detail',
      isLoading: false,
      hasError: false,
      budget: {
        tokens_used: 4500,
        tokens_limit: 5000,
        cost_usd: 6.25,
        cost_limit_usd: 10,
        elapsed_minutes: 42,
        duration_limit_minutes: 90,
        task_count: 6,
        orchestrator_activations: 4,
        tokens_remaining: 500,
        cost_remaining_usd: 3.75,
        time_remaining_minutes: 48,
        warning_dimensions: ['cost'],
        exceeded_dimensions: [],
        warning_threshold_ratio: 0.8,
      },
    });

    expect(html).toContain('Workflow Budget');
    expect(html).toContain('Warning');
    expect(html).toContain('Warning: cost');
    expect(html).toContain('Token budget');
    expect(html).toContain('4,500');
    expect(html).toContain('500');
    expect(html).toContain('$6.2500');
    expect(html).toContain('Inspect budget context');
    expect(html).toContain('href="/work/workflows/workflow-1/inspector"');
  });

  it('renders exceeded posture with return navigation in inspector context', () => {
    const html = renderBudgetCard({
      workflowId: 'workflow-2',
      context: 'inspector',
      isLoading: false,
      hasError: false,
      budget: {
        tokens_used: 7200,
        tokens_limit: 5000,
        cost_usd: 14.5,
        cost_limit_usd: 10,
        elapsed_minutes: 95,
        duration_limit_minutes: 90,
        task_count: 9,
        orchestrator_activations: 5,
        tokens_remaining: 0,
        cost_remaining_usd: 0,
        time_remaining_minutes: 0,
        warning_dimensions: ['tokens', 'cost', 'duration'],
        exceeded_dimensions: ['tokens', 'cost', 'duration'],
        warning_threshold_ratio: 0.8,
      },
    });

    expect(html).toContain('Exceeded');
    expect(html).toContain('Exceeded: tokens, cost, duration');
    expect(html).toContain('Back to board controls');
    expect(html).toContain('href="/work/workflows/workflow-2"');
    expect(html).toContain('Orchestrator activations');
    expect(html).toContain('9');
    expect(html).toContain('5');
  });
});

function renderBudgetCard(
  props: Parameters<typeof WorkflowBudgetCard>[0],
): string {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    return renderToStaticMarkup(
      createElement(
        MemoryRouter,
        undefined,
        createElement(WorkflowBudgetCard, props),
      ),
    );
  } finally {
    consoleError.mockRestore();
  }
}
