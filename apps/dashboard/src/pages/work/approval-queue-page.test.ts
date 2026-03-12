import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(
    resolve(import.meta.dirname, './approval-queue-page.tsx'),
    'utf8',
  );
}

describe('approval queue page source', () => {
  it('prioritizes stage gates with richer summary metrics', () => {
    const source = readSource();
    expect(source).toContain('Review stage gates first');
    expect(source).toContain('Oldest wait');
    expect(source).toContain('First up');
    expect(source).toContain('Stage gates');
    expect(source).toContain('Task reviews');
  });

  it('renders richer stage gate context and artifact sections', () => {
    const source = readSource();
    expect(source).toContain('GateDetailCard');
    expect(source).toContain('source="approval-queue"');
    expect(source).toContain('Queue priority');
    expect(source).toContain('oldest wait first');
  });

  it('adds url-driven search, saved views, and workflow gate deep links', () => {
    const source = readSource();
    expect(source).toContain('useSearchParams');
    expect(source).toContain("searchParams.get('q')");
    expect(source).toContain("searchParams.get('view')");
    expect(source).toContain('SavedViews');
    expect(source).toContain("storageKey=\"approval-queue\"");
    expect(source).toContain('buildWorkflowDetailPermalink');
    expect(source).toContain('Open workflow gate');
  });

  it('subscribes to realtime updates and invalidates workflow detail queries after decisions', () => {
    const source = readSource();
    expect(source).toContain('subscribeToEvents');
    expect(source).toContain('invalidateWorkflowQueries');
    expect(source).toContain('invalidateApprovalWorkflowQueries');
  });

  it('renders task approval breadcrumbs with work-item, stage, role, and activation context', () => {
    const source = readSource();
    expect(source).toContain('buildWorkflowDetailPermalink');
    expect(source).toContain('Work item:');
    expect(source).toContain('Stage:');
    expect(source).toContain('Role:');
    expect(source).toContain('Rework round');
    expect(source).toContain('activationId: task.activation_id ?? null');
  });
});
