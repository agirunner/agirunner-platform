import type { DashboardPlaybookRecord } from '../../lib/api.js';
import {
  hydratePlaybookAuthoringDraft,
  type PlaybookAuthoringDraft,
  type RuntimePoolDraft,
} from './playbook-authoring-support.js';

export interface PlaybookRevisionDiffRow {
  label: string;
  current: string;
  compared: string;
  changed: boolean;
}

export interface PlaybookControlSummary {
  roles: string;
  cadence: string;
  parallelism: string;
  runtime: string;
  stages: string;
  parameters: string;
}

export function buildPlaybookRevisionChain(
  playbooks: DashboardPlaybookRecord[],
  current: DashboardPlaybookRecord,
): DashboardPlaybookRecord[] {
  return playbooks
    .filter((playbook) => playbook.slug === current.slug)
    .sort((left, right) => right.version - left.version);
}

export function buildPlaybookRevisionDiff(
  current: DashboardPlaybookRecord,
  compared: DashboardPlaybookRecord,
): PlaybookRevisionDiffRow[] {
  const currentDraft = readPlaybookDraft(current);
  const comparedDraft = readPlaybookDraft(compared);

  return [
    diffRow('Name', current.name, compared.name),
    diffRow('Description', current.description ?? 'none', compared.description ?? 'none'),
    diffRow('Outcome', current.outcome, compared.outcome),
    diffRow('Lifecycle', current.lifecycle, compared.lifecycle),
    diffRow('Roles', formatRoles(currentDraft), formatRoles(comparedDraft)),
    diffRow('Board columns', formatColumns(currentDraft), formatColumns(comparedDraft)),
    diffRow('Stages', formatStages(currentDraft), formatStages(comparedDraft)),
    diffRow('Parameters', formatParameters(currentDraft), formatParameters(comparedDraft)),
    diffRow(
      'Orchestrator cadence',
      formatOrchestratorCadence(currentDraft),
      formatOrchestratorCadence(comparedDraft),
    ),
    diffRow(
      'Parallelism policy',
      formatParallelism(currentDraft),
      formatParallelism(comparedDraft),
    ),
    diffRow('Runtime pools', formatRuntimePools(currentDraft), formatRuntimePools(comparedDraft)),
  ];
}

export function summarizePlaybookControls(
  playbook: DashboardPlaybookRecord,
): PlaybookControlSummary {
  const draft = readPlaybookDraft(playbook);
  return {
    roles: formatRoles(draft),
    cadence: formatOrchestratorCadence(draft),
    parallelism: formatParallelism(draft),
    runtime: formatRuntimePools(draft),
    stages: formatStages(draft),
    parameters: formatParameters(draft),
  };
}

export function renderPlaybookSnapshot(playbook: DashboardPlaybookRecord): string {
  const draft = readPlaybookDraft(playbook);
  const lines = [
    `Name: ${playbook.name}`,
    `Description: ${playbook.description ?? 'none'}`,
    `Outcome: ${playbook.outcome}`,
    `Lifecycle: ${playbook.lifecycle}`,
    `Roles: ${formatRoles(draft)}`,
    `Board columns: ${formatColumns(draft)}`,
    `Stages: ${formatStages(draft)}`,
    `Parameters: ${formatParameters(draft)}`,
    `Orchestrator cadence: ${formatOrchestratorCadence(draft)}`,
    `Parallelism policy: ${formatParallelism(draft)}`,
    `Runtime pools: ${formatRuntimePools(draft)}`,
  ];
  return lines.join('\n');
}

export function buildPlaybookRestorePayload(
  playbook: DashboardPlaybookRecord,
): {
  name: string;
  slug: string;
  description?: string;
  outcome: string;
  lifecycle: 'standard' | 'continuous';
  definition: Record<string, unknown>;
} {
  return {
    name: playbook.name,
    slug: playbook.slug,
    description: playbook.description ?? undefined,
    outcome: playbook.outcome,
    lifecycle: playbook.lifecycle,
    definition: playbook.definition,
  };
}

function readPlaybookDraft(playbook: DashboardPlaybookRecord): PlaybookAuthoringDraft {
  return hydratePlaybookAuthoringDraft(playbook.lifecycle ?? 'continuous', playbook.definition);
}

function diffRow(label: string, current: string, compared: string): PlaybookRevisionDiffRow {
  return {
    label,
    current,
    compared,
    changed: current !== compared,
  };
}

function formatRoles(draft: PlaybookAuthoringDraft): string {
  const roles = draft.roles.map((role) => role.value.trim()).filter(Boolean);
  return roles.length > 0 ? roles.join(', ') : 'none';
}

function formatColumns(draft: PlaybookAuthoringDraft): string {
  const columns = draft.columns
    .map((column) => {
      const label = column.label.trim() || column.id.trim();
      if (!label) {
        return '';
      }
      const flags = [
        column.is_blocked ? 'blocked' : '',
        column.is_terminal ? 'terminal' : '',
      ].filter(Boolean);
      return flags.length > 0 ? `${label} (${flags.join(', ')})` : label;
    })
    .filter(Boolean);
  return columns.length > 0 ? columns.join(', ') : 'none';
}

function formatStages(draft: PlaybookAuthoringDraft): string {
  const stages = draft.stages
    .map((stage) => {
      const name = stage.name.trim();
      if (!name) {
        return '';
      }
      return stage.human_gate ? `${name} (gate)` : name;
    })
    .filter(Boolean);
  return stages.length > 0 ? stages.join(', ') : 'none';
}

function formatParameters(draft: PlaybookAuthoringDraft): string {
  const parameters = draft.parameters
    .map((parameter) => {
      const name = parameter.name.trim();
      if (!name) {
        return '';
      }
      const flags = [
        parameter.required ? 'required' : '',
        parameter.secret ? 'secret' : '',
      ].filter(Boolean);
      return flags.length > 0 ? `${name} (${flags.join(', ')})` : name;
    })
    .filter(Boolean);
  return parameters.length > 0 ? parameters.join(', ') : 'none';
}

function formatOrchestratorCadence(draft: PlaybookAuthoringDraft): string {
  return [
    `check ${draft.orchestrator.check_interval || 'inherit'}`,
    `stale ${draft.orchestrator.stale_threshold || 'inherit'}`,
    `rework ${draft.orchestrator.max_rework_iterations || 'inherit'}`,
  ].join(' • ');
}

function formatParallelism(draft: PlaybookAuthoringDraft): string {
  return [
    `max tasks ${draft.orchestrator.max_active_tasks || 'inherit'}`,
    `per item ${draft.orchestrator.max_active_tasks_per_work_item || 'inherit'}`,
    draft.orchestrator.allow_parallel_work_items
      ? 'parallel work items on'
      : 'parallel work items off',
  ].join(' • ');
}

function formatRuntimePools(draft: PlaybookAuthoringDraft): string {
  return [
    `shared ${formatRuntimePool(draft.runtime.shared)}`,
    `orch ${formatRuntimePool(draft.runtime.orchestrator_pool)}`,
    `spec ${formatRuntimePool(draft.runtime.specialist_pool)}`,
  ].join(' • ');
}

function formatRuntimePool(pool: RuntimePoolDraft): string {
  if (pool.enabled === false) {
    return 'inherit';
  }
  const mode = pool.pool_mode || 'inherit';
  const capacity = pool.max_runtimes || 'inherit';
  const image = pool.image || 'default image';
  return `${mode} • ${capacity} runtimes • ${image}`;
}
