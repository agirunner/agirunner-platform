import { describe, expect, it } from 'vitest';

import { buildSearchResults } from '../api.js';

describe('create dashboard api search helpers', () => {
  it('creates task, workflow, workspace, playbook, and agent route targets', () => {
    const results = buildSearchResults('build', {
      workflows: [{ id: 'workflow-1', name: 'Build Workflow', state: 'running' }],
      tasks: [{ id: 'task-1', title: 'Build artifact', state: 'ready' }],
      workspaces: [{ id: 'workspace-1', name: 'Build Workspace' }],
      playbooks: [{ id: 'playbook-1', name: 'Build Playbook' }],
      workers: [{ id: 'worker-1', name: 'Builder worker', status: 'online' }],
      agents: [{ id: 'agent-1', name: 'Builder agent', status: 'idle' }],
    });

    expect(results.map((result) => result.type)).toEqual([
      'workflow',
      'task',
      'workspace',
      'playbook',
      'agent',
    ]);
    expect(results[0].href).toBe('/workflows?rail=workflow&workflow=workflow-1');
    expect(results[1].href).toBe('/work/tasks/task-1');
    expect(results[2].href).toBe('/design/workspaces/workspace-1');
    expect(results[3].href).toBe('/design/playbooks/playbook-1');
    expect(results[4].href).toBe('/diagnostics/live-containers');
  });
});
