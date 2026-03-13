import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(filename: string) {
  return readFileSync(resolve(import.meta.dirname, filename), 'utf8');
}

describe('project detail automation tab source', () => {
  it('uses delivery-oriented operator copy for project run history', () => {
    const source = readSource('./project-detail-page.tsx');
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
    const source = readSource('./project-detail-page.tsx');
    expect(source).toContain('TabsTrigger value="automation"');
    expect(source).toContain('<ScheduledTriggersCard project={project} />');
  });

  it('keeps git webhook management inside the project automation surface', () => {
    const source = readSource('./project-detail-page.tsx');
    const triggerSource = readSource('./project-scheduled-triggers-card.tsx');
    expect(source).toContain('<GitWebhookTab project={project} />');
    expect(triggerSource).toContain('Open trigger overview');
  });

  it('relabels scheduled trigger targeting around project runs instead of workflows', () => {
    const cardSource = readSource('./project-scheduled-triggers-card.tsx');
    const formSource = readSource('./project-scheduled-trigger-form.tsx');
    expect(cardSource).toContain('target a project run');
    expect(formSource).toContain('Create a project run before adding a scheduled trigger.');
    expect(formSource).toContain('label="Target run"');
    expect(formSource).toContain('placeholder="Select run"');
  });

  it('adds a model override tab with project override editing and resolved model display', () => {
    const source = readSource('./project-detail-page.tsx');
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
    const source = readSource('./project-detail-page.tsx');
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
    const triggerSource = readSource('./project-scheduled-triggers-card.tsx');
    const formSource = readSource('./project-scheduled-trigger-form.tsx');
    expect(triggerSource).toContain('dashboardApi.listRoleDefinitions()');
    expect(triggerSource).toContain('dashboardApi.getWorkflow(form.workflowId)');
    expect(triggerSource).toContain('dashboardApi.getWorkflowBoard(form.workflowId)');
    expect(formSource).toContain('label="Stage"');
    expect(formSource).toContain('label="Target board column"');
    expect(formSource).toContain('label="Owner role"');
  });

  it('uses typed memory entry controls instead of heuristic string-or-json parsing', () => {
    const source = readSource('./project-detail-page.tsx');
    expect(source).toContain("const [newValueType, setNewValueType] = useState<StructuredValueType>('string')");
    expect(source).toContain("buildStructuredObject(");
    expect(source).toContain('<label className="text-xs font-medium">Value Type</label>');
    expect(source).not.toContain('Value (string or JSON)');
  });

  it('adds a first-class artifacts tab for inline project-scoped inspection', () => {
    const source = readSource('./project-detail-page.tsx');
    expect(source).toContain('TabsTrigger value="artifacts">Artifacts</TabsTrigger>');
    expect(source).toContain('<ArtifactsTab projectId={project.id} />');
    expect(source).toContain('<ProjectArtifactExplorerPanel projectId={projectId} />');
  });
});
