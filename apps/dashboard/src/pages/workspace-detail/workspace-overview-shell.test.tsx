import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { WorkspaceOverviewShell } from './workspace-overview-shell.js';

describe('workspace overview shell', () => {
  it('renders only the workspace snapshot card', () => {
    const markup = renderOverview({
      id: 'workspace-1',
      name: 'Release automation',
      slug: 'release-automation',
      description: 'Release automation workspace',
      is_active: true,
      repository_url: 'https://example.com/repo.git',
      settings: {
        workspace_storage_type: 'git_remote',
        workspace_storage: {
          repository_url: 'https://example.com/repo.git',
        },
      },
    });

    expect(markup).toContain('Workspace Snapshot');
    expect(markup).toContain('Lifecycle');
    expect(markup).toContain('Storage');
    expect(markup).not.toContain('Where To Work Next');
    expect(markup).not.toContain('Automation');
    expect(markup).not.toContain('Delivery');
  });
});

function renderOverview(
): string {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    return renderToStaticMarkup(
      createElement(
        MemoryRouter,
        undefined,
        createElement(WorkspaceOverviewShell, {
          overview: {
            summary: 'Use this snapshot before switching workspaces.',
            packets: [
              { label: 'Lifecycle', value: 'Active', detail: 'Last updated just now.' },
              { label: 'Shared memory', value: '8 entries', detail: 'Knowledge posture is healthy.' },
              { label: 'Storage', value: 'Workspace Artifacts', detail: 'Storage posture.' },
            ],
          },
        }),
      ),
    );
  } finally {
    consoleError.mockRestore();
  }
}
