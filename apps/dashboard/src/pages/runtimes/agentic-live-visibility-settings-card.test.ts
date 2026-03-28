import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(
    resolve(import.meta.dirname, './agentic-live-visibility-settings-card.tsx'),
    'utf8',
  );
}

describe('agentic live visibility settings card source', () => {
  it('exports the live visibility settings card component', async () => {
    const module = await import('./agentic-live-visibility-settings-card.js');
    expect(module.AgenticLiveVisibilitySettingsCard).toBeTypeOf('function');
  });

  it('loads and saves tenant agentic settings through the canonical dashboard api', () => {
    const source = readSource();
    expect(source).toContain('dashboardApi.getAgenticSettings()');
    expect(source).toContain('dashboardApi.updateAgenticSettings');
    expect(source).toContain('settings_revision: settings.revision');
    expect(source).not.toContain('/api/v1/agentic-settings');
    expect(source).not.toContain('fetch(');
  });

  it('offers the workflows live visibility control with standard and enhanced modes', () => {
    const source = readSource();
    expect(source).toContain('Live visibility mode');
    expect(source).toContain('Applies immediately without restarting runtimes.');
    expect(source).toContain('<option value="standard">Standard</option>');
    expect(source).toContain('<option value="enhanced">Enhanced</option>');
    expect(source).toContain('Save live visibility');
  });
});
