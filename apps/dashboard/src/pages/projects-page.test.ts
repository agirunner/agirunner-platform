import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './projects-page.tsx'), 'utf8');
}

describe('projects page source', () => {
  it('reuses the project delivery-history packet surface instead of raw timeline rows', () => {
    const source = readSource();

    expect(source).toContain("import { ProjectDeliveryHistory } from './projects/project-delivery-history.js';");
    expect(source).toContain('<ProjectDeliveryHistory projectId={activeProjectId} />');
    expect(source).not.toContain('status-badge status-${entry.state}');
    expect(source).not.toContain('Loading project timeline...');
    expect(source).not.toContain('Failed to load project timeline.');
    expect(source).not.toContain('No project timeline entries yet.');
  });
});
