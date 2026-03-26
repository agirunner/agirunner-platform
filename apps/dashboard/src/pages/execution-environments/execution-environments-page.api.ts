import { dashboardApi } from '../../lib/api.js';
import type {
  DashboardExecutionEnvironmentCreateInput,
  DashboardExecutionEnvironmentRecord,
  DashboardExecutionEnvironmentUpdateInput,
} from '../../lib/api.js';

export const fetchExecutionEnvironments = (): Promise<DashboardExecutionEnvironmentRecord[]> =>
  dashboardApi.listExecutionEnvironments();

export const createExecutionEnvironment = (
  payload: DashboardExecutionEnvironmentCreateInput,
): Promise<DashboardExecutionEnvironmentRecord> =>
  dashboardApi.createExecutionEnvironment(payload);

export const updateExecutionEnvironment = (
  environmentId: string,
  payload: DashboardExecutionEnvironmentUpdateInput,
): Promise<DashboardExecutionEnvironmentRecord> =>
  dashboardApi.updateExecutionEnvironment(environmentId, payload);

export class ExecutionEnvironmentAutoVerifyError extends Error {
  readonly savedEnvironment: DashboardExecutionEnvironmentRecord;

  constructor(savedEnvironment: DashboardExecutionEnvironmentRecord, cause: unknown) {
    const causeMessage = cause instanceof Error ? cause.message : 'Verification failed.';
    super(`Saved environment ${savedEnvironment.name}, but automatic verification failed: ${causeMessage}`);
    this.name = 'ExecutionEnvironmentAutoVerifyError';
    this.savedEnvironment = savedEnvironment;
    this.cause = cause;
  }
}

export async function saveExecutionEnvironmentAndVerify(input: {
  mode: 'create' | 'edit';
  environmentId?: string;
  payload: DashboardExecutionEnvironmentCreateInput | DashboardExecutionEnvironmentUpdateInput;
}): Promise<DashboardExecutionEnvironmentRecord> {
  const savedEnvironment =
    input.mode === 'edit'
      ? await updateExecutionEnvironment(
          input.environmentId ?? '',
          input.payload as DashboardExecutionEnvironmentUpdateInput,
        )
      : await createExecutionEnvironment(input.payload as DashboardExecutionEnvironmentCreateInput);

  try {
    return await verifyExecutionEnvironment(savedEnvironment.id);
  } catch (error) {
    throw new ExecutionEnvironmentAutoVerifyError(savedEnvironment, error);
  }
}

export const verifyExecutionEnvironment = (
  environmentId: string,
): Promise<DashboardExecutionEnvironmentRecord> =>
  dashboardApi.verifyExecutionEnvironment(environmentId);

export const setDefaultExecutionEnvironment = (
  environmentId: string,
): Promise<DashboardExecutionEnvironmentRecord> =>
  dashboardApi.setDefaultExecutionEnvironment(environmentId);

export const archiveExecutionEnvironment = (
  environmentId: string,
): Promise<DashboardExecutionEnvironmentRecord> =>
  dashboardApi.archiveExecutionEnvironment(environmentId);

export const restoreExecutionEnvironment = (
  environmentId: string,
): Promise<DashboardExecutionEnvironmentRecord> =>
  dashboardApi.restoreExecutionEnvironment(environmentId);
