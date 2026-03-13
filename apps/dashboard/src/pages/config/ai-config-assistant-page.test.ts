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
});
