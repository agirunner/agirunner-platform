import type { FieldDefinition } from './runtime-defaults.types.js';

export const RUNTIME_OPERATION_WORKSPACE_FIELDS: FieldDefinition[] = [
  ...buildWorkspaceTimeoutFields(),
  ...buildWorkspaceOperationFields(),
  {
    key: 'capture.push_retries',
    label: 'Capture push retry budget',
    description:
      'How many times the specialist agent retries git push or result publication before giving up.',
    configType: 'number',
    placeholder: '5',
    section: 'capture_timeouts',
    inputMode: 'numeric',
    min: 0,
    step: 1,
  },
  {
    key: 'capture.push_timeout_seconds',
    label: 'Capture push timeout (seconds)',
    description: 'Deadline for capture-side artifact upload and result push steps.',
    configType: 'number',
    placeholder: '180',
    section: 'capture_timeouts',
    inputMode: 'numeric',
    min: 1,
    step: 1,
  },
  {
    key: 'capture.exec_timeout_seconds',
    label: 'Capture exec timeout (seconds)',
    description: 'Maximum duration for capture-side shell execution while packaging task results.',
    configType: 'number',
    placeholder: '10',
    section: 'capture_timeouts',
    inputMode: 'numeric',
    min: 1,
    step: 1,
  },
  {
    key: 'secrets.vault_timeout_seconds',
    label: 'Vault timeout (seconds)',
    description:
      'Upper bound for Vault reads and revocation calls when Vault-backed secrets are enabled.',
    configType: 'number',
    placeholder: '10',
    defaultValue: '10',
    section: 'secrets_timeouts',
    inputMode: 'numeric',
    min: 1,
    step: 1,
  },
  {
    key: 'subagent.max_concurrent',
    label: 'Concurrent subagents per root task',
    description: 'Maximum number of subagents that may run at the same time for one root task.',
    configType: 'number',
    placeholder: '3',
    section: 'subagent_timeouts',
    inputMode: 'numeric',
    min: 1,
    step: 1,
  },
  {
    key: 'subagent.max_total',
    label: 'Total subagents per root task',
    description:
      'Maximum number of subagents a root task may spawn before further delegation is rejected.',
    configType: 'number',
    placeholder: '10',
    section: 'subagent_timeouts',
    inputMode: 'numeric',
    min: 1,
    step: 1,
  },
  {
    key: 'subagent.max_depth',
    label: 'Subagent nesting depth',
    description: 'Maximum allowed subagent depth. Set to 0 to block nested delegation entirely.',
    configType: 'number',
    placeholder: '1',
    section: 'subagent_timeouts',
    inputMode: 'numeric',
    min: 0,
    step: 1,
  },
  {
    key: 'subagent.default_timeout_seconds',
    label: 'Default subagent timeout (seconds)',
    description: 'Fallback deadline for subagents when the caller does not provide one explicitly.',
    configType: 'number',
    placeholder: '300',
    section: 'subagent_timeouts',
    inputMode: 'numeric',
    min: 1,
    step: 1,
  },
];

function buildWorkspaceTimeoutFields(): FieldDefinition[] {
  return [
    workspaceTimeoutField('workspace.create_layout_timeout_seconds', 'Create layout timeout', '20'),
    workspaceTimeoutField('workspace.configure_git_timeout_seconds', 'Configure git timeout', '15'),
    workspaceTimeoutField('workspace.cleanup_git_timeout_seconds', 'Cleanup git timeout', '10'),
    workspaceTimeoutField(
      'workspace.configure_identity_timeout_seconds',
      'Configure identity timeout',
      '10',
    ),
    workspaceTimeoutField('workspace.clone_timeout_seconds', 'Clone timeout', '600'),
  ];
}

function buildWorkspaceOperationFields(): FieldDefinition[] {
  return [
    {
      key: 'workspace.clone_max_retries',
      label: 'Clone retry budget',
      description:
        'How many times the specialist agent retries a workspace clone before failing the task.',
      configType: 'number',
      placeholder: '5',
      section: 'workspace_timeouts',
      inputMode: 'numeric',
      min: 1,
      step: 1,
    },
    {
      key: 'workspace.clone_backoff_base_seconds',
      label: 'Clone backoff base (seconds)',
      description: 'Base backoff in seconds used between workspace clone retry attempts.',
      configType: 'number',
      placeholder: '2',
      section: 'workspace_timeouts',
      inputMode: 'numeric',
      min: 1,
      step: 1,
    },
    {
      key: 'workspace.snapshot_interval',
      label: 'Snapshot interval (iterations)',
      description:
        'Automatic workspace snapshot cadence in engine iterations; set to 0 to disable snapshots.',
      configType: 'number',
      placeholder: '1',
      section: 'workspace_timeouts',
      inputMode: 'numeric',
      min: 0,
      step: 1,
    },
    {
      key: 'workspace.snapshot_max_per_task',
      label: 'Snapshots kept per task',
      description:
        'Maximum number of archived workspace snapshots retained for one task before older snapshots are pruned.',
      configType: 'number',
      placeholder: '10',
      section: 'workspace_timeouts',
      inputMode: 'numeric',
      min: 0,
      step: 1,
    },
  ];
}

function workspaceTimeoutField(key: string, label: string, placeholder: string): FieldDefinition {
  return {
    key,
    label: `${label} (seconds)`,
    description: `Upper bound for ${label.toLowerCase()} during workspace preparation.`,
    configType: 'number',
    placeholder,
    section: 'workspace_timeouts',
    inputMode: 'numeric',
    min: 1,
    step: 1,
  };
}
