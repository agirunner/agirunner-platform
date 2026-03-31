export type PlaybookLifecycle = 'planned' | 'ongoing';

export interface RoleDraft {
  value: string;
}

export interface BoardColumnDraft {
  id: string;
  label: string;
  description: string;
  is_blocked: boolean;
  is_terminal: boolean;
}

export interface StageDraft {
  name: string;
  goal: string;
  guidance: string;
}

export interface ParameterDraft {
  slug: string;
  title: string;
  required: boolean;
}

export interface PlaybookAuthoringDraft {
  process_instructions: string;
  roles: RoleDraft[];
  columns: BoardColumnDraft[];
  entry_column_id: string;
  stages: StageDraft[];
  parameters: ParameterDraft[];
  orchestrator: {
    max_rework_iterations: string;
    max_iterations: string;
    llm_max_retries: string;
    max_active_tasks: string;
    max_active_tasks_per_work_item: string;
    allow_parallel_work_items: '' | 'true' | 'false';
  };
}

export interface PlaybookAuthoringSummary {
  hasProcessInstructions: boolean;
  roleCount: number;
  stageCount: number;
  columnCount: number;
  blockedColumnCount: number;
  terminalColumnCount: number;
  parameterCount: number;
  runtimeOverrideCount: number;
}

export interface BoardColumnValidationResult {
  columnErrors: Array<{ id?: string; label?: string }>;
  entryColumnError?: string;
  blockedColumnError?: string;
  terminalColumnError?: string;
  blockingIssues: string[];
  isValid: boolean;
}

export interface WorkflowRuleValidationResult {
  stageErrors: Array<{ name?: string; goal?: string }>;
  blockingIssues: string[];
  isValid: boolean;
}

export interface ParameterDraftValidationResult {
  parameterErrors: Array<{ slug?: string; title?: string }>;
  blockingIssues: string[];
  isValid: boolean;
}

export interface RoleDraftValidationResult {
  roleErrors: Array<string | undefined>;
  selectionIssue?: string;
  blockingIssues: string[];
  isValid: boolean;
}
