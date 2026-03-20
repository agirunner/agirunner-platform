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
      settings: {
        workspace_storage_type: 'git_remote',
        workspace_storage: {
          repository_url: 'https://example.com/repo.git',
        },
      },
    });

    expect(markup).toContain('Where To Work Next');
    expect(markup).toContain('Settings');
    expect(markup).toContain('Knowledge');
    expect(markup).toContain('Automation');
    expect(markup).toContain('Delivery');
    expect(markup).toContain('Workspace basics, storage configuration, and lifecycle posture.');
    expect(markup).toContain('Scheduled workflow triggers that stay on the workspace surface.');
    expect(markup).toContain('href="/workspaces/workspace-1?tab=settings"');
    expect(markup).toContain('href="/workspaces/workspace-1?tab=knowledge"');
    expect(markup).toContain('href="/workspaces/workspace-1?tab=automation"');
    expect(markup).toContain('href="/workspaces/workspace-1?tab=delivery"');
    expect(markup).not.toContain('Focused explorers');
    expect(markup).not.toContain('Memory explorer');
    expect(markup).not.toContain('Artifact explorer');
    expect(markup).not.toContain('repository defaults');
    expect(markup).not.toContain('inbound hooks');
  });

  it('uses storage-aware delivery guidance instead of optional repository guidance', () => {
    const markup = renderOverview({
      id: 'workspace-2',
      name: 'Signals',
      slug: 'signals',
      description: 'Signals workspace',
      is_active: true,
      repository_url: null,
      settings: {
        workspace_storage_type: 'host_directory',
        workspace_storage: {
          host_path: '/home/mark/coolrepo',
        },
      },
    });

    expect(markup).toContain(
      'Delivery follows the configured Host Directory and saved outputs when a run needs filesystem-level follow-up.',
    );
    expect(markup).not.toContain('Needs attention');
    expect(markup).not.toContain('Repository setup is optional');
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
              { label: 'Automation', value: 'Schedules only', detail: 'Schedule posture.' },
              { label: 'Storage', value: 'Workspace Artifacts', detail: 'Storage posture.' },
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
