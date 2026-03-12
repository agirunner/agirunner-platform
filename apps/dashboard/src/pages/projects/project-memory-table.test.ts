import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './project-memory-table.tsx'), 'utf8');
}

describe('project memory table source', () => {
  it('uses typed inline editing for project memory values', () => {
    const source = readSource();
    expect(source).toContain('Value type');
    expect(source).toContain('Save Memory');
    expect(source).toContain('createMemoryEditorDraft');
    expect(source).toContain('parseMemoryEditorDraft');
    expect(source).toContain('SelectItem value="json"');
    expect(source).not.toContain('className="flex-1 font-mono text-xs"');
  });

  it('renders structured previews for complex memory payloads', () => {
    const source = readSource();
    expect(source).toContain('MemoryValuePreview');
    expect(source).toContain('Expand structured value');
    expect(source).toContain('StructuredRecordView');
  });
});
