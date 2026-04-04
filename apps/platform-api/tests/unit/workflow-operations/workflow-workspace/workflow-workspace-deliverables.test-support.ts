export function buildWorkflowScope() {
  return {
    scope_kind: 'workflow',
    workflow_id: 'workflow-1',
    work_item_id: null,
    task_id: null,
  } as const;
}

export function buildBoard() {
  return {
    columns: [
      { id: 'active', is_terminal: false },
      { id: 'done', is_terminal: true },
    ],
    work_items: [
      {
        id: 'work-item-1',
        column_id: 'active',
        completed_at: null,
      },
      {
        id: 'work-item-2',
        column_id: 'done',
        completed_at: '2026-04-03T23:31:00.000Z',
      },
    ],
  };
}
