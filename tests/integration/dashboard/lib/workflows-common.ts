import { dirname } from 'node:path';

export interface ApiRecord {
  id: string;
  name?: string;
  title?: string;
  workflow_id?: string;
  workspace_id?: string;
}

export const SEED_STAGE_DEFINITIONS = [
  { name: 'intake', goal: 'Clarify the request', position: 0 },
  { name: 'delivery', goal: 'Deliver the requested output', position: 1 },
] as const;

export const SEED_BOARD_COLUMNS = {
  planned: 'planned',
  active: 'doing',
  blocked: 'blocked',
  done: 'done',
} as const;

export interface SeededWorkflowsScenario {
  workspace: ApiRecord;
  plannedPlaybook: ApiRecord;
  ongoingPlaybook: ApiRecord;
  plannedWorkflow: ApiRecord;
  ongoingWorkflow: ApiRecord;
  ongoingWorkItem: ApiRecord;
  ongoingSecondaryWorkItem: ApiRecord;
  pausedWorkflow: ApiRecord;
  pausedWorkItem: ApiRecord;
  cancelledWorkflow: ApiRecord;
  cancelledWorkItem: ApiRecord;
  orchestratorOnlyWorkflow: ApiRecord;
  needsActionWorkflow: ApiRecord;
  needsActionWorkItem: ApiRecord;
  needsActionEscalationTask: ApiRecord;
  failedWorkflow: ApiRecord;
}

export interface SeededLaunchDialogScenario {
  workspaces: ApiRecord[];
  playbooks: ApiRecord[];
}

export interface WorkflowPacketSeedFile {
  fileName: string;
  content: string;
  contentType: string;
}

export function buildUploadFile(fileName: string, content: string): WorkflowPacketSeedFile {
  return {
    fileName,
    content,
    contentType: 'text/markdown',
  };
}

export function resolveSeedStageStatus(
  workflow: { lifecycle: 'planned' | 'ongoing'; state: string; currentStage?: string },
  stageName: string,
): 'pending' | 'active' | 'completed' | 'blocked' {
  if (workflow.state === 'completed') {
    return 'completed';
  }
  if (workflow.lifecycle === 'ongoing') {
    if (workflow.state === 'paused' && workflow.currentStage === stageName) {
      return 'active';
    }
    return stageName === 'intake' ? 'active' : 'pending';
  }
  if (workflow.currentStage === stageName && (workflow.state === 'active' || workflow.state === 'paused')) {
    return 'active';
  }
  if (workflow.currentStage === stageName && workflow.state === 'failed') {
    return 'blocked';
  }
  return workflow.currentStage === 'delivery' && stageName === 'intake'
    ? 'completed'
    : 'pending';
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\"'\"'`)}'`;
}

export function sqlText(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function sqlUuid(value: string): string {
  return `${sqlText(value)}::uuid`;
}

export function sqlJsonValue(value: unknown): string {
  return sqlText(JSON.stringify(value));
}

export function buildContainerFilePath(storageKey: string): string {
  return `/artifacts/${storageKey}`;
}

export function buildContainerDirectoryPath(storageKey: string): string {
  return dirname(buildContainerFilePath(storageKey));
}
