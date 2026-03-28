import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './runtimes-page.tsx'), 'utf8');
}

describe('runtimes page source', () => {
  it('exports the runtimes page component', async () => {
    const module = await import('./runtimes-page.js');
    expect(module.RuntimesPage).toBeTypeOf('function');
  });

  it('renders agentic settings through the shared runtime defaults page only', () => {
    const source = readSource();
    expect(source).toContain("import { RuntimeDefaultsPage }");
    expect(source).toContain('<RuntimeDefaultsPage />');
    expect(source).not.toContain('AgenticLiveVisibilitySettingsCard');
    expect(source).not.toContain('/api/v1/agentic-settings');
  });
});
