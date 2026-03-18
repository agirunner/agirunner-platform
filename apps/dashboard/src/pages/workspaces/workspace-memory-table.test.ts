import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './workspace-memory-table.tsx'), 'utf8');
}

describe('workspace memory table source', () => {
  it('uses a compact stacked editor layout for workspace memory instead of the old table shell', () => {
    const source = readSource();

    expect(source).toContain('aria-label="Edit memory entry"');
    expect(source).toContain('aria-label="Delete memory entry"');
    expect(source).toContain('showLabel={false}');
    expect(source).toContain('createMemoryEditorDraft');
    expect(source).toContain('parseMemoryEditorDraft');
    expect(source).toContain('SelectItem value="json"');
    expect(source).not.toContain('<TableHeader>');
    expect(source).not.toContain('<TableBody>');
  });

  it('renders structured previews for complex memory payloads and keeps the type label inline with each entry', () => {
    const source = readSource();

    expect(source).toContain('MemoryValuePreview');
    expect(source).toContain('Expand structured value');
    expect(source).toContain('StructuredRecordView');
    expect(source).toContain('Type');
    expect(source).not.toContain('Badge variant="outline">{props.entry.scope}');
  });
});
