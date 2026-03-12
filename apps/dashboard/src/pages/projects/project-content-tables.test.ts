import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './project-content-tables.tsx'), 'utf8');
}

describe('project content tables source', () => {
  it('promotes workflow documents from browse-only rows to managed actions', () => {
    const source = readSource();
    expect(source).toContain('activeLogicalName');
    expect(source).toContain('deletingLogicalName');
    expect(source).toContain('onEdit?(document: DashboardResolvedDocumentReference)');
    expect(source).toContain('onDelete?(document: DashboardResolvedDocumentReference)');
    expect(source).toContain('Editing');
    expect(source).toContain('Delete');
  });

  it('promotes artifacts into a managed surface with download and delete actions', () => {
    const source = readSource();
    expect(source).toContain('onDelete?(artifact: DashboardTaskArtifactRecord)');
    expect(source).toContain('deletingArtifactId');
    expect(source).toContain('Download');
    expect(source).toContain('Delete');
  });
});
