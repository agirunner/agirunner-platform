export interface PlaybookBoardColumnTemplate {
  id: string;
  label: string;
  description?: string;
  is_blocked?: boolean;
  is_terminal?: boolean;
}

export interface PlaybookBoardTemplate {
  entry_column_id: string;
  columns: PlaybookBoardColumnTemplate[];
}

const defaultPlaybookBoardTemplate: PlaybookBoardTemplate = {
  entry_column_id: 'inbox',
  columns: [
    { id: 'inbox', label: 'Inbox', description: '' },
    { id: 'active', label: 'Active', description: '' },
    { id: 'blocked', label: 'Blocked', description: '', is_blocked: true },
    { id: 'done', label: 'Done', description: '', is_terminal: true },
  ],
};

export function createDefaultPlaybookBoard(): PlaybookBoardTemplate {
  return {
    entry_column_id: defaultPlaybookBoardTemplate.entry_column_id,
    columns: defaultPlaybookBoardTemplate.columns.map((column) => ({ ...column })),
  };
}
