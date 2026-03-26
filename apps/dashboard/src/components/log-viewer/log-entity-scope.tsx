import { useCallback, useState } from 'react';
import { SearchableCombobox } from './ui/searchable-combobox.js';
import { useCascadingEntities, type CascadingEntityState } from './hooks/use-cascading-entities.js';
import type { ComboboxItem } from './ui/searchable-combobox.js';

interface LogEntityScopeProps {
  workspaceId: string | null;
  workflowId: string | null;
  taskId: string | null;
  onChangeEntity: (scope: { workspace: string | null; workflow: string | null; task: string | null }) => void;
  workspacesOverride?: ComboboxItem[];
  workflowsOverride?: ComboboxItem[];
  tasksOverride?: ComboboxItem[];
  isLoadingWorkspacesOverride?: boolean;
  isLoadingWorkflowsOverride?: boolean;
  isLoadingTasksOverride?: boolean;
}

export function LogEntityScope({
  workspaceId,
  workflowId,
  taskId,
  onChangeEntity,
  workspacesOverride,
  workflowsOverride,
  tasksOverride,
  isLoadingWorkspacesOverride,
  isLoadingWorkflowsOverride,
  isLoadingTasksOverride,
}: LogEntityScopeProps): JSX.Element {
  const state: CascadingEntityState = { workspaceId, workflowId, taskId };
  const [isWorkspaceMenuOpen, setIsWorkspaceMenuOpen] = useState(false);
  const [isWorkflowMenuOpen, setIsWorkflowMenuOpen] = useState(false);
  const [isTaskMenuOpen, setIsTaskMenuOpen] = useState(false);

  const handleChange = useCallback(
    (next: CascadingEntityState) => {
      onChangeEntity({
        workspace: next.workspaceId,
        workflow: next.workflowId,
        task: next.taskId,
      });
    },
    [onChangeEntity],
  );

  const entities = useCascadingEntities(state, handleChange, {
    workspaces: workspacesOverride,
    workflows: workflowsOverride,
    tasks: tasksOverride,
    isLoadingWorkspaces: isLoadingWorkspacesOverride,
    isLoadingWorkflows: isLoadingWorkflowsOverride,
    isLoadingTasks: isLoadingTasksOverride,
    isWorkspaceMenuOpen,
    isWorkflowMenuOpen,
    isTaskMenuOpen,
  });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <SearchableCombobox
        items={entities.workspaces}
        value={workspaceId}
        onChange={entities.setWorkspace}
        onOpenChange={setIsWorkspaceMenuOpen}
        placeholder="All workspaces"
        searchPlaceholder="Search workspaces..."
        allGroupLabel="All Workspaces"
        onSearch={entities.searchWorkspaces}
        isLoading={entities.isLoadingWorkspaces}
        className="w-48"
      />
      <SearchableCombobox
        items={entities.workflows}
        value={workflowId}
        onChange={entities.setWorkflow}
        onOpenChange={setIsWorkflowMenuOpen}
        placeholder="All workflows"
        searchPlaceholder="Search workflows..."
        allGroupLabel="All Workflows"
        onSearch={entities.searchWorkflows}
        isLoading={entities.isLoadingWorkflows}
        className="w-48"
      />
      <SearchableCombobox
        items={entities.tasks}
        value={taskId}
        onChange={entities.setTask}
        onOpenChange={setIsTaskMenuOpen}
        placeholder="All tasks"
        searchPlaceholder="Search tasks..."
        allGroupLabel="All Tasks"
        onSearch={entities.searchTasks}
        isLoading={entities.isLoadingTasks}
        className="w-48"
      />
    </div>
  );
}
