import { dashboardApi } from '../../lib/api.js';
import type { RuntimeDefault } from './runtime-defaults.types.js';

export async function fetchRuntimeDefaults(): Promise<RuntimeDefault[]> {
  return dashboardApi.listRuntimeDefaults();
}

export async function upsertRuntimeDefault(input: {
  configKey: string;
  configValue: string;
  configType: 'string' | 'number';
  description: string;
}): Promise<void> {
  return dashboardApi.upsertRuntimeDefault(input);
}

export async function deleteRuntimeDefault(id: string): Promise<void> {
  return dashboardApi.deleteRuntimeDefault(id);
}
