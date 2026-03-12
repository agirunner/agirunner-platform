import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './playbook-launch-page.tsx'), 'utf8');
}

describe('playbook launch model override source', () => {
  it('supports workflow override entry and resolved model preview during launch', () => {
    const source = readSource();
    expect(source).toContain('Workflow Model Overrides JSON');
    expect(source).toContain('dashboardApi.getResolvedProjectModels(projectId)');
    expect(source).toContain('dashboardApi.previewEffectiveModels({');
    expect(source).toContain('model_overrides: Object.keys(modelOverrides).length > 0 ? modelOverrides : undefined');
    expect(source).toContain('Resolved Effective Models');
  });
});
