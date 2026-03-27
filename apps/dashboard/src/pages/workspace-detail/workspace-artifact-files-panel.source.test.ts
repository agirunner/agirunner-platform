import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './workspace-artifact-files-panel.tsx'), 'utf8');
}

describe('workspace artifact files panel source', () => {
  it('uploads files immediately after selection without a manual upload queue', () => {
    const source = readSource();

    expect(source).toContain('uploadMutation.mutate(selectedFiles);');
    expect(source).not.toContain('Upload files');
    expect(source).not.toContain('No files queued yet.');
  });

  it('keeps the add-files trigger inside the workspace artifacts section', () => {
    const source = readSource();

    expect(source).toContain('Add files');
    expect(source).not.toContain('Upload workspace artifacts');
    expect(source).not.toContain('Upload workspace files here.');
    expect(source).not.toContain('Curated workspace-owned files stay here.');
    expect(source).not.toContain(
      '<h3 className="text-base font-semibold text-foreground">Workspace artifacts</h3>',
    );
  });

  it('offers a direct download action for each uploaded workspace artifact', () => {
    const source = readSource();

    expect(source).toContain('Download file');
    expect(source).toContain('dashboardApi.downloadWorkspaceArtifactFile');
    expect(source).toContain('URL.createObjectURL(download.blob)');
    expect(source).toContain('link.download = download.file_name ?? file.file_name;');
  });

  it('drops the redundant inline upload guidance once the outer knowledge summary owns the description', () => {
    const source = readSource();

    expect(source).not.toContain('Files upload as soon as you select them.');
    expect(source).not.toContain('lg:whitespace-nowrap');
  });
});
