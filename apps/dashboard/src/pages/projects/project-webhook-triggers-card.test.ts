import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './project-webhook-triggers-card.tsx'), 'utf8');
}

describe('project webhook triggers card source', () => {
  it('keeps the trigger surface focused on the live list and editor instead of duplicate posture summaries', () => {
    const source = readSource();
    expect(source).not.toContain('buildWebhookTriggerOverview');
    expect(source).not.toContain('Webhook posture is healthy');
    expect(source).not.toContain('Webhook attention is needed');
    expect(source).not.toContain('Best next step:');
    expect(source).toContain('Current triggers');
    expect(source).toContain('Add trigger');
    expect(source).toContain("const [isExpanded, setExpanded] = useState(false)");
    expect(source).toContain('Open hooks');
    expect(source).toContain('Hide hooks');
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
