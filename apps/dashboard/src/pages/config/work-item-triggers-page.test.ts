import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return [
    './work-item-triggers-page.tsx',
    './work-item-triggers-page.sections.tsx',
  ]
    .map((path) => readFileSync(resolve(import.meta.dirname, path), 'utf8'))
    .join('\n');
}

describe('trigger overview page source', () => {
  it('loads both scheduled and webhook trigger overviews through dashboard api', () => {
    const source = readSource();
    expect(source).toContain('dashboardApi.listScheduledWorkItemTriggers()');
    expect(source).toContain('dashboardApi.listWebhookWorkItemTriggers()');
    expect(source).toContain('Scheduled Triggers');
    expect(source).toContain('Webhook Triggers');
    expect(source).toContain('summarizeTriggerOverview');
    expect(source).toContain('buildTriggerOperatorFocus');
  });

  it('uses responsive cards, action guidance, and direct scope links instead of a table-only dump', () => {
    const source = readSource();
    expect(source).toContain('space-y-4 lg:hidden');
    expect(source).toContain('hidden overflow-x-auto lg:block');
    expect(source).toContain('Review cadence, next-run posture, and the owning project');
    expect(source).toContain('Manage inbound webhook trigger rules');
    expect(source).toContain('Operator focus');
  });

  it('supports create, edit, toggle, inspect, and delete flows for webhook triggers', () => {
    const source = readSource();
    expect(source).toContain('createWebhookWorkItemTrigger');
    expect(source).toContain('updateWebhookWorkItemTrigger');
    expect(source).toContain('deleteWebhookWorkItemTrigger');
    expect(source).toContain('WebhookTriggerEditorDialog');
    expect(source).toContain('WebhookTriggerDeleteDialog');
    expect(source).toContain('WebhookTriggerInspectDialog');
    expect(source).toContain('onCreateClick');
    expect(source).toContain('onEditClick');
    expect(source).toContain('onToggle');
    expect(source).toContain('onDeleteClick');
    expect(source).toContain('onInspectClick');
  });

  it('uses inline toggle switches for enable and disable', () => {
    const source = readSource();
    expect(source).toContain('Switch');
    expect(source).toContain('toggleMutation');
    expect(source).toContain('is_active');
  });

  it('renders empty state with CTA when no webhook triggers exist', () => {
    const source = readSource();
    expect(source).toContain('No webhook triggers configured');
    expect(source).toContain('Create first trigger');
  });

  it('uses destructive styling for delete confirmation', () => {
    const source = readSource();
    expect(source).toContain('variant="destructive"');
    expect(source).toContain('permanently removes the trigger');
  });

  it('renders inspect dialog with field mappings and defaults', () => {
    const source = readSource();
    expect(source).toContain('Field mappings');
    expect(source).toContain('Defaults');
    expect(source).toContain('Secret configured');
    expect(source).toContain('Event header');
    expect(source).toContain('Event types');
  });

  it('uses save-readiness validation in the editor dialog', () => {
    const source = readSource();
    expect(source).toContain('Save readiness');
    expect(source).toContain('validateWebhookTriggerForm');
    expect(source).toContain('Ready to save');
    expect(source).toContain('ConfigInputField');
    expect(source).toContain('ConfigSelectField');
    expect(source).toContain('ConfigTextAreaField');
    expect(source).not.toContain('EditorField(');
  });
});
