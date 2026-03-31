import type { ApiKeyIdentity } from '../../auth/api-key.js';
import type { ArtifactStorageAdapter } from '../../content/artifact-storage.js';

export const TERMINAL_WORKFLOW_STATES = ['completed', 'failed', 'cancelled'] as const;
export const TERMINAL_TASK_STATES = ['completed', 'failed', 'cancelled'] as const;
export const CANCELLABLE_WORKFLOW_STATES = ['active', 'paused'] as const;

export interface DeleteImpactSummary {
  workflows: number;
  active_workflows: number;
  tasks: number;
  active_tasks: number;
  work_items: number;
}

export interface PlaybookDeleteImpact {
  revision: DeleteImpactSummary;
  family: DeleteImpactSummary & { revisions: number };
}

export interface DestructiveDeleteDeps {
  cancelWorkflow?: (identity: ApiKeyIdentity, workflowId: string) => Promise<unknown>;
  cancelTask?: (identity: ApiKeyIdentity, taskId: string) => Promise<unknown>;
  artifactStorage?: Pick<ArtifactStorageAdapter, 'deleteObject'>;
}
