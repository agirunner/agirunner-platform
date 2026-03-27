export type MissionControlWorkflowPosture =
  | 'needs_decision'
  | 'needs_intervention'
  | 'recoverable_needs_steering'
  | 'progressing'
  | 'waiting_by_design'
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
  producedByRole: string | null;
  workItemId: string | null;
  taskId: string | null;
  stageName: string | null;
  primaryLocation: MissionControlOutputLocation;
  secondaryLocations: MissionControlOutputLocation[];
}
