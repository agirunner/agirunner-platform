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

  it('offers a direct download action for each uploaded workspace artifact', () => {
    const source = readSource();

    expect(source).toContain('Download file');
    expect(source).toContain('dashboardApi.downloadWorkspaceArtifactFile');
    expect(source).toContain('URL.createObjectURL(download.blob)');
    expect(source).toContain('link.download = download.file_name ?? file.file_name;');
  });

  it('keeps the upload guidance sentence on one line on desktop widths', () => {
    const source = readSource();

    expect(source).toContain('lg:whitespace-nowrap');
    expect(source).not.toContain('max-w-3xl text-sm leading-6 text-muted');
  });
});
