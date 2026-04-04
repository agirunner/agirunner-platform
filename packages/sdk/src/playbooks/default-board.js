const defaultPlaybookBoardTemplate = Object.freeze({
    entry_column_id: 'inbox',
    columns: Object.freeze([
        Object.freeze({ id: 'inbox', label: 'Inbox', description: '' }),
        Object.freeze({ id: 'active', label: 'Active', description: '' }),
        Object.freeze({ id: 'blocked', label: 'Blocked', description: '', is_blocked: true }),
        Object.freeze({ id: 'done', label: 'Done', description: '', is_terminal: true }),
    ]),
});
export function createDefaultPlaybookBoard() {
    return {
        entry_column_id: defaultPlaybookBoardTemplate.entry_column_id,
        columns: defaultPlaybookBoardTemplate.columns.map((column) => ({ ...column })),
    };
}
