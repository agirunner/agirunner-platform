import { dashboardApi } from '../../lib/api.js';
import type {
  DashboardExecutionEnvironmentCatalogRecord,
  DashboardExecutionEnvironmentCreateFromCatalogInput,
  DashboardExecutionEnvironmentCreateInput,
  DashboardExecutionEnvironmentRecord,
  DashboardExecutionEnvironmentUpdateInput,
} from '../../lib/api.js';

export const fetchExecutionEnvironmentCatalog =
  (): Promise<DashboardExecutionEnvironmentCatalogRecord[]> =>
    dashboardApi.listExecutionEnvironmentCatalog();

export const fetchExecutionEnvironments = (): Promise<DashboardExecutionEnvironmentRecord[]> =>
  dashboardApi.listExecutionEnvironments();

export const createExecutionEnvironment = (
  payload: DashboardExecutionEnvironmentCreateInput,
): Promise<DashboardExecutionEnvironmentRecord> =>
  dashboardApi.createExecutionEnvironment(payload);

export const createExecutionEnvironmentFromCatalog = (
  payload: DashboardExecutionEnvironmentCreateFromCatalogInput,
): Promise<DashboardExecutionEnvironmentRecord> =>
  dashboardApi.createExecutionEnvironmentFromCatalog(payload);

export const updateExecutionEnvironment = (
  environmentId: string,
  payload: DashboardExecutionEnvironmentUpdateInput,
): Promise<DashboardExecutionEnvironmentRecord> =>
  dashboardApi.updateExecutionEnvironment(environmentId, payload);

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
