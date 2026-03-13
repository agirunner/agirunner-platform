import { useEffect } from 'react';

import type { ProjectTimelineSummary, RecentWorkflowEntry } from './project-memory-support.js';

export interface MemoryOverviewCard {
  label: string;
  value: string;
  detail: string;
}

export function buildMemoryOverviewCards(input: {
  projectEntryCount: number;
  workItemEntryCount: number;
  historyEntryCount: number;
  timelineSummary: ProjectTimelineSummary;
}): MemoryOverviewCard[] {
  return [
    {
      label: 'Visible memory',
      value: String(input.projectEntryCount + input.workItemEntryCount),
      detail: `${input.projectEntryCount} project keys and ${input.workItemEntryCount} scoped entries in view.`,
    },
    {
      label: 'Project workflows',
      value: String(input.timelineSummary.totalCount),
      detail: `${input.timelineSummary.activeCount} workflows still active.`,
    },
    {
      label: 'Scoped history',
      value: String(input.historyEntryCount),
      detail:
        input.historyEntryCount > 0
          ? 'Revision history is ready for diff review.'
          : 'Select a work item to review scoped history.',
    },
  ];
}

export function describeMemoryNextAction(input: {
  selectedProjectId: string;
  selectedWorkflowName: string | null;
  selectedWorkItemTitle: string | null;
  projectEntryCount: number;
  workItemEntryCount: number;
  filteredProjectEntryCount: number;
  filteredWorkItemEntryCount: number;
}): string {
  if (!input.selectedProjectId) {
    return 'Select a project to inspect shared memory and recent workflow context.';
  }
  if (!input.selectedWorkflowName) {
    return 'Choose a workflow to narrow project memory down to live board context.';
  }
  if (!input.selectedWorkItemTitle) {
    return 'Pick a work item to inspect scoped memory and revision history.';
  }
  if (input.filteredProjectEntryCount === 0 && input.filteredWorkItemEntryCount === 0) {
    return 'Adjust the current filters to bring the relevant memory packet back into view.';
  }
  if (input.workItemEntryCount === 0) {
    return 'Inspect project memory first; this work item has not written scoped memory yet.';
  }
  return `Review ${input.selectedWorkItemTitle} memory, then confirm shared project memory still aligns with ${input.selectedWorkflowName}.`;
}

export function describeScopeBadge(input: {
  selectedWorkflowName: string | null;
  selectedWorkItemTitle: string | null;
}): string {
  if (input.selectedWorkItemTitle) {
    return 'Work-item scope';
  }
  if (input.selectedWorkflowName) {
    return 'Workflow scope';
  }
  return 'Project scope';
}

export function describeRecentWorkflowPosture(workflow: RecentWorkflowEntry): string {
  if (workflow.state === 'active' || workflow.state === 'pending') {
    return 'Review this workflow before editing shared project memory.';
  }
  if (workflow.state === 'paused') {
    return 'Paused workflow; inspect the board before changing shared context.';
  }
  return 'Historical workflow context only.';
}

export function useScopedSelection(input: {
  scopedProjectId: string;
  scopedWorkflowId: string;
  scopedWorkItemId: string;
  selectedProjectId: string;
  selectedWorkflowId: string;
  selectedWorkItemId: string;
  setSelectedProjectId(value: string): void;
  setSelectedWorkflowId(value: string): void;
  setSelectedWorkItemId(value: string): void;
}): void {
  useEffect(() => {
    if (input.scopedProjectId && input.selectedProjectId !== input.scopedProjectId) {
      input.setSelectedProjectId(input.scopedProjectId);
    }
  }, [input.scopedProjectId, input.selectedProjectId, input.setSelectedProjectId]);

  useEffect(() => {
    if (input.scopedWorkflowId && input.selectedWorkflowId !== input.scopedWorkflowId) {
      input.setSelectedWorkflowId(input.scopedWorkflowId);
    }
  }, [input.scopedWorkflowId, input.selectedWorkflowId, input.setSelectedWorkflowId]);

  useEffect(() => {
    if (input.scopedWorkItemId && input.selectedWorkItemId !== input.scopedWorkItemId) {
      input.setSelectedWorkItemId(input.scopedWorkItemId);
    }
  }, [input.scopedWorkItemId, input.selectedWorkItemId, input.setSelectedWorkItemId]);
}

