import { describe, expect, it } from 'vitest';

import { snapshotSelectedFiles } from './project-artifact-files-panel.js';

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
