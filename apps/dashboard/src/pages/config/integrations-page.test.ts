import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(filename: string) {
  return readFileSync(resolve(import.meta.dirname, filename), 'utf8');
}

describe('integrations page source', () => {
  it('exposes structured create and edit integration flows from the main page', () => {
    const source = [
      './integrations-page.tsx',
      './integrations-page.sections.tsx',
      './integrations-page.support.ts',
    ]
      .map(readSource)
      .join('\n');
    expect(source).toContain('<IntegrationEditorDialog');
    expect(source).toContain('Edit integration');
    expect(source).toContain('Delete integration');
    expect(source).toContain('Active destinations');
    expect(source).toContain('Paused destinations');
    expect(source).toContain('Scope coverage');
    expect(source).toContain('Library filters');
    expect(source).toContain('statusFilter');
    expect(source).toContain('scopeFilter');
    expect(source).toContain('Search integrations...');
    expect(source).toContain('No integrations match the current filters.');
    expect(source).not.toContain('size="icon"');
  });

  it('uses structured supported settings in the integration editor', () => {
    const dialogSource = readSource('./integrations-editor-dialog.tsx');
    const sectionsSource = readSource('./integrations-editor-sections.tsx');
    expect(dialogSource).toContain('fieldsForIntegrationKind');
    expect(dialogSource).toContain('validateIntegrationForm');
    expect(dialogSource).toContain('Workflow scope');
    expect(dialogSource).toContain('Save readiness');
    expect(dialogSource).toContain('Resolve the items below before saving this integration.');
    expect(dialogSource).toContain('Subscribed events');
    expect(dialogSource).toContain('Global integrations receive subscribed events from every workflow.');
    expect(dialogSource).toContain('ToggleCard');
    expect(dialogSource).toContain('ConfigInputField');
    expect(dialogSource).not.toContain('config: {}');
    expect(sectionsSource).toContain('Stored secret headers remain preserved until you replace them.');
    expect(sectionsSource).toContain('Repository labels');
    expect(sectionsSource).toContain('ConfigSelectField');
    expect(sectionsSource).toContain('GitHub owner or organization, for example');
    expect(sectionsSource).toContain('Repository name only, for example');
    expect(sectionsSource).toContain('Leave the hosted GitHub API default unless you use GitHub Enterprise.');
  });

  it('keeps destructive and editor dialogs scrollable on smaller viewports', () => {
    const pageSource = readSource('./integrations-page.tsx');
    const editorSource = readSource('./integrations-editor-dialog.tsx');
    expect(editorSource).toContain('max-h-[85vh] max-w-4xl overflow-y-auto');
    expect(pageSource).toContain('max-h-[70vh] max-w-lg overflow-y-auto');
  });
});
