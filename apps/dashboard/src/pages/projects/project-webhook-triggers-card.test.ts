import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return [
    './project-webhook-triggers-card.tsx',
    './project-webhook-triggers-support.ts',
  ]
    .map((path) => readFileSync(resolve(import.meta.dirname, path), 'utf8'))
    .join('\n');
}

describe('project webhook triggers card source', () => {
  it('adds webhook posture packets and next-step guidance before the trigger list', () => {
    const source = readSource();
    expect(source).toContain('buildWebhookTriggerOverview');
    expect(source).toContain('Webhook posture is healthy');
    expect(source).toContain('Webhook attention is needed');
    expect(source).toContain('Best next step:');
    expect(source).toContain('Webhook coverage');
    expect(source).toContain('Attention needed');
    expect(source).toContain('Source wiring');
  });

  it('provides full CRUD and inspection flows for webhook triggers', () => {
    const source = readSource();
    expect(source).toContain('WebhookTriggerEditorDialog');
    expect(source).toContain('WebhookTriggerDeleteDialog');
    expect(source).toContain('WebhookTriggerInspectDialog');
    expect(source).toContain('createWebhookWorkItemTrigger');
    expect(source).toContain('updateWebhookWorkItemTrigger');
    expect(source).toContain('deleteWebhookWorkItemTrigger');
  });

  it('pre-scopes the editor to the owning project via defaultProjectId', () => {
    const source = readSource();
    expect(source).toContain('defaultProjectId={project.id}');
    expect(source).toContain('projectScoped');
  });

  it('provides toggle enable/disable for individual triggers', () => {
    const source = readSource();
    expect(source).toContain('toggleMutation');
    expect(source).toContain("is_active: isActive");
  });

  it('filters triggers to the current project', () => {
    const source = readSource();
    expect(source).toContain('trigger.project_id === project.id');
  });

  it('uses toast notifications for mutation outcomes', () => {
    const source = readSource();
    expect(source).toContain("toast.success('Webhook trigger created')");
    expect(source).toContain("toast.success('Webhook trigger updated')");
    expect(source).toContain("toast.success('Webhook trigger deleted')");
  });

  it('shows an empty state with a create action when no triggers exist', () => {
    const source = readSource();
    expect(source).toContain('No webhook triggers for this project');
    expect(source).toContain('Create first trigger');
  });

  it('keeps the trigger list focused on project-scoped actions instead of cross-page link clutter', () => {
    const source = readSource();
    expect(source).toContain('Current triggers');
    expect(source).toContain('Add trigger');
    expect(source).not.toContain('Inspect, edit, toggle, or remove inbound webhook rules for this project.');
    expect(source).not.toContain('Open trigger overview');
    expect(source).not.toContain('/config/triggers');
  });
});
