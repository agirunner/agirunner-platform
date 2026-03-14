import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(file: string) {
  return readFileSync(resolve(import.meta.dirname, file), 'utf8');
}

describe('project content tables source', () => {
  it('uses responsive packets for workflow documents instead of a desktop-only table', () => {
    const tablesSource = readSource('./project-content-tables.tsx');
    const recordsSource = readSource('./project-content-document-records.tsx');
    expect(tablesSource).toContain('lg:hidden');
    expect(tablesSource).toContain('hidden overflow-x-auto lg:block');
    expect(tablesSource).toContain('DocumentDesktopRow');
    expect(recordsSource).toContain('activeLogicalName');
    expect(recordsSource).toContain('deletingLogicalName');
    expect(recordsSource).toContain('Source packet');
    expect(recordsSource).toContain('Editing');
    expect(recordsSource).toContain('Delete');
  });

  it('keeps artifacts operator-managed with responsive cards and delivery packets', () => {
    const tablesSource = readSource('./project-content-tables.tsx');
    const recordsSource = readSource('./project-content-artifact-records.tsx');
    expect(tablesSource).toContain('ArtifactDesktopRow');
    expect(tablesSource).toContain('buildPreviewHref');
    expect(recordsSource).toContain('previewHref?: string');
    expect(recordsSource).toContain('onDelete?(artifact: DashboardTaskArtifactRecord)');
    expect(recordsSource).toContain('deletingArtifactId');
    expect(recordsSource).toContain('Delivery packet');
    expect(recordsSource).toContain('Open task');
    expect(recordsSource).toContain('Download');
    expect(recordsSource).toContain('Delete');
  });
});
