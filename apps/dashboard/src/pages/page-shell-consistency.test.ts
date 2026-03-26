import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const dashboardRoot = resolve(import.meta.dirname, '..');

const sectionShellSurfaces = [
  {
    label: 'specialists library',
    files: ['pages/role-definitions/role-definitions-page.tsx'],
  },
  {
    label: 'orchestrator controls',
    files: ['pages/role-definitions/role-definitions-orchestrator.tsx'],
  },
  {
    label: 'execution environments',
    files: ['pages/execution-environments/execution-environments-table.tsx'],
  },
  {
    label: 'tools catalog',
    files: ['pages/tools/tools-page.tsx'],
  },
  {
    label: 'general settings',
    files: ['pages/settings/settings-page.tsx'],
  },
  {
    label: 'runtime defaults',
    files: ['pages/runtimes/runtime-defaults-fields.tsx'],
  },
  {
    label: 'models page',
    files: ['pages/llm-providers/llm-providers-page.tsx'],
  },
  {
    label: 'workspace library',
    files: ['pages/workspace-list/workspace-list-page.tsx'],
  },
  {
    label: 'playbook library',
    files: [
      'pages/playbook-list/playbook-list-page.tsx',
      'pages/playbook-list/playbook-list-page.library.tsx',
    ],
  },
  {
    label: 'playbook authoring sections',
    files: ['pages/playbook-authoring/playbook-authoring-form-fields.tsx'],
  },
  {
    label: 'platform instructions',
    files: [
      'pages/platform-instructions/platform-instructions-page.tsx',
      'pages/platform-instructions/platform-instructions-page.content.tsx',
      'pages/platform-instructions/platform-instructions-sections.tsx',
    ],
  },
  {
    label: 'api keys',
    files: ['pages/api-key/api-key-page.sections.tsx'],
  },
  {
    label: 'live containers',
    files: ['pages/containers/containers-page.tsx'],
  },
  {
    label: 'live logs',
    files: ['pages/logs/logs-page.tsx'],
  },
  {
    label: 'config placeholders',
    files: ['pages/config-placeholder/config-placeholder-page.tsx'],
  },
] as const;

function readDashboardFile(relativePath: string): string {
  return readFileSync(resolve(dashboardRoot, relativePath), 'utf8');
}

describe('dashboard section shell consistency', () => {
  it.each(sectionShellSurfaces)('$label uses the shared dashboard section card', (surface) => {
    expect(
      surface.files.some((relativePath) =>
        readDashboardFile(relativePath).includes('DashboardSectionCard'),
      ),
    ).toBe(true);
  });
});
