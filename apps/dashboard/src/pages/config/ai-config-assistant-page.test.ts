import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './ai-config-assistant-page.tsx'), 'utf8');
}

describe('ai config assistant page source', () => {
  it('uses playbook and runtime terminology instead of template-era wording', () => {
    const source = readSource();
    expect(source).toContain('runtime and playbook model');
    expect(source).toContain('playbooks, work items, and operator controls');
    expect(source).not.toContain('templates, and more');
  });
});
