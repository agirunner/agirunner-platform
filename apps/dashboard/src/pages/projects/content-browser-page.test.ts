import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './content-browser-page.tsx'), 'utf8');
}

describe('content browser page source', () => {
  it('uses deep-linkable workflow, work item, task, and tab filters', () => {
    const source = readSource();
    expect(source).toContain('useSearchParams');
    expect(source).toContain("searchParams.get('project')");
    expect(source).toContain("next.set('workflow'");
    expect(source).toContain("next.set('work_item'");
    expect(source).toContain("next.set('task'");
    expect(source).toContain("next.set('tab'");
  });

  it('surfaces workflow and work-item scoped execution browsing', () => {
    const source = readSource();
    expect(source).toContain('listWorkflowWorkItems');
    expect(source).toContain('Execution Scope');
    expect(source).toContain('Execution target');
    expect(source).toContain('Upload readiness');
    expect(source).toContain('Work item');
    expect(source).toContain('filterTasksByWorkItem');
  });

  it('adds first-class workflow document and artifact operator controls', () => {
    const source = readSource();
    expect(source).toContain('Document Operator Controls');
    expect(source).toContain('Artifact Operator Controls');
    expect(source).toContain('ContentBrowserOverview');
    expect(source).toContain('MetadataEntryEditor');
    expect(source).toContain('Add metadata entry');
    expect(source).not.toContain('Metadata (JSON)');
    expect(source).toContain('createWorkflowDocument');
    expect(source).toContain('updateWorkflowDocument');
    expect(source).toContain('deleteWorkflowDocument');
    expect(source).toContain('uploadTaskArtifact');
    expect(source).toContain('deleteTaskArtifact');
    expect(source).toContain('Create Workflow Document');
    expect(source).toContain('Save Document Changes');
    expect(source).toContain('Upload Artifact');
    expect(source).toContain('Current execution packet');
    expect(source).toContain('Operator flow');
    expect(source).toContain('Remove entry');
  });

  it('uses structured task and artifact selectors for artifact-backed documents', () => {
    const source = readSource();
    expect(source).toContain('document-artifact-options');
    expect(source).toContain('Select a source task');
    expect(source).toContain('Select an artifact');
    expect(source).toContain('Auto-filled from the selected artifact');
    expect(source).toContain('SelectItem value="json">JSON object');
    expect(source).not.toContain('<select');
    expect(source).not.toContain('placeholder="Task UUID"');
    expect(source).not.toContain('placeholder="Artifact UUID"');
  });

  it('supports project-scoped content and artifact explorer routes', () => {
    const source = readSource();
    expect(source).toContain('scopedProjectId');
    expect(source).toContain('preferredTab');
    expect(source).toContain('const isEmbedded = props.showHeader === false || scopedProjectId.length > 0 || scopedWorkflowId.length > 0;');
    expect(source).toContain('const activeTab = isEmbedded ? preferredTab : searchParams.get(\'tab\') === \'artifacts\' ? \'artifacts\' : preferredTab;');
    expect(source).toContain('if (isEmbedded) {');
    expect(source).toContain('return;');
    expect(source).toContain('Project Documents');
    expect(source).toContain('Project documents');
    expect(source).toContain('Back to Project');
    expect(source).toContain('Select a task to unlock artifact management');
    expect(source).toContain('returnSource: \'project-content\'');
    expect(source).toContain('artifactPreviewReturnPath');
  });

  it('normalizes project, document, and artifact payloads before rendering selector and table content', () => {
    const source = readSource();
    expect(source).toContain('normalizeProjectList(projectsQuery.data)');
    expect(source).toContain('normalizeDocumentRecords(documentsQuery.data)');
    expect(source).toContain('normalizeArtifactRecords(artifactsQuery.data)');
    expect(source).toContain('normalizeArtifactRecords(documentArtifactOptionsQuery.data)');
  });
});
