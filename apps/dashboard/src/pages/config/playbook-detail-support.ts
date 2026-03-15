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
    diffRow('Slug', current.slug, compared.slug),
    diffRow('Outcome', current.outcome, compared.outcome),
    diffRow('Lifecycle', current.lifecycle, compared.lifecycle),
    diffRow(
      'Availability',
      current.is_active === false ? 'inactive' : 'active',
      compared.is_active === false ? 'inactive' : 'active',
    ),
    diffRow('Roles', formatRoles(currentDraft), formatRoles(comparedDraft)),
    diffRow('Entry column', formatEntryColumn(currentDraft), formatEntryColumn(comparedDraft)),
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
  return JSON.stringify(
    normalizeSnapshotValue({
      name: playbook.name,
      slug: playbook.slug,
      outcome: playbook.outcome,
      lifecycle: playbook.lifecycle,
      is_active: playbook.is_active !== false,
      definition: playbook.definition,
    }),
    null,
    2,
  );
}

function readPlaybookDraft(playbook: DashboardPlaybookRecord): PlaybookAuthoringDraft {
  return hydratePlaybookAuthoringDraft(playbook.lifecycle ?? 'ongoing', playbook.definition);
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

function formatEntryColumn(draft: PlaybookAuthoringDraft): string {
  const entryColumnId = draft.entry_column_id.trim();
  if (!entryColumnId) {
    return 'none';
  }
  const matchingColumn = draft.columns.find((column) => column.id.trim() === entryColumnId);
  if (!matchingColumn) {
    return entryColumnId;
  }
  return matchingColumn.label.trim() || entryColumnId;
}

function formatStages(draft: PlaybookAuthoringDraft): string {
  const stages = draft.stages
    .map((stage) => {
      const name = stage.name.trim();
      if (!name) {
        return '';
      }
      const flags = [stage.human_gate ? 'gate' : '', stage.guidance.trim() ? 'guided' : '']
        .filter(Boolean)
        .join(', ');
      return flags ? `${name} (${flags})` : name;
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
        parameter.maps_to.trim() ? `maps ${parameter.maps_to.trim()}` : '',
      ].filter(Boolean);
      return flags.length > 0 ? `${name} (${flags.join(', ')})` : name;
    })
    .filter(Boolean);
  return parameters.length > 0 ? parameters.join(', ') : 'none';
}

function normalizeSnapshotValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeSnapshotValue(entry));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalizeSnapshotValue(entry)]),
    );
  }
  return value;
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
  return `spec ${formatRuntimePool(draft.runtime.specialist_pool)}`;
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
