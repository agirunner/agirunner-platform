import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './workspaces-page.tsx'), 'utf8');
}

describe('workspaces page source', () => {
  it('reuses the workspace delivery-history packet surface instead of raw timeline rows', () => {
    const source = readSource();

    expect(source).toContain("import { WorkspaceDeliveryHistory } from './workspaces/workspace-delivery-history.js';");
    expect(source).toContain('<WorkspaceDeliveryHistory workspaceId={activeWorkspaceId} />');
    expect(source).not.toContain('status-badge status-${entry.state}');
    expect(source).not.toContain('Loading workspace timeline...');
    expect(source).not.toContain('Failed to load workspace timeline.');
    expect(source).not.toContain('No workspace timeline entries yet.');
  });
});
