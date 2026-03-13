import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return ['./webhooks-page.tsx', './webhooks-page.sections.tsx', './webhooks-page.support.ts']
    .map((path) => readFileSync(resolve(import.meta.dirname, path), 'utf8'))
    .join('\n');
}

describe('webhooks page source', () => {
  it('uses structured event selection instead of comma-separated entry', () => {
    const source = readSource();
    expect(source).toContain('WEBHOOK_EVENT_GROUPS');
    expect(source).toContain('Choose the events this endpoint should receive.');
    expect(source).toContain('Coverage mode');
    expect(source).toContain('Selected families');
    expect(source).toContain('Select group');
    expect(source).toContain('Clear group');
    expect(source).toContain('Workflow lifecycle');
    expect(source).toContain('Work-item changes');
    expect(source).toContain('Task execution');
    expect(source).toContain('Save readiness');
    expect(source).toContain('Platform-managed secret');
    expect(source).toContain('Secret rotation not available here');
    expect(source).toContain('validateWebhookForm');
    expect(source).not.toContain('Event Types (comma-separated, leave blank for all)');
    expect(source).not.toContain('workflow.completed, task.failed');
  });

  it('keeps webhook dialogs scrollable and listing surfaces responsive on smaller viewports', () => {
    const source = readSource();
    expect(source).toContain('max-h-[85vh] max-w-4xl overflow-hidden p-0');
    expect(source).toContain('max-h-[75vh] max-w-lg overflow-y-auto');
    expect(source).toContain('lg:hidden');
    expect(source).toContain('sm:grid-cols-3');
    expect(source).toContain('space-y-4 lg:hidden');
    expect(source).toContain('hidden overflow-x-auto lg:block');
  });

  it('includes inspect, edit, and delete flows with contextual operator guidance', () => {
    const source = readSource();
    expect(source).toContain('Inspect webhook');
    expect(source).toContain('Edit webhook');
    expect(source).toContain('Delete webhook');
    expect(source).toContain('DialogDescription');
    expect(source).toContain('WebhookInspectDialog');
    expect(source).toContain('DeleteWebhookDialog');
    expect(source).toContain('Operator handoff');
    expect(source).toContain('Create first webhook');
    expect(source).toContain('Best next step');
    expect(source).toContain('Deleting this webhook stops all future outbound deliveries');
    expect(source).toContain('summarizeWebhookCollection');
    expect(source).toContain('buildWebhookOperatorFocus');
    expect(source).toContain('describeWebhookCoverage');
    expect(source).not.toContain('size="icon"');
  });
});
