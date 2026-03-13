import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './work-item-triggers-page.tsx'), 'utf8');
}

describe('trigger overview page source', () => {
  it('loads both scheduled and webhook trigger overviews through dashboard api', () => {
    const source = readSource();
    expect(source).toContain('dashboardApi.listScheduledWorkItemTriggers()');
    expect(source).toContain('dashboardApi.listWebhookWorkItemTriggers()');
    expect(source).toContain('Scheduled Triggers');
    expect(source).toContain('Webhook Triggers');
    expect(source).toContain('summarizeTriggerOverview');
  });

  it('directs operators back to project settings for scheduled trigger management', () => {
    const source = readSource();
    expect(source).toContain('Open project settings');
    expect(source).toContain('/projects');
  });

  it('uses responsive cards on mobile and tables on desktop instead of a table-only dump', () => {
    const source = readSource();
    expect(source).toContain('space-y-4 lg:hidden');
    expect(source).toContain('hidden overflow-x-auto lg:block');
    expect(source).toContain('Review cadence, next-run posture, and owning project scope');
    expect(source).toContain('Review inbound trigger coverage, signature mode, and owning scope');
  });
});
