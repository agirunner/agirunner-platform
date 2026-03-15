import { describe, expect, it } from 'vitest';

import {
  buildArtifactUploadPayloads,
  snapshotSelectedFiles,
} from './project-artifact-files-panel.js';

describe('project artifact file selection helpers', () => {
  it('freezes selected files before the input is cleared', () => {
    const retainedFiles = [
      new File(['brief'], 'brief.md', { type: 'text/markdown' }),
      new File(['notes'], 'notes.txt', { type: 'text/plain' }),
    ];
    const liveSelection = createMutableFileList(retainedFiles);

    const frozen = snapshotSelectedFiles(liveSelection as FileList);
    retainedFiles.splice(0, retainedFiles.length);

    expect(frozen.map((file) => file.name)).toEqual(['brief.md', 'notes.txt']);
  });

  it('builds upload payloads immediately from selected files using filename keys', async () => {
    const files = [
      new File(['# Brief'], 'brief.md', { type: 'text/markdown' }),
      new File(['first'], 'brief.md', { type: 'text/markdown' }),
      new File(['diagram'], 'system design.png', { type: 'image/png' }),
    ];

    const payloads = await buildArtifactUploadPayloads(files, ['brief-md']);

    expect(payloads.map((entry) => entry.key)).toEqual([
      'brief-md-2',
      'brief-md-3',
      'system-design-png',
    ]);
    expect(payloads.map((entry) => entry.description)).toEqual(['', '', '']);
    expect(payloads.map((entry) => entry.file_name)).toEqual([
      'brief.md',
      'brief.md',
      'system design.png',
    ]);
  });
});

function createMutableFileList(files: File[]): Pick<FileList, 'length' | 'item'> {
  return {
    get length() {
      return files.length;
    },
    item(index: number) {
      return files[index] ?? null;
    },
  };
}
