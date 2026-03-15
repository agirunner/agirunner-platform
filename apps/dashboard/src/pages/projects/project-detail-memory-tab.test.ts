import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './project-detail-memory-tab.tsx'), 'utf8');
}

describe('project detail memory tab source', () => {
  it('uses the same structured draft editor pattern as project knowledge and saves through the parent tab action', () => {
    const source = readSource();

    expect(source).toContain("import { StructuredEntryEditor } from './project-structured-entry-editor.js';");
    expect(source).toContain('Project Memory');
    expect(source).toContain('Key/Value pairs');
    expect(source).toContain('Add memory entry');
    expect(source).toContain("allowedTypes={['string', 'json']}");
    expect(source).toContain('pageSize={10}');
    expect(source).not.toContain('dashboardApi.patchProjectMemory');
    expect(source).not.toContain('ProjectMemoryTable');
  });

  it('explains that project memory is editable in place and saved with the rest of the knowledge tab', () => {
    const source = readSource();

    expect(source).toContain('Existing memory entries stay editable here and save with the rest of the Knowledge tab.');
    expect(source).toContain('Memory is for evolving notes and learned state.');
    expect(source).toContain('Use string or JSON values for project memory.');
    expect(source).not.toContain('Failed to save project memory.');
  });
});
