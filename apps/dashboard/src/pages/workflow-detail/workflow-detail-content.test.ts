import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(
    resolve(import.meta.dirname, './workflow-detail-content.tsx'),
    'utf8',
  );
}

describe('workflow detail content source', () => {
  it('renders documents and memory through design-system cards and controls', () => {
    const source = readSource();
    expect(source).toContain('CardHeader');
    expect(source).toContain('CardContent');
    expect(source).toContain('CardTitle');
    expect(source).toContain('CardDescription');
    expect(source).toContain('Badge');
    expect(source).toContain('Button');
    expect(source).toContain('Input');
    expect(source).toContain('Textarea');
    expect(source).toContain('SelectTrigger');
    expect(source).toContain('ChainStructuredEntryEditor');
    expect(source).toContain('DocumentCard');
    expect(source).toContain('DocumentMetadataEntryEditor');
    expect(source).toContain('WorkspaceMemoryEntryCard');
    expect(source).toContain('ContentEmptyState');
    expect(source).toContain('describeWorkspaceMemoryEntry');
    expect(source).toContain('dashboardApi.createWorkflowDocument');
    expect(source).toContain('dashboardApi.updateWorkflowDocument');
    expect(source).toContain('dashboardApi.deleteWorkflowDocument');
    expect(source).toContain('SurfaceMessage');
    expect(source).toContain('MemoryDraftPreview');
    expect(source).toContain('Structured preview');
    expect(source).toContain('Add memory field');
    expect(source).toContain('Document Operator Controls');
    expect(source).toContain('Create Workflow Document');
    expect(source).toContain('Save Document Changes');
    expect(source).toContain('Delete Reference');
    expect(source).toContain('Confirm Delete');
    expect(source).toContain('WorkflowSurfaceRecoveryState');
    expect(source).toContain('WorkflowClosureCalloutsCard');
    expect(source).toContain('Closure Callouts');
    expect(source).toContain('Good enough closure recorded');
    expect(source).toContain('Residual risks');
    expect(source).toContain('Unresolved advisory items');
    expect(source).toContain('No closure callouts are recorded on this workflow yet.');
    expect(source).toContain('Workflow documents are unavailable');
    expect(source).toContain('Retry documents');
    expect(source).toContain('Reference library empty');
    expect(source).toContain('No shared handoff notes');
    expect(source).toContain('Task linkage');
    expect(source).toContain('Operator-ready facts');
    expect(source).toContain('Open full memory packet');
    expect(source).toContain('Reference packet facts');
    expect(source).toContain('Metadata facts');
    expect(source).toContain('Preview Artifact Packet');
    expect(source).toContain('Open Linked Step');
    expect(source).toContain('FactGrid');
    expect(source).toContain("from './workflow-detail-document-support.js'");
    expect(source).toContain('validateWorkflowDocumentDraft');
    expect(source).toContain('buildWorkflowDocumentCreatePayload');
    expect(source).toContain('buildWorkflowDocumentUpdatePayload');
    expect(source).toContain('This removes the workflow reference packet. Artifact files stay intact.');
    expect(source).not.toContain('Enter an object-shaped JSON payload.');
  });

  it('does not use the legacy semantic card, badge, or form classes', () => {
    const source = readSource();
    expect(source).not.toContain('className="card"');
    expect(source).not.toContain('className="status-badge"');
    expect(source).not.toContain('className="input"');
    expect(source).not.toContain('className="button"');
    expect(source).not.toContain('className="muted"');
  });
});
