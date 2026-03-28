import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import type { SessionContainerRow } from './containers-page.support.js';
import { ContainersTable } from './containers-table.js';

function createRow(overrides: Partial<SessionContainerRow> = {}): SessionContainerRow {
  return {
    id: 'runtime:runtime-1',
    kind: 'runtime',
    container_id: 'runtime-container-1',
    name: 'runtime-specialist-1',
    state: 'running',
    status: 'Up 2 minutes',
    image: 'agirunner-runtime:local',
    cpu_limit: '2',
    memory_limit: '1536m',
    started_at: '2026-03-25T04:10:00.000Z',
    last_seen_at: '2026-03-25T04:12:00.000Z',
    role_name: 'developer',
    playbook_id: null,
    playbook_name: 'Specialist agents',
    workflow_id: 'workflow-1',
    workflow_name: 'Investigate regression',
    task_id: 'task-1',
    task_title: 'Investigate image routing',
    stage_name: 'Implement',
    activity_state: 'in_progress',
    execution_environment_id: 'env-1',
    execution_environment_name: 'Debian Base',
    execution_environment_image: 'debian:trixie-slim',
    execution_environment_distro: 'debian',
    execution_environment_package_manager: 'apt-get',
    presence: 'running',
    inactive_at: null,
    changed_at: null,
    changed_fields: [],
    pending_state: null,
    pending_flip_at: null,
    pending_fields: [],
    remembered_context: null,
    ...overrides,
  };
}

describe('ContainersTable', () => {
  it('shows the actual specialist runtime image instead of the linked execution environment image', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/']}>
        <ContainersTable rows={[createRow()]} emptyMessage="No rows" />
      </MemoryRouter>,
    );

    expect(html).toContain('agirunner-runtime:local');
    expect(html).not.toContain('<code class="block truncate text-xs text-foreground" title="debian:trixie-slim">debian:trixie-slim</code>');
    expect(html).not.toContain('Debian Base');
    expect(html).not.toContain('debian · apt-get');
  });

  it('keeps execution environment context on specialist execution rows', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/']}>
        <ContainersTable
          rows={[
            createRow({
              id: 'task:task-1',
              kind: 'task',
              image: 'debian:trixie-slim',
            }),
          ]}
          emptyMessage="No rows"
        />
      </MemoryRouter>,
    );

    expect(html).toContain('debian:trixie-slim');
    expect(html).toContain('Debian Base');
    expect(html).toContain('Debian Base · debian');
    expect(html).not.toContain('apt-get');
  });
});
