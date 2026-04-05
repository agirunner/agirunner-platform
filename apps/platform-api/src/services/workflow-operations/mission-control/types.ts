export type MissionControlWorkflowPosture =
  | 'needs_decision'
  | 'needs_intervention'
  | 'recoverable_needs_steering'
  | 'progressing'
  | 'waiting_by_design'
  | 'cancelling'
  | 'paused'
  | 'terminal_failed'
  | 'completed'
  | 'cancelled';

export type MissionControlAttentionLane =
  | 'needs_decision'
  | 'needs_intervention'
  | 'watchlist';

export type MissionControlPulseTone =
  | 'progressing'
  | 'waiting'
  | 'warning'
  | 'critical'
  | 'settled';

export interface MissionControlReadModelVersion {
  generatedAt: string;
  latestEventId: number | null;
  token: string | null;
}

export interface MissionControlPulse {
  summary: string;
  tone: MissionControlPulseTone;
  updatedAt: string | null;
}

export interface MissionControlAttentionItem {
  id: string;
  lane: MissionControlAttentionLane;
  title: string;
  workflowId: string;
  summary: string;
}

export type MissionControlActionKind =
  | 'pause_workflow'
  | 'resume_workflow'
  | 'cancel_workflow'
  | 'add_work_item'
  | 'request_replan'
  | 'spawn_child_workflow'
  | 'redrive_workflow'
  | 'approve_task'
  | 'reject_task'
  | 'request_changes_task'
  | 'retry_task'
  | 'skip_task'
  | 'reassign_task'
  | 'resolve_escalation';

export type MissionControlActionScope =
  | 'workflow'
  | 'work_item'
  | 'task';

export type MissionControlConfirmationLevel =
  | 'immediate'
  | 'standard_confirm'
  | 'high_impact_confirm';

export interface MissionControlActionAvailability {
  kind: MissionControlActionKind;
  scope: MissionControlActionScope;
  enabled: boolean;
  confirmationLevel: MissionControlConfirmationLevel;
  stale: boolean;
  disabledReason: string | null;
}

export type MissionControlOutputStatus =
  | 'draft'
  | 'under_review'
  | 'approved'
  | 'superseded'
  | 'final';

export interface MissionControlArtifactLocation {
  kind: 'artifact';
  artifactId: string;
  taskId: string;
  logicalPath: string;
  previewPath: string | null;
  downloadPath: string;
  contentType: string | null;
  sizeBytes: number | null;
}

export interface MissionControlRepositoryLocation {
  kind: 'repository';
  repository: string;
  branch: string | null;
  branchUrl: string | null;
  commitSha: string | null;
  commitUrl: string | null;
  pullRequestUrl: string | null;
}

export interface MissionControlHostDirectoryLocation {
  kind: 'host_directory';
  path: string;
}

export interface MissionControlWorkflowDocumentLocation {
  kind: 'workflow_document';
  workflowId: string;
  documentId: string;
  logicalName: string;
  source: 'repository' | 'artifact' | 'external';
  location: string;
  artifactId: string | null;
}

export interface MissionControlExternalUrlLocation {
  kind: 'external_url';
  url: string;
}

export type MissionControlOutputLocation =
  | MissionControlArtifactLocation
  | MissionControlRepositoryLocation
  | MissionControlHostDirectoryLocation
  | MissionControlWorkflowDocumentLocation
  | MissionControlExternalUrlLocation;

export interface MissionControlOutputDescriptor {
  id: string;
  title: string;
  summary: string | null;
  status: MissionControlOutputStatus;
  recordedAt?: string | null;
  producedByRole: string | null;
  workItemId: string | null;
  taskId: string | null;
  stageName: string | null;
  primaryLocation: MissionControlOutputLocation;
  secondaryLocations: MissionControlOutputLocation[];
}

export interface MissionControlWorkflowMetrics {
  activeTaskCount: number;
  activeWorkItemCount: number;
  blockedWorkItemCount: number;
  openEscalationCount: number;
  waitingForDecisionCount: number;
  failedTaskCount: number;
  recoverableIssueCount: number;
  lastChangedAt: string | null;
}

export interface MissionControlWorkflowCard {
  id: string;
  name: string;
  state: string;
  lifecycle: string | null;
  currentStage: string | null;
  workspaceId: string | null;
  workspaceName: string | null;
  playbookId: string | null;
  playbookName: string | null;
  posture: MissionControlWorkflowPosture;
  attentionLane: MissionControlAttentionLane;
  pulse: MissionControlPulse;
  outputDescriptors: MissionControlOutputDescriptor[];
  availableActions: MissionControlActionAvailability[];
  metrics: MissionControlWorkflowMetrics;
  version: MissionControlReadModelVersion;
}

export interface MissionControlLiveSection {
  id: 'needs_action' | 'at_risk' | 'progressing' | 'waiting' | 'recently_changed';
  title: string;
  count: number;
  workflows: MissionControlWorkflowCard[];
}

export interface MissionControlLiveResponse {
  version: MissionControlReadModelVersion;
  sections: MissionControlLiveSection[];
  attentionItems: MissionControlAttentionItem[];
}

export type MissionControlPacketCategory =
  | 'decision'
  | 'intervention'
  | 'progress'
  | 'output'
  | 'system';

export interface MissionControlPacket {
  id: string;
  workflowId: string;
  workflowName: string | null;
  posture: MissionControlWorkflowPosture | null;
  category: MissionControlPacketCategory;
  title: string;
  summary: string;
  changedAt: string;
  carryover: boolean;
  outputDescriptors: MissionControlOutputDescriptor[];
}

export interface MissionControlRecentResponse {
  version: MissionControlReadModelVersion;
  packets: MissionControlPacket[];
}

export interface MissionControlHistoryResponse {
  version: MissionControlReadModelVersion;
  packets: MissionControlPacket[];
}

export interface MissionControlWorkspaceOverview {
  currentOperatorAsk: string | null;
  latestOutput: MissionControlOutputDescriptor | null;
  inputSummary: {
    parameterCount: number;
    parameterKeys: string[];
    contextKeys: string[];
  };
  relationSummary: Record<string, unknown>;
  riskSummary: {
    blockedWorkItemCount: number;
    openEscalationCount: number;
    failedTaskCount: number;
    recoverableIssueCount: number;
  };
}

export interface MissionControlWorkspaceResponse {
  version: MissionControlReadModelVersion;
  workflow: MissionControlWorkflowCard | null;
  overview: MissionControlWorkspaceOverview | null;
  board: Record<string, unknown> | null;
  outputs: {
    deliverables: MissionControlOutputDescriptor[];
    feed: MissionControlPacket[];
  };
  steering: {
    availableActions: MissionControlActionAvailability[];
    interventionHistory: MissionControlPacket[];
  };
  history: {
    packets: MissionControlPacket[];
  };
}
