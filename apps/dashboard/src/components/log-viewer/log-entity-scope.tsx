import { useCallback } from 'react';
import { SearchableCombobox } from './ui/searchable-combobox.js';
import { useCascadingEntities, type CascadingEntityState } from './hooks/use-cascading-entities.js';

interface LogEntityScopeProps {
  projectId: string | null;
  workflowId: string | null;
  taskId: string | null;
  onChangeEntity: (scope: { project: string | null; workflow: string | null; task: string | null }) => void;
}

export function LogEntityScope({
  projectId,
  workflowId,
  taskId,
  onChangeEntity,
}: LogEntityScopeProps): JSX.Element {
  const state: CascadingEntityState = { projectId, workflowId, taskId };

  const handleChange = useCallback(
    (next: CascadingEntityState) => {
      onChangeEntity({
        project: next.projectId,
        workflow: next.workflowId,
        task: next.taskId,
      });
    },
    [onChangeEntity],
  );

  const entities = useCascadingEntities(state, handleChange);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <SearchableCombobox
        items={entities.projects}
        value={projectId}
        onChange={entities.setProject}
        placeholder="All projects"
        searchPlaceholder="Search projects..."
        allGroupLabel="All Projects"
        onSearch={entities.searchProjects}
        isLoading={entities.isLoadingProjects}
        className="w-48"
      />
      <SearchableCombobox
        items={entities.workflows}
        value={workflowId}
        onChange={entities.setWorkflow}
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
