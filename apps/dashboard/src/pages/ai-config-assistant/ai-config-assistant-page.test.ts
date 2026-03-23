import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return [
    './ai-config-assistant-page.tsx',
    './ai-config-assistant-page.sections.tsx',
    './ai-config-assistant-page.support.ts',
  ]
    .map((path) => readFileSync(resolve(import.meta.dirname, path), 'utf8'))
    .join('\n');
}

describe('ai config assistant page source', () => {
  it('uses playbook and runtime terminology consistently', () => {
    const source = readSource();
    expect(source).toContain('playbook model');
    expect(source).toContain('runtime defaults');
    expect(source).toContain('providers, playbooks');
    expect(source).toContain('work items, and operator controls');
    expect(source).not.toContain('templates, and more');
  });

  it('keeps the assistant advisory and provides quick operator guidance', () => {
    const source = readSource();
    expect(source).toContain('Suggestions are advisory only.');
    expect(source).toContain('Mark reviewed');
    expect(source).toContain('Quick asks');
    expect(source).toContain('Run quick audit');
    expect(source).toContain('Open runtime defaults');
    expect(source).toContain('Review queue');
    expect(source).toContain('Start with a bounded operator audit');
    expect(source).toContain('never applies changes from this page.');
    expect(source).toContain('Keep prompts narrow.');
    expect(source).not.toContain('Apply');
  });

  it('resolves destinations for all shipped config surfaces', () => {
    const source = readSource();
    expect(source).toContain("'/config/tools'");
    expect(source).toContain("'Open tools'");
    expect(source).toContain("'/config/instructions'");
    expect(source).toContain("'Open platform instructions'");
    expect(source).toContain("'/config/triggers'");
    expect(source).toContain("'Open work-item triggers'");
    expect(source).toContain("'/config/roles'");
    expect(source).toContain("'Open role definitions'");
  });

  it('exposes quick prompts for tool catalog and platform instructions', () => {
    const source = readSource();
    expect(source).toContain('Tool catalog');
    expect(source).toContain('Platform instructions');
  });

  it('marks the chat input with an accessible label', () => {
    const source = readSource();
    expect(source).toContain('aria-label="Configuration question"');
  });

  it('uses the shared dashboard api client instead of raw fetch', () => {
    const pageSource = readFileSync(
      resolve(import.meta.dirname, './ai-config-assistant-page.tsx'),
      'utf8',
    );
    expect(pageSource).toContain('dashboardApi.askConfigAssistant');
    expect(pageSource).not.toContain('await fetch(');
    expect(pageSource).not.toContain('API_BASE_URL');
    expect(pageSource).not.toContain('authHeaders');
  });
});
