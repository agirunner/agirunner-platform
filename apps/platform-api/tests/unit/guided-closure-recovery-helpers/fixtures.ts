export const identity = {
  tenantId: 'tenant-1',
  keyPrefix: 'k1',
  scope: 'agent',
} as const;

export const definition = {
  lifecycle: 'planned',
  board: {
    columns: [
      { id: 'planned', label: 'Planned' },
      { id: 'done', label: 'Done', is_terminal: true },
    ],
  },
  stages: [{ name: 'review', goal: 'Review the work' }],
};
