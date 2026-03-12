import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './integrations-page.tsx'), 'utf8');
}

describe('integrations page source', () => {
  it('uses structured workflow and event controls in the add dialog', () => {
    const source = readSource();
    expect(source).toContain('INTEGRATION_EVENT_OPTIONS');
    expect(source).toContain('Workflow scope');
    expect(source).toContain('Global integration');
    expect(source).not.toContain('Subscriptions (comma-separated)');
    expect(source).not.toContain('workflow-uuid');
  });

  it('keeps dialogs scrollable on smaller viewports', () => {
    const source = readSource();
    expect(source).toContain('max-h-[85vh] max-w-3xl overflow-y-auto');
    expect(source).toContain('max-h-[70vh] max-w-lg overflow-y-auto');
  });
});
