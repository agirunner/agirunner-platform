import type { DashboardPlaybookRecord } from '../../../lib/api.js';

export interface PlaybookRevisionDiffRow {
  label: string;
  current: string;
  compared: string;
  changed: boolean;
}

export interface PlaybookControlSummary {
  roles: string;
  process: string;
  stages: string;
  board: string;
  parallelism: string;
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
  const currentDefinition = readDefinition(current);
  const comparedDefinition = readDefinition(compared);

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
    diffRow('Roles', formatRoles(currentDefinition), formatRoles(comparedDefinition)),
    diffRow(
      'Process instructions',
      formatProcessInstructions(currentDefinition),
      formatProcessInstructions(comparedDefinition),
    ),
    diffRow('Stages', formatStages(currentDefinition), formatStages(comparedDefinition)),
    diffRow('Entry column', formatEntryColumn(currentDefinition), formatEntryColumn(comparedDefinition)),
    diffRow('Board columns', formatColumns(currentDefinition), formatColumns(comparedDefinition)),
    diffRow('Workflow goals', formatParameters(currentDefinition), formatParameters(comparedDefinition)),
    diffRow(
      'Parallelism policy',
      formatParallelism(currentDefinition),
      formatParallelism(comparedDefinition),
    ),
  ];
}

export function summarizePlaybookControls(
  playbook: DashboardPlaybookRecord,
): PlaybookControlSummary {
  const definition = readDefinition(playbook);
  return {
    roles: formatRoles(definition),
    process: formatProcessInstructions(definition),
    stages: formatStages(definition),
    board: formatColumns(definition),
    parallelism: formatParallelism(definition),
    parameters: formatParameters(definition),
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

function readDefinition(playbook: DashboardPlaybookRecord): Record<string, unknown> {
  return isRecord(playbook.definition) ? playbook.definition : {};
}

function diffRow(label: string, current: string, compared: string): PlaybookRevisionDiffRow {
  return {
    label,
    current,
    compared,
    changed: current !== compared,
  };
}

function formatRoles(definition: Record<string, unknown>): string {
  const roles = readStringArray(definition.roles);
  return roles.length > 0 ? roles.join(', ') : 'none';
}

function formatColumns(definition: Record<string, unknown>): string {
  const board = asRecord(definition.board);
  const columns = readArray(board.columns)
    .map((column) => {
      const record = asRecord(column);
      const id = readString(record.id);
      const label = readString(record.label) || id;
      if (!label) {
        return '';
      }
      const flags = [
        record.is_blocked === true ? 'blocked' : '',
        record.is_terminal === true ? 'terminal' : '',
      ].filter(Boolean);
      return flags.length > 0 ? `${label} (${flags.join(', ')})` : label;
    })
    .filter(Boolean);
  return columns.length > 0 ? columns.join(', ') : 'none';
}

function formatEntryColumn(definition: Record<string, unknown>): string {
  const board = asRecord(definition.board);
  const entryColumnId = readString(board.entry_column_id);
  if (!entryColumnId) {
    return 'none';
  }
  const matchingColumn = readArray(board.columns).find(
    (column) => readString(asRecord(column).id) === entryColumnId,
  );
  if (!matchingColumn) {
    return entryColumnId;
  }
  return readString(asRecord(matchingColumn).label) || entryColumnId;
}

function formatProcessInstructions(definition: Record<string, unknown>): string {
  const instructions = readString(definition.process_instructions);
  return instructions ? instructions : 'none';
}

function formatStages(definition: Record<string, unknown>): string {
  const stages = readArray(definition.stages)
    .map((stage) => {
      const record = asRecord(stage);
      const name = readString(record.name);
      if (!name) {
        return '';
      }
      const flags = [
        readString(record.goal) ? 'goal' : '',
        readString(record.guidance) ? 'guidance' : '',
      ].filter(Boolean);
      return flags.length > 0 ? `${name} (${flags.join(', ')})` : name;
    })
    .filter(Boolean);
  return stages.length > 0 ? stages.join(', ') : 'none';
}

function formatParameters(definition: Record<string, unknown>): string {
  const parameters = readArray(definition.parameters)
    .map((parameter) => {
      const record = asRecord(parameter);
      const slug = readString(record.slug);
      const title = readString(record.title);
      if (!slug || !title) {
        return '';
      }
      return record.required === true
        ? `${title} (${slug}, required)`
        : `${title} (${slug})`;
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

function formatParallelism(definition: Record<string, unknown>): string {
  const orchestrator = asRecord(definition.orchestrator);
  const loopPolicy = [
    `rework ${readNumber(orchestrator.max_rework_iterations) ?? 'inherit'}`,
    `task loops ${readNumber(orchestrator.max_iterations) ?? 'inherit'}`,
    `llm retries ${readNumber(orchestrator.llm_max_retries) ?? 'inherit'}`,
  ].join(' • ');
  return [
    loopPolicy,
    `max tasks ${readNumber(orchestrator.max_active_tasks) ?? 'inherit'}`,
    `per item ${readNumber(orchestrator.max_active_tasks_per_work_item) ?? 'inherit'}`,
    orchestrator.allow_parallel_work_items === true ? 'parallel work items on' : 'parallel work items off',
  ].join(' • ');
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readStringArray(value: unknown): string[] {
  return readArray(value)
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
