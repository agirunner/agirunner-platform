import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './webhooks-page.tsx'), 'utf8');
}

describe('webhooks page source', () => {
  it('uses structured event selection instead of comma-separated entry', () => {
    const source = readSource();
    expect(source).toContain('WEBHOOK_EVENT_OPTIONS');
    expect(source).toContain('Choose the events this endpoint should receive.');
    expect(source).not.toContain('Event Types (comma-separated, leave blank for all)');
    expect(source).not.toContain('workflow.completed, task.failed');
  });

  it('keeps webhook dialogs scrollable on smaller viewports', () => {
    const source = readSource();
    expect(source).toContain('max-h-[80vh] max-w-3xl overflow-y-auto');
    expect(source).toContain('max-h-[70vh] max-w-lg overflow-y-auto');
  });
});
