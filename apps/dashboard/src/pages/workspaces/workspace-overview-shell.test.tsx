import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { WorkspaceOverviewShell } from './workspace-overview-shell.js';

describe('workspace overview shell', () => {
  it('keeps the main workspace actions focused on the primary workspace surfaces', () => {
    const markup = renderOverview({
      id: 'workspace-1',
      name: 'Release automation',
      slug: 'release-automation',
      description: 'Release automation workspace',
      is_active: true,
      repository_url: 'https://example.com/repo.git',
    });

    expect(markup).toContain('Where To Work Next');
    expect(markup).toContain('Settings');
    expect(markup).toContain('Knowledge');
    expect(markup).toContain('Automation');
    expect(markup).toContain('Delivery');
    expect(markup).toContain('href="/workspaces/workspace-1?tab=settings"');
    expect(markup).toContain('href="/workspaces/workspace-1?tab=knowledge"');
    expect(markup).toContain('href="/workspaces/workspace-1?tab=automation"');
    expect(markup).toContain('href="/workspaces/workspace-1?tab=delivery"');
    expect(markup).not.toContain('Focused explorers');
    expect(markup).not.toContain('Memory explorer');
    expect(markup).not.toContain('Artifact explorer');
  });

  it('treats repository guidance as optional when the workspace does not use source control', () => {
    const markup = renderOverview({
      id: 'workspace-2',
      name: 'Signals',
      slug: 'signals',
      description: 'Signals workspace',
      is_active: true,
      repository_url: null,
    });

    expect(markup).toContain(
      'Repository setup is optional. Add it in Settings only when this workspace should map delivery or automation back to source control.',
    );
    expect(markup).not.toContain('Needs attention');
  });
});

function renderOverview(
  workspace: Parameters<typeof WorkspaceOverviewShell>[0]['workspace'],
): string {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    return renderToStaticMarkup(
      createElement(
        MemoryRouter,
        undefined,
        createElement(WorkspaceOverviewShell, {
          workspace,
          overview: {
            summary: 'Use this snapshot before switching workspaces.',
            packets: [
              { label: 'Lifecycle', value: 'Active', detail: 'Last updated just now.' },
              { label: 'Coverage', value: '8 entries', detail: 'Knowledge posture is healthy.' },
              { label: 'Automation', value: 'Verified repo', detail: 'Repository trust is ready.' },
              { label: 'Repository', value: workspace.repository_url ? 'Linked' : 'Unlinked', detail: 'Repository posture.' },
              { label: 'Delivery', value: '7 workflows', detail: '2 active · 5 completed.' },
            ],
          },
        }),
      ),
    );
  } finally {
    consoleError.mockRestore();
  }
}
