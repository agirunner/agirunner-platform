import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(filename: string) {
  return readFileSync(resolve(import.meta.dirname, filename), 'utf8');
}

describe('project detail workspace shell source', () => {
  it('uses delivery-oriented operator copy for project run history inside the delivery tab', () => {
    const source = readSource('./project-detail-page.tsx');
    const supportSource = readSource('./project-detail-support.ts');
    const deliverySource = [
      readSource('./project-delivery-history.tsx'),
      readSource('./project-delivery-history-support.ts'),
    ].join('\n');
    expect(supportSource).toContain("value: 'delivery'");
    expect(source).toContain('<ProjectDeliveryHistory projectId={project.id} />');
    expect(deliverySource).toContain('Delivery overview');
    expect(deliverySource).toContain('buildProjectDeliveryAttentionOverview');
    expect(deliverySource).toContain('What ran');
    expect(deliverySource).toContain('Needs attention');
    expect(deliverySource).toContain('Inspect next');
    expect(deliverySource).toContain('Failed to load delivery history.');
    expect(deliverySource).toContain('No delivery history yet');
    expect(deliverySource).toContain('Open board');
    expect(deliverySource).toContain('Open inspector');
  });

  it('keeps an automation tab for scheduled work-item triggers', () => {
    const source = readSource('./project-detail-page.tsx');
    const supportSource = readSource('./project-detail-support.ts');
    const automationSource = [
      readSource('./project-automation-tab.tsx'),
      readSource('./project-automation-tab.support.ts'),
    ].join('\n');
    expect(supportSource).toContain("value: 'automation'");
    expect(source).toContain('<ProjectAutomationTab project={project} />');
    expect(automationSource).toContain('<ScheduledTriggersCard project={project} />');
    expect(automationSource).toContain('buildProjectAutomationOverview');
    expect(automationSource).toContain('Repository signatures are optional until this project uses source-driven automation.');
    expect(automationSource).toContain('Active now');
    expect(automationSource).toContain('Broken');
    expect(automationSource).toContain('Setup needed');
    expect(automationSource).not.toContain('Jump to schedules');
    expect(automationSource).not.toContain('Jump to webhook rules');
    expect(automationSource).not.toContain('Jump to repository signatures');
  });

  it('keeps git webhook management inside the project automation surface', () => {
    const automationSource = readSource('./project-automation-tab.tsx');
    expect(automationSource).toContain('<GitWebhookTab project={project} />');
    expect(automationSource).toContain('Repository signatures');
  });

  it('relabels scheduled trigger targeting around project runs instead of workflows', () => {
    const formSource = readSource('./project-scheduled-trigger-form.tsx');
    expect(formSource).toContain('Create a project run before adding a scheduled trigger.');
    expect(formSource).toContain('label="Target run"');
    expect(formSource).toContain('placeholder="Select run"');
  });

  it('rebuilds the top-level taxonomy around overview, settings, knowledge, automation, and delivery', () => {
    const source = readSource('./project-detail-page.tsx');
    const shellSource = readSource('./project-detail-shell.tsx');
    const supportSource = readSource('./project-detail-support.ts');
    expect(source).toContain("normalizeProjectDetailTab(searchParams.get('tab'))");
    expect(supportSource).toContain("value: 'overview'");
    expect(supportSource).toContain("value: 'settings'");
    expect(supportSource).toContain("value: 'knowledge'");
    expect(supportSource).toContain("value: 'automation'");
    expect(supportSource).toContain("value: 'delivery'");
    expect(shellSource).toContain('<TabsContent value="overview">');
    expect(shellSource).toContain('<TabsContent value="settings">');
    expect(shellSource).toContain('<TabsContent value="knowledge">');
    expect(shellSource).toContain('<TabsContent value="automation">');
    expect(shellSource).toContain('<TabsContent value="delivery">');
    expect(source).not.toContain('<TabsContent value="spec">');
    expect(source).not.toContain('<TabsContent value="resources">');
    expect(source).not.toContain('<TabsContent value="tools">');
    expect(source).not.toContain('<TabsContent value="memory">');
    expect(source).not.toContain('<TabsContent value="artifacts">');
    expect(source).not.toContain('<TabsContent value="models">');
  });

  it('adds a settings shell that keeps project basics and repository control posture together', () => {
    const source = readSource('./project-detail-page.tsx');
    const supportSource = readSource('./project-detail-support.ts');
    const settingsShellSource = readSource('./project-settings-shell.tsx');
    expect(source).toContain('<ProjectSettingsShell');
    expect(source).toContain('buildProjectSettingsOverview(project)');
    expect(source).toContain('<ProjectSettingsTab project={project} />');
    expect(settingsShellSource).toContain('Settings control plane');
    expect(settingsShellSource).toContain('props.overview.summary');
    expect(settingsShellSource).not.toContain('WorkspaceMetricCard');
    expect(settingsShellSource).not.toContain('props.overview.packets.map');
    expect(supportSource).toContain('Stored settings');
    expect(supportSource).toContain('Repository link');
    expect(supportSource).not.toContain('Repository trust');
    expect(settingsShellSource).not.toContain('Project Context');
  });

  it('nests project context and simplified knowledge editing under the knowledge shell instead of a top-level spec tab', () => {
    const source = readSource('./project-detail-page.tsx');
    const specSource = readSource('./project-spec-tab.tsx');
    const knowledgeSource = readSource('./project-knowledge-shell.tsx');
    const structuredEditorSource = readSource('./project-structured-entry-editor.tsx');
    expect(source).toContain('<ProjectKnowledgeShell');
    expect(source).toContain('referenceContent={<ProjectSpecTab projectId={project.id} />}');
    expect(source).not.toContain('resourcesContent={<ProjectResourcesTab');
    expect(source).not.toContain('toolsContent={<ProjectToolsTab');
    expect(knowledgeSource).toContain("value: 'reference'");
    expect(specSource).toContain(
      "import { StructuredEntryEditor } from './project-structured-entry-editor.js';",
    );
    expect(specSource).toContain('Project Context');
    expect(specSource).toContain('Project knowledge');
    expect(specSource).toContain('Only string and JSON values are supported here.');
    expect(specSource).toContain('Save Knowledge');
    expect(specSource).toContain('Add knowledge entry');
    expect(specSource).toContain('Edit curated project facts and policies as simple key/value entries');
    expect(specSource).not.toContain('Workspace structure');
    expect(specSource).not.toContain('Start here');
    expect(specSource).toContain('dashboardApi.updateProjectSpec(projectId, nextSpec)');
    expect(structuredEditorSource).toContain('allowedTypes?: StructuredValueType[]');
    expect(structuredEditorSource).toContain("allowedTypes ?? ['string', 'number', 'boolean', 'json']");
    expect(structuredEditorSource).toContain('formatStructuredTypeLabel(type)');
    expect(structuredEditorSource).toContain('Remove entry');
    expect(specSource).not.toContain('Save (read-only)');
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

  it('keeps typed memory and artifacts accessible from the knowledge shell', () => {
    const source = readSource('./project-detail-page.tsx');
    const memorySource = readSource('./project-detail-memory-tab.tsx');
    const knowledgeSource = readSource('./project-knowledge-shell.tsx');
    const contentSource = readSource('./content-browser-page.tsx');
    expect(source).toContain('<ProjectDetailMemoryTab projectId={project.id} />');
    expect(source).toContain(
      '<ContentBrowserSurface scopedProjectId={project.id} preferredTab="documents" showHeader={false} />',
    );
    expect(source).not.toContain('<ProjectArtifactExplorerPanel projectId={project.id} />');
    expect(knowledgeSource).not.toContain('Open documents');
    expect(knowledgeSource).not.toContain('Open memory explorer');
    expect(knowledgeSource).not.toContain('Open artifact explorer');
    expect(knowledgeSource).toContain("label: 'Run content'");
    expect(knowledgeSource).toContain("value: 'memory'");
    expect(knowledgeSource).toContain("value: 'runContent'");
    expect(memorySource).toContain('ProjectMemoryTable');
    expect(memorySource).toContain('MemoryEditor');
    expect(memorySource).toContain('Choose a different key.');
    expect(memorySource).toContain('Memory is for evolving notes and learned state.');
    expect(memorySource).not.toContain('<select');
    expect(contentSource).toContain('Document Operator Controls');
    expect(contentSource).toContain('Artifact Operator Controls');
  });

  it('replaces the old artifacts tab with overview and knowledge-only run-content actions', () => {
    const source = readSource('./project-detail-page.tsx');
    const knowledgeSource = readSource('./project-knowledge-shell.tsx');
    const overviewSource = readSource('./project-overview-shell.tsx');
    expect(source).toContain('<ProjectOverviewShell');
    expect(knowledgeSource).toContain("label: 'Run content'");
    expect(overviewSource).not.toContain('Artifact explorer');
    expect(source).toContain(
      '<ContentBrowserSurface scopedProjectId={project.id} preferredTab="documents" showHeader={false} />',
    );
  });

  it('trims knowledge quick actions so mobile headers stop competing with the embedded management surfaces', () => {
    const source = readSource('./project-detail-page.tsx');

    expect(source).toContain('const baseHeaderState = buildProjectDetailHeaderState(project, activeTab);');
    expect(source).toContain("activeTab === 'knowledge'");
    expect(source).toContain('quickActions: []');
  });

  it('adds overview, settings, and knowledge shell components to reorganize the workspace', () => {
    const source = readSource('./project-detail-page.tsx');
    const shellSource = readSource('./project-detail-shell.tsx');
    const supportSource = readSource('./project-detail-support.ts');
    expect(source).toContain("import { ProjectDetailShell } from './project-detail-shell.js';");
    expect(source).toContain('<ProjectDetailShell');
    expect(source).toContain("import { ProjectSpecTab } from './project-spec-tab.js';");
    expect(source).toContain("import { ProjectSettingsTab } from './project-settings-tab.js';");
    expect(source).toContain("import { ProjectAutomationTab } from './project-automation-tab.js';");
    expect(source).toContain('buildProjectDetailHeaderState(project, activeTab)');
    expect(source).toContain('buildProjectWorkspaceOverview(project, projectSpecQuery.data)');
    expect(source).toContain('buildProjectKnowledgeOverview(project, projectSpecQuery.data)');
    expect(source).toContain('buildProjectSettingsOverview(project)');
    expect(source).not.toContain("headerState.mode === 'expanded'");
    expect(source).not.toContain('headerState.activeTab.label');
    expect(source).not.toContain('headerState.quickActions.map((action)');
    expect(source).not.toContain('<TabsContent value="overview">');
    expect(shellSource).toContain("headerState.mode === 'expanded'");
    expect(shellSource).toContain('headerState.activeTab.label');
    expect(shellSource).toContain('headerState.quickActions.map((action)');
    expect(supportSource).toContain('Knowledge base');
    expect(source).not.toContain('ProjectWorkspaceTabIcon');
    expect(source).not.toContain('activeTabOption.description');
    expect(source).not.toContain('Open memory workspace');
    expect(source).not.toContain('Open artifact workspace');
    expect(shellSource).toContain('sm:hidden');
  });
});
