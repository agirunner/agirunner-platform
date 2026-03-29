import { describe, expect, it } from 'vitest';

import type { DashboardPlaybookRecord, DashboardWorkspaceRecord } from '../../lib/api.js';
import {
  buildWorkflowLaunchComboboxItems,
  resolveDefaultWorkflowLaunchWorkspaceId,
  validateWorkflowLaunchDialogDraft,
} from './workflow-launch-dialog.support.js';

describe('workflow-launch-dialog.support', () => {
  it('builds combobox items from operator-facing names so launch selectors can filter by name', () => {
    expect(
      buildWorkflowLaunchComboboxItems([
        createPlaybook({ id: 'playbook-2', name: 'Release Readiness' }),
        createPlaybook({ id: 'playbook-1', name: 'Incident Review' }),
      ]),
    ).toEqual([
      { id: 'playbook-2', label: 'Release Readiness' },
      { id: 'playbook-1', label: 'Incident Review' },
    ]);
  });

  it('preselects the only available workspace', () => {
    const workspaces: DashboardWorkspaceRecord[] = [
      { id: 'workspace-1', name: 'Primary Workspace', slug: 'primary-workspace' },
    ];

    expect(resolveDefaultWorkflowLaunchWorkspaceId(workspaces, '')).toBe('workspace-1');
  });

  it('keeps the current workspace when it is still available', () => {
    const workspaces: DashboardWorkspaceRecord[] = [
      { id: 'workspace-1', name: 'Primary Workspace', slug: 'primary-workspace' },
      { id: 'workspace-2', name: 'Secondary Workspace', slug: 'secondary-workspace' },
    ];

    expect(resolveDefaultWorkflowLaunchWorkspaceId(workspaces, 'workspace-2')).toBe('workspace-2');
  });

  it('requires playbook, workspace, workflow name, and required launch inputs', () => {
    const result = validateWorkflowLaunchDialogDraft({
      selectedPlaybook: null,
      workspaceId: '',
      workflowName: '',
      parameterSpecs: [
        { slug: 'goal', title: 'Goal', required: true },
      ],
      parameterDrafts: {},
    });

    expect(result.isValid).toBe(false);
    expect(result.fieldErrors.playbook).toBe('Select a playbook before launching a workflow.');
    expect(result.fieldErrors.workspace).toBe('Select a workspace before launching a workflow.');
    expect(result.fieldErrors.workflowName).toBe('Workflow name is required before launch.');
    expect(result.fieldErrors.parameters).toBe("Enter a value for required launch input 'Goal'.");
  });

  it('accepts a complete launch draft', () => {
    const result = validateWorkflowLaunchDialogDraft({
      selectedPlaybook: createPlaybook(),
      workspaceId: 'workspace-1',
      workflowName: 'Launch release readiness',
      parameterSpecs: [
        { slug: 'goal', title: 'Goal', required: true },
      ],
      parameterDrafts: {
        goal: 'Ship release 24.4',
      },
    });

    expect(result).toEqual({
      fieldErrors: {},
      blockingIssues: [],
      isValid: true,
    });
  });
});

function createPlaybook(overrides: Partial<DashboardPlaybookRecord> = {}): DashboardPlaybookRecord {
  return {
    id: 'playbook-1',
    name: 'Release Readiness',
    slug: 'release-readiness',
    outcome: 'Prepared release package',
    lifecycle: 'planned',
    version: 1,
    definition: {},
    ...overrides,
  };
}
