import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './project-detail-page.tsx'), 'utf8');
}

describe('project detail automation tab source', () => {
  it('uses delivery-oriented operator copy for project run history', () => {
    const source = readSource();
    expect(source).toContain('TabsTrigger value="timeline">Delivery</TabsTrigger>');
    expect(source).toContain('No delivery history for this project yet.');
    expect(source).toContain('Failed to load delivery history.');
    expect(source).toContain('describeDeliveryEntry(entry)');
    expect(source).toContain('Run summary available. Open the run for stage and gate detail.');
    expect(source).toContain('Stages ${completed}/${progression.length}');
    expect(source).toContain('Work items ${total - open}/${total}');
    expect(source).toContain('Gates waiting ${waiting}');
    expect(source).toContain('summarizeOrchestratorAnalytics(entry.orchestrator_analytics)');
    expect(source).toContain('Activations ${activationCount}');
    expect(source).toContain('Reworked tasks ${reworkedTaskCount}');
    expect(source).toContain('Stale recoveries ${staleDetections}');
    expect(source).toContain('Cost $${totalCostUsd.toFixed(2)}');
    expect(source).toContain('Artifacts ${count}');
  });

  it('adds an automation tab for scheduled work-item triggers', () => {
    const source = readSource();
    expect(source).toContain('TabsTrigger value="automation"');
    expect(source).toContain('Scheduled Work Item Triggers');
    expect(source).toContain('dashboardApi.listScheduledWorkItemTriggers()');
    expect(source).toContain("dashboardApi.listWorkflows({ project_id: project.id, per_page: '100' })");
  });

  it('keeps git webhook management inside the project automation surface', () => {
    const source = readSource();
    expect(source).toContain('<GitWebhookTab project={project} />');
    expect(source).toContain('Open trigger overview');
  });

  it('relabels scheduled trigger targeting around project runs instead of workflows', () => {
    const source = readSource();
    expect(source).toContain('target a project run');
    expect(source).toContain('<TableHead>Target Run</TableHead>');
    expect(source).toContain('Create a project run before adding a scheduled trigger.');
    expect(source).toContain('<label className="text-xs font-medium">Target Run</label>');
    expect(source).toContain('<option value="">Select run</option>');
  });

  it('adds a model override tab with project override editing and resolved model display', () => {
    const source = readSource();
    expect(source).toContain('TabsTrigger value="models"');
    expect(source).toContain('Project Model Overrides');
    expect(source).toContain('dashboardApi.getProjectModelOverrides(project.id)');
    expect(source).toContain('dashboardApi.getResolvedProjectModels(project.id)');
    expect(source).toContain('dashboardApi.listLlmProviders()');
    expect(source).toContain('dashboardApi.listLlmModels()');
    expect(source).toContain('dashboardApi.patchProject(project.id, {');
    expect(source).toContain('Resolved Effective Models');
    expect(source).toContain('<RoleOverrideEditor');
    expect(source).not.toContain('Project model overrides must be valid JSON');
  });

  it('replaces raw project spec JSON editing with structured spec/config/instruction editors', () => {
    const source = readSource();
    expect(source).toContain('Save Spec');
    expect(source).toContain('Config Entries');
    expect(source).toContain('Instruction Entries');
    expect(source).toContain('Resource Entries');
    expect(source).toContain('Document Entries');
    expect(source).toContain('Tool Entries');
    expect(source).toContain('Edit project configuration as structured key/value entries');
    expect(source).toContain('Edit structured project instructions and document references');
    expect(source).toContain('dashboardApi.updateProjectSpec(projectId, nextSpec)');
    expect(source).not.toContain('Save (read-only)');
  });

  it('uses bounded workflow stage and role options in the automation form when they are available', () => {
    const source = readSource();
    expect(source).toContain('dashboardApi.listRoleDefinitions()');
    expect(source).toContain('dashboardApi.getWorkflow(form.workflowId)');
    expect(source).toContain('<option value="">Select stage</option>');
    expect(source).toContain('<option value="">Select role</option>');
  });
});
