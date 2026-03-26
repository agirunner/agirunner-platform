import type {
  DashboardExecutionEnvironmentCreateInput,
  DashboardExecutionEnvironmentRecord,
  DashboardExecutionEnvironmentUpdateInput,
} from '../../lib/api.js';

export interface ExecutionEnvironmentFormState {
  name: string;
  description: string;
  image: string;
  cpu: string;
  memory: string;
  pullPolicy: 'always' | 'if-not-present' | 'never';
  operatorNotes: string;
}

export interface ExecutionEnvironmentStats {
  total: number;
  catalog: number;
  custom: number;
}

export function createExecutionEnvironmentForm(
  environment?: Partial<DashboardExecutionEnvironmentRecord> | null,
): ExecutionEnvironmentFormState {
  return {
    name: environment?.name ?? '',
    description: environment?.description ?? '',
    image: environment?.image ?? '',
    cpu: environment?.cpu ?? '2',
    memory: environment?.memory ?? '1Gi',
    pullPolicy: environment?.pull_policy ?? 'if-not-present',
    operatorNotes: environment?.operator_notes ?? '',
  };
}

export function createCopiedExecutionEnvironmentForm(
  environment?: Partial<DashboardExecutionEnvironmentRecord> | null,
): ExecutionEnvironmentFormState {
  return {
    ...createExecutionEnvironmentForm(environment),
    name: '',
  };
}

export function buildExecutionEnvironmentPayload(
  form: ExecutionEnvironmentFormState,
): DashboardExecutionEnvironmentCreateInput {
  return {
    name: form.name.trim(),
    description: normalizeOptionalString(form.description) ?? undefined,
    image: form.image.trim(),
    cpu: form.cpu.trim(),
    memory: form.memory.trim(),
    pullPolicy: form.pullPolicy,
    operatorNotes: normalizeOptionalString(form.operatorNotes) ?? undefined,
  };
}

export function buildExecutionEnvironmentUpdatePayload(
  form: ExecutionEnvironmentFormState,
): DashboardExecutionEnvironmentUpdateInput {
  return {
    name: form.name.trim(),
    description: normalizeOptionalString(form.description),
    image: form.image.trim(),
    cpu: form.cpu.trim(),
    memory: form.memory.trim(),
    pullPolicy: form.pullPolicy,
    operatorNotes: normalizeOptionalString(form.operatorNotes),
  };
}

export function sortExecutionEnvironments(
  environments: DashboardExecutionEnvironmentRecord[],
): DashboardExecutionEnvironmentRecord[] {
  return [...environments].sort((left, right) => {
    if (left.is_default !== right.is_default) {
      return left.is_default ? -1 : 1;
    }
    if (left.is_archived !== right.is_archived) {
      return left.is_archived ? 1 : -1;
    }
    return left.name.localeCompare(right.name);
  });
}

export function buildExecutionEnvironmentStats(
  environments: DashboardExecutionEnvironmentRecord[],
): ExecutionEnvironmentStats {
  return environments.reduce(
    (summary, environment) => ({
      total: summary.total + 1,
      catalog: summary.catalog + (environment.source_kind === 'catalog' ? 1 : 0),
      custom: summary.custom + (environment.source_kind === 'custom' ? 1 : 0),
    }),
    {
      total: 0,
      catalog: 0,
      custom: 0,
    },
  );
}

function normalizeOptionalString(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
