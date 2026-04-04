import { createDefaultPlaybookBoard } from '@agirunner/sdk';

import type {
  BoardColumnDraft,
  ParameterDraft,
  PlaybookAuthoringDraft,
  PlaybookLifecycle,
  RoleDraft,
  StageDraft,
} from './playbook-authoring-support.types.js';

export function createDefaultAuthoringDraft(lifecycle: PlaybookLifecycle): PlaybookAuthoringDraft {
  const board = createDefaultPlaybookBoard();

  return {
    process_instructions:
      lifecycle === 'ongoing'
        ? 'Mandatory outcomes: keep the workflow moving, clarify new work as it arrives, and close each work item with usable output or recorded callouts. Preferred steps: seek specialist reviews, approvals, assessments, and escalations when they improve the outcome, but if a preferred step cannot complete the orchestrator must still drive to the closest responsible result, record residual risks, and close the workflow when the mandatory outcomes are satisfied.'
        : 'Mandatory outcomes: produce the requested result, move each work item through the defined stages, and close the workflow once the required output exists. Preferred steps: seek specialist reviews, approvals, assessments, and escalations when they improve quality, but if a preferred step cannot complete the orchestrator must still drive to the closest responsible result, record residual risks and waived steps, and close the workflow when the mandatory outcomes are satisfied.',
    roles: [],
    columns: board.columns.map((column) => ({
      id: column.id,
      label: column.label,
      description: column.description ?? '',
      is_blocked: column.is_blocked ?? false,
      is_terminal: column.is_terminal ?? false,
    })),
    entry_column_id: board.entry_column_id,
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
