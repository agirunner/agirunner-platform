import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(filename: string) {
  return readFileSync(resolve(import.meta.dirname, filename), 'utf8');
}

describe('integrations page source', () => {
  it('exposes structured create and edit integration flows from the main page', () => {
    const source = readSource('./integrations-page.tsx');
    expect(source).toContain('<IntegrationEditorDialog');
    expect(source).toContain('Edit integration');
    expect(source).toContain('Delete integration');
    expect(source).not.toContain('size="icon"');
  });

  it('uses structured supported settings in the integration editor', () => {
    const dialogSource = readSource('./integrations-editor-dialog.tsx');
    const sectionsSource = readSource('./integrations-editor-sections.tsx');
    expect(dialogSource).toContain('fieldsForIntegrationKind');
    expect(dialogSource).toContain('Workflow scope');
    expect(dialogSource).toContain('Subscribed events');
    expect(dialogSource).not.toContain('config: {}');
    expect(sectionsSource).toContain('Stored secret headers remain preserved until you replace them.');
    expect(sectionsSource).toContain('Repository labels');
  });

  it('keeps destructive and editor dialogs scrollable on smaller viewports', () => {
    const pageSource = readSource('./integrations-page.tsx');
    const editorSource = readSource('./integrations-editor-dialog.tsx');
    expect(editorSource).toContain('max-h-[85vh] max-w-4xl overflow-y-auto');
    expect(pageSource).toContain('max-h-[70vh] max-w-lg overflow-y-auto');
  });
});
