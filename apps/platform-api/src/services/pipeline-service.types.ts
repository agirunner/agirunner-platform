import type { AppEnv } from '../config/schema.js';
import type { ArtifactStorageEnv } from '../content/storage-config.js';

export interface CreatePipelineInput {
  template_id: string;
  project_id?: string;
  name: string;
  parameters?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface ListPipelineQuery {
  project_id?: string;
  state?: string;
  template_id?: string;
  page: number;
  per_page: number;
}

export type PipelineServiceConfig = Pick<
  AppEnv,
  'TASK_DEFAULT_TIMEOUT_MINUTES' | 'TASK_DEFAULT_AUTO_RETRY' | 'TASK_DEFAULT_MAX_RETRIES'
> &
  ArtifactStorageEnv;
