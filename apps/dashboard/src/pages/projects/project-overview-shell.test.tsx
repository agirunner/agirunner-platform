import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { ProjectOverviewShell } from './project-overview-shell.js';

describe('project overview shell', () => {
  it('keeps the main workspace actions grouped ahead of the focused explorers', () => {
    const markup = renderOverview({
      id: 'project-1',
      name: 'Release automation',
      slug: 'release-automation',
      description: 'Release automation workspace',
      is_active: true,
      repository_url: 'https://example.com/repo.git',
    });

    expect(markup).toContain('Where to work next');
    expect(markup).toContain('Settings');
    expect(markup).toContain('Knowledge');
    expect(markup).toContain('Automation');
    expect(markup).toContain('Delivery');
    expect(markup).toContain('Focused explorers');
    expect(markup).toContain('Memory explorer');
    expect(markup).toContain('Artifact explorer');
    expect(markup).toContain('href="/projects/project-1?tab=settings"');
    expect(markup).toContain('href="/projects/project-1?tab=knowledge"');
    expect(markup).toContain('href="/projects/project-1?tab=automation"');
    expect(markup).toContain('href="/projects/project-1?tab=delivery"');
    expect(markup.indexOf('Delivery')).toBeLessThan(markup.indexOf('Focused explorers'));
  });

  it('uses the calmer needs-attention treatment for missing repository guidance', () => {
    const markup = renderOverview({
      id: 'project-2',
      name: 'Signals',
      slug: 'signals',
      description: 'Signals workspace',
      is_active: true,
      repository_url: null,
    });

    expect(markup).toContain('Needs attention');
    expect(markup).toContain(
      'Add a repository in Settings before you expect delivery or automation to map back to source control.',
    );
    expect(markup).toContain('bg-amber-50/70');
    expect(markup).not.toContain('bg-yellow-100');
  });
});

function renderOverview(
  project: Parameters<typeof ProjectOverviewShell>[0]['project'],
): string {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    return renderToStaticMarkup(
      createElement(
        MemoryRouter,
        undefined,
        createElement(ProjectOverviewShell, {
          project,
          overview: {
            summary: 'Use this snapshot before switching workspaces.',
            packets: [
              { label: 'Lifecycle', value: 'Active', detail: 'Last updated just now.' },
              { label: 'Coverage', value: '8 entries', detail: 'Knowledge posture is healthy.' },
              { label: 'Automation', value: 'Verified repo', detail: 'Repository trust is ready.' },
              { label: 'Repository', value: project.repository_url ? 'Linked' : 'Unlinked', detail: 'Repository posture.' },
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
