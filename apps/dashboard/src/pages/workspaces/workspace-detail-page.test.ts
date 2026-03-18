import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(filename: string) {
  return readFileSync(resolve(import.meta.dirname, filename), 'utf8');
}

describe('workspace detail workspace shell source', () => {
  it('uses delivery-oriented operator copy for workspace run history inside the delivery tab', () => {
    const source = readSource('./workspace-detail-page.tsx');
    const supportSource = readSource('./workspace-detail-support.ts');
    const deliverySource = readSource('./workspace-delivery-history.tsx');
    expect(supportSource).toContain("value: 'delivery'");
    expect(source).toContain('<WorkspaceDeliveryHistory workspaceId={workspace.id} />');
    expect(deliverySource).toContain('dashboardApi.getWorkspaceTimeline(workspaceId)');
    expect(deliverySource).toContain('buildWorkspaceDeliveryAttentionOverview');
    expect(deliverySource).toContain('buildWorkspaceDeliveryPacket');
    expect(deliverySource).toContain('Delivery Overview');
    expect(deliverySource).toContain('Workspace delivery timeline');
    expect(deliverySource).toContain('Recent Signals');
    expect(deliverySource).toContain('Run Cards');
    expect(deliverySource).toContain('Open board');
    expect(deliverySource).toContain('Open inspector');
    expect(deliverySource).not.toContain('In Development');
    expect(deliverySource).not.toContain('Workspace delivery is being rebuilt');
  });

  it('keeps an automation tab for scheduled work-item triggers', () => {
    const source = readSource('./workspace-detail-page.tsx');
    const supportSource = readSource('./workspace-detail-support.ts');
    const automationSource = [
      readSource('./workspace-automation-tab.tsx'),
      readSource('./workspace-webhook-triggers-card.tsx'),
      readSource('./workspace-git-webhook-signatures-card.tsx'),
    ].join('\n');
    expect(supportSource).toContain("value: 'automation'");
    expect(source).toContain('<WorkspaceAutomationTab workspace={workspace} />');
    expect(automationSource).toContain('<ScheduledTriggersCard workspace={workspace} />');
    expect(automationSource).toContain(
      'Use this only when GitHub, Gitea, or GitLab should be allowed to deliver signed inbound repository events for this workspace.',
    );
    expect(automationSource).not.toContain('Automation needs attention');
    expect(automationSource).not.toContain('Best next step:');
    expect(automationSource).not.toContain('Jump to schedules');
    expect(automationSource).not.toContain('Jump to webhook rules');
    expect(automationSource).not.toContain('Jump to repository signatures');
  });

  it('keeps git webhook management inside the workspace automation surface', () => {
    const automationSource = [
      readSource('./workspace-automation-tab.tsx'),
      readSource('./workspace-webhook-triggers-card.tsx'),
      readSource('./workspace-git-webhook-signatures-card.tsx'),
    ].join('\n');
    expect(automationSource).toContain('<WorkspaceGitWebhookSignaturesCard workspace={workspace} compact />');
    expect(automationSource).toContain('Git repository signatures');
  });

  it('relabels scheduled trigger targeting around workflows and removes operator-only schedule internals', () => {
    const formSource = readSource('./workspace-scheduled-trigger-form.tsx');
    expect(formSource).toContain('Create a target workflow before adding a scheduled trigger.');
    expect(formSource).toContain('label="Target workflow"');
    expect(formSource).toContain('placeholder="Select workflow"');
    expect(formSource).not.toContain('label="Source"');
  });

  it('rebuilds the top-level taxonomy around overview, settings, knowledge, automation, and delivery', () => {
    const source = readSource('./workspace-detail-page.tsx');
    const shellSource = readSource('./workspace-detail-shell.tsx');
    const supportSource = readSource('./workspace-detail-support.ts');
    expect(source).toContain("normalizeWorkspaceDetailTab(searchParams.get('tab'))");
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

  it('adds a settings shell that keeps workspace basics and repository control posture together', () => {
    const source = readSource('./workspace-detail-page.tsx');
    const supportSource = readSource('./workspace-detail-support.ts');
    const settingsShellSource = readSource('./workspace-settings-shell.tsx');
    const settingsTabSource = readSource('./workspace-settings-tab.tsx');
    expect(source).toContain('buildWorkspaceSettingsOverview(workspace)');
    expect(source).toContain('<WorkspaceSettingsTab workspace={workspace} overview={settingsOverview} />');
    expect(source).not.toContain('<WorkspaceSettingsShell');
    expect(settingsShellSource).toContain('Settings Control Plane');
    expect(settingsShellSource).toContain('props.overview.summary');
    expect(settingsShellSource).toContain('props.headerAction');
    expect(settingsShellSource).not.toContain('WorkspaceMetricCard');
    expect(settingsShellSource).not.toContain('props.overview.packets.map');
    expect(supportSource).toContain('Stored settings');
    expect(supportSource).toContain('Repository link');
    expect(supportSource).not.toContain('Repository trust');
    expect(settingsShellSource).not.toContain('Workspace Context');
    expect(settingsTabSource).toContain('<WorkspaceSettingsShell');
    expect(settingsTabSource).toContain('headerAction=');
    expect(settingsTabSource).toContain('<Save className="h-4 w-4" />');
  });

  it('nests workspace context and simplified knowledge editing under the knowledge shell instead of a top-level spec tab', () => {
    const source = readSource('./workspace-detail-page.tsx');
    const specSource = readSource('./workspace-spec-tab.tsx');
    const knowledgeTabSource = readSource('./workspace-knowledge-tab.tsx');
    const knowledgeSource = readSource('./workspace-knowledge-shell.tsx');
    const structuredEditorSource = readSource('./workspace-structured-entry-editor.tsx');
    expect(source).toContain('<WorkspaceKnowledgeTab workspaceId={workspace.id} overview={knowledgeOverview} />');
    expect(source).not.toContain('resourcesContent={<WorkspaceResourcesTab');
    expect(source).not.toContain('toolsContent={<WorkspaceToolsTab');
    expect(knowledgeSource).toContain("value: 'reference'");
    expect(specSource).toContain(
      "import { StructuredEntryEditor } from './workspace-structured-entry-editor.js';",
    );
    expect(specSource).toContain('Workspace Context');
    expect(specSource).toContain('Workspace Knowledge');
    expect(specSource).toContain('Key/Value pairs');
    expect(specSource).toContain('Use simple string or JSON values for reusable workspace knowledge.');
    expect(knowledgeTabSource).toContain('Save knowledge');
    expect(specSource).toContain('Add knowledge entry');
    expect(specSource).toContain('Edit curated workspace facts and policies as simple key/value entries');
    expect(specSource).toContain('workspace.settings.knowledge');
    expect(specSource).not.toContain('Workspace structure');
    expect(specSource).not.toContain('Start here');
    expect(knowledgeTabSource).toContain('dashboardApi.updateWorkspaceSpec(props.workspaceId, nextSpec)');
    expect(structuredEditorSource).toContain('allowedTypes?: StructuredValueType[]');
    expect(structuredEditorSource).toContain("allowedTypes ?? ['string', 'number', 'boolean', 'json']");
    expect(structuredEditorSource).toContain('formatStructuredTypeLabel(type)');
    expect(structuredEditorSource).toContain('Remove entry');
    expect(specSource).not.toContain('Save (read-only)');
  });

  it('uses bounded workflow stage and role options in the automation form when they are available', () => {
    const triggerSource = readSource('./workspace-scheduled-triggers-card.tsx');
    const formSource = readSource('./workspace-scheduled-trigger-form.tsx');
    expect(triggerSource).toContain('dashboardApi.getWorkflow(form.workflowId)');
    expect(triggerSource).toContain('dashboardApi.getWorkflowBoard(form.workflowId)');
    expect(formSource).toContain('label="Target workflow"');
    expect(formSource).toContain('label="Schedule type"');
    expect(formSource).toContain('label="Stage"');
    expect(formSource).toContain('label="Target board column"');
    expect(formSource).not.toContain('label="Source"');
    expect(formSource).not.toContain('label="Owner role"');
  });

  it('keeps typed memory and artifacts accessible from the knowledge shell', () => {
    const source = readSource('./workspace-detail-page.tsx');
    const knowledgeTabSource = readSource('./workspace-knowledge-tab.tsx');
    const memorySource = readSource('./workspace-detail-memory-tab.tsx');
    const knowledgeSource = readSource('./workspace-knowledge-shell.tsx');
    const artifactSource = readSource('./workspace-artifact-files-panel.tsx');
    expect(knowledgeTabSource).toContain('<WorkspaceDetailMemoryTab');
    expect(knowledgeTabSource).toContain('<WorkspaceArtifactFilesPanel workspaceId={props.workspaceId} />');
    expect(source).not.toContain('<WorkspaceArtifactExplorerPanel workspaceId={workspace.id} />');
    expect(knowledgeSource).not.toContain('Open documents');
    expect(knowledgeSource).not.toContain('Open memory explorer');
    expect(knowledgeSource).not.toContain('Open artifact explorer');
    expect(knowledgeSource).toContain("label: 'Workspace Artifacts'");
    expect(knowledgeTabSource).toContain('artifactContent=');
    expect(knowledgeSource).toContain("value: 'memory'");
    expect(knowledgeSource).toContain("value: 'artifacts'");
    expect(memorySource).toContain('StructuredEntryEditor');
    expect(memorySource).toContain("allowedTypes={['string', 'json']}");
    expect(memorySource).toContain('Memory is for evolving notes and learned state.');
    expect(memorySource).toContain('Existing memory entries stay editable here and save with the rest of the Knowledge tab.');
    expect(artifactSource).toContain('Upload workspace artifacts');
    expect(artifactSource).toContain('Add files');
    expect(artifactSource).toContain('Delete file');
  });

  it('replaces the old artifacts tab with overview and knowledge-only run-content actions', () => {
    const source = readSource('./workspace-detail-page.tsx');
    const knowledgeTabSource = readSource('./workspace-knowledge-tab.tsx');
    const knowledgeSource = readSource('./workspace-knowledge-shell.tsx');
    const overviewSource = readSource('./workspace-overview-shell.tsx');
    expect(source).toContain('<WorkspaceOverviewShell');
    expect(knowledgeSource).toContain("label: 'Workspace Artifacts'");
    expect(overviewSource).not.toContain('Artifact explorer');
    expect(knowledgeTabSource).toContain('<WorkspaceArtifactFilesPanel workspaceId={props.workspaceId} />');
  });

  it('trims knowledge quick actions so mobile headers stop competing with the embedded management surfaces', () => {
    const source = readSource('./workspace-detail-page.tsx');

    expect(source).toContain('const baseHeaderState = buildWorkspaceDetailHeaderState(workspace, activeTab);');
    expect(source).toContain("activeTab === 'knowledge'");
    expect(source).toContain('quickActions: []');
  });

  it('adds overview, settings, and knowledge shell components to reorganize the workspace', () => {
    const source = readSource('./workspace-detail-page.tsx');
    const shellSource = readSource('./workspace-detail-shell.tsx');
    const supportSource = readSource('./workspace-detail-support.ts');
    expect(source).toContain("import { WorkspaceDetailShell } from './workspace-detail-shell.js';");
    expect(source).toContain('<WorkspaceDetailShell');
    expect(source).toContain("import { WorkspaceKnowledgeTab } from './workspace-knowledge-tab.js';");
    expect(source).toContain("import { WorkspaceSettingsTab } from './workspace-settings-tab.js';");
    expect(source).toContain("import { WorkspaceAutomationTab } from './workspace-automation-tab.js';");
    expect(source).toContain('buildWorkspaceDetailHeaderState(workspace, activeTab)');
    expect(source).toContain('buildWorkspaceOverview(workspace, workspaceSpecQuery.data)');
    expect(source).toContain('buildWorkspaceKnowledgeOverview(workspace, workspaceSpecQuery.data)');
    expect(source).toContain('buildWorkspaceSettingsOverview(workspace)');
    expect(source).not.toContain("headerState.mode === 'expanded'");
    expect(source).not.toContain('headerState.activeTab.label');
    expect(source).not.toContain('headerState.quickActions.map((action)');
    expect(source).not.toContain('<TabsContent value="overview">');
    expect(shellSource).toContain("headerState.mode === 'expanded'");
    expect(shellSource).toContain('headerState.activeTab.label');
    expect(shellSource).toContain('headerState.quickActions.map((action)');
    expect(supportSource).toContain('Knowledge base');
    expect(source).not.toContain('WorkspaceWorkspaceTabIcon');
    expect(source).not.toContain('activeTabOption.description');
    expect(source).not.toContain('Open memory workspace');
    expect(source).not.toContain('Open artifact workspace');
    expect(shellSource).toContain('sm:hidden');
  });
});
