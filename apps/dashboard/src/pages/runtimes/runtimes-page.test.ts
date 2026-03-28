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

  it('composes the runtime defaults editor with the tenant live visibility settings panel', () => {
    const source = readSource();
    expect(source).toContain("import { RuntimeDefaultsPage }");
    expect(source).toContain("import { AgenticLiveVisibilitySettingsCard }");
    expect(source).toContain('<RuntimeDefaultsPage />');
    expect(source).toContain('<AgenticLiveVisibilitySettingsCard />');
    expect(source).not.toContain('/api/v1/agentic-settings');
  });
});
