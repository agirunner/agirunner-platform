export interface ProjectArtifactScopeChip {
  label: string;
  value: string;
}

export function buildProjectArtifactScopeChips(input: {
  query: string;
  workflowName: string | null;
  stageName: string;
  workItemTitle: string | null;
  taskTitle: string | null;
  role: string;
  contentType: string;
  previewMode: 'all' | 'inline' | 'download';
  createdFrom: string;
  createdTo: string;
}): ProjectArtifactScopeChip[] {
  const chips: ProjectArtifactScopeChip[] = [];
  if (input.query.trim()) {
    chips.push({ label: 'Search', value: input.query.trim() });
  }
  if (input.workflowName) {
    chips.push({ label: 'Workflow', value: input.workflowName });
  }
  if (input.stageName) {
    chips.push({ label: 'Stage', value: input.stageName });
  }
  if (input.workItemTitle) {
    chips.push({ label: 'Work item', value: input.workItemTitle });
  }
  if (input.taskTitle) {
    chips.push({ label: 'Task', value: input.taskTitle });
  }
  if (input.role) {
    chips.push({ label: 'Role', value: input.role });
  }
  if (input.contentType) {
    chips.push({ label: 'Type', value: input.contentType });
  }
  if (input.previewMode === 'inline') {
    chips.push({ label: 'Delivery', value: 'Inline preview ready' });
  }
  if (input.previewMode === 'download') {
    chips.push({ label: 'Delivery', value: 'Download-only' });
  }
  if (input.createdFrom || input.createdTo) {
    chips.push({
      label: 'Created',
      value: [input.createdFrom || 'any time', input.createdTo || 'now'].join(' to '),
    });
  }
  return chips;
}

export function describeProjectArtifactNextAction(input: {
  totalArtifacts: number;
  selectedCount: number;
  selectedArtifactName: string | null;
  activeFilterCount: number;
}): string {
  if (input.totalArtifacts === 0) {
    return 'Widen the current filters or wait for downstream specialist output to publish new artifacts.';
  }
  if (input.selectedCount > 1) {
    return `Review the ${input.selectedCount} selected artifacts, then bulk-download the handoff set when you are ready to export it.`;
  }
  if (input.selectedArtifactName) {
    return `Inspect ${input.selectedArtifactName}, then open the full preview or linked task if you need deeper delivery context.`;
  }
  if (input.activeFilterCount > 0) {
    return 'Use the filtered artifact set to compare related outputs, then open a specific artifact for inline review.';
  }
  return 'Pick an artifact from the list to review payload, metadata, and upstream workflow context.';
}
