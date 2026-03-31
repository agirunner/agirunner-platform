import type {
  BoardColumnDraft,
  ParameterDraft,
  PlaybookAuthoringDraft,
  PlaybookLifecycle,
  RoleDraft,
  StageDraft,
} from './playbook-authoring-support.types.js';

export function createDefaultAuthoringDraft(lifecycle: PlaybookLifecycle): PlaybookAuthoringDraft {
  return {
    process_instructions:
      lifecycle === 'ongoing'
        ? 'Mandatory outcomes: keep the workflow moving, clarify new work as it arrives, and close each work item with usable output or recorded callouts. Preferred steps: seek specialist reviews, approvals, assessments, and escalations when they improve the outcome, but if a preferred step cannot complete the orchestrator must still drive to the closest responsible result, record residual risks, and close the workflow when the mandatory outcomes are satisfied.'
        : 'Mandatory outcomes: produce the requested result, move each work item through the defined stages, and close the workflow once the required output exists. Preferred steps: seek specialist reviews, approvals, assessments, and escalations when they improve quality, but if a preferred step cannot complete the orchestrator must still drive to the closest responsible result, record residual risks and waived steps, and close the workflow when the mandatory outcomes are satisfied.',
    roles: [],
    columns: [
      { id: 'inbox', label: 'Inbox', description: '', is_blocked: false, is_terminal: false },
      { id: 'active', label: 'Active', description: '', is_blocked: false, is_terminal: false },
      { id: 'review', label: 'Review', description: '', is_blocked: false, is_terminal: false },
      { id: 'blocked', label: 'Blocked', description: '', is_blocked: true, is_terminal: false },
      { id: 'done', label: 'Done', description: '', is_blocked: false, is_terminal: true },
    ],
    entry_column_id: 'inbox',
    stages: [],
    parameters: [],
    orchestrator: {
      max_rework_iterations: '',
      max_iterations: '',
      llm_max_retries: '',
      max_active_tasks: '',
      max_active_tasks_per_work_item: '',
      allow_parallel_work_items: '',
    },
  };
}

export function createEmptyRoleDraft(): RoleDraft {
  return { value: '' };
}

export function createEmptyColumnDraft(): BoardColumnDraft {
  return { id: '', label: '', description: '', is_blocked: false, is_terminal: false };
}

export function createEmptyStageDraft(): StageDraft {
  return { name: '', goal: '', guidance: '' };
}

export function createEmptyParameterDraft(): ParameterDraft {
  return {
    slug: '',
    title: '',
    required: false,
  };
}