export function useSelectionGuards(input: {
  workflows: Array<{ id: string }>;
  workItems: Array<{ id: string }>;
  selectedWorkflowId: string;
  selectedWorkItemId: string;
  historyAuthorOptions: Array<{ value: string }>;
  historyKeyOptions: Array<{ value: string }>;
  selectedHistoryAuthor: string;
  selectedHistoryKey: string;
  setSelectedWorkflowId(value: string): void;
  setSelectedWorkItemId(value: string): void;
  setSelectedHistoryAuthor(value: string): void;
  setSelectedHistoryKey(value: string): void;
}): void {
  useEffect(() => {
    if (input.workflows.length === 0) {
      input.setSelectedWorkflowId('');
      input.setSelectedWorkItemId('');
      return;
    }
    if (
      input.selectedWorkflowId &&
      !input.workflows.some((workflow) => workflow.id === input.selectedWorkflowId)
    ) {
      input.setSelectedWorkflowId(input.workflows[0].id);
      input.setSelectedWorkItemId('');
    }
  }, [
    input.workflows,
    input.selectedWorkflowId,
    input.setSelectedWorkflowId,
    input.setSelectedWorkItemId,
  ]);

  useEffect(() => {
    if (input.workItems.length === 0) {
      input.setSelectedWorkItemId('');
      return;
    }
    if (
      input.selectedWorkItemId &&
      !input.workItems.some((workItem) => workItem.id === input.selectedWorkItemId)
    ) {
      input.setSelectedWorkItemId('');
    }
  }, [input.workItems, input.selectedWorkItemId, input.setSelectedWorkItemId]);

  useEffect(() => {
    if (
      input.selectedHistoryAuthor &&
      !input.historyAuthorOptions.some((option) => option.value === input.selectedHistoryAuthor)
    ) {
      input.setSelectedHistoryAuthor('');
    }
  }, [
    input.selectedHistoryAuthor,
    input.historyAuthorOptions,
    input.setSelectedHistoryAuthor,
  ]);

  useEffect(() => {
    if (input.historyKeyOptions.length === 0) {
      if (input.selectedHistoryKey) {
        input.setSelectedHistoryKey('');
      }
      return;
    }
    if (
      !input.selectedHistoryKey ||
      !input.historyKeyOptions.some((option) => option.value === input.selectedHistoryKey)
    ) {
      input.setSelectedHistoryKey(input.historyKeyOptions[0].value);
    }
  }, [
    input.historyKeyOptions,
    input.selectedHistoryKey,
    input.setSelectedHistoryKey,
  ]);
}

export function useMemorySearchParams(input: {
  scopedProjectId: string;
  scopedWorkflowId: string;
  scopedWorkItemId: string;
  selectedProjectId: string;
  selectedWorkflowId: string;
  selectedWorkItemId: string;
  searchQuery: string;
  selectedHistoryAuthor: string;
  selectedHistoryKey: string;
  searchParams: URLSearchParams;
  setSearchParams(next: URLSearchParams, options: { replace: boolean }): void;
}): void {
  useEffect(() => {
    const next = new URLSearchParams();
    if (!input.scopedProjectId && input.selectedProjectId) {
      next.set('project', input.selectedProjectId);
    }
    if (!input.scopedWorkflowId && input.selectedWorkflowId) {
      next.set('workflow', input.selectedWorkflowId);
    }
    if (!input.scopedWorkItemId && input.selectedWorkItemId) {
      next.set('work_item', input.selectedWorkItemId);
    }
    if (input.searchQuery) {
      next.set('q', input.searchQuery);
    }
    if (input.selectedHistoryAuthor) {
      next.set('author', input.selectedHistoryAuthor);
    }
    if (input.selectedHistoryKey) {
      next.set('key', input.selectedHistoryKey);
    }
    if (next.toString() !== input.searchParams.toString()) {
      input.setSearchParams(next, { replace: true });
    }
  }, [
    input.scopedProjectId,
    input.scopedWorkflowId,
    input.scopedWorkItemId,
    input.selectedProjectId,
    input.selectedWorkflowId,
    input.selectedWorkItemId,
    input.searchQuery,
    input.selectedHistoryAuthor,
    input.selectedHistoryKey,
    input.searchParams,
    input.setSearchParams,
  ]);
}
