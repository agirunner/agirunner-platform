import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';

import { Button } from '../../components/ui/button.js';
import { dashboardApi } from '../../lib/api.js';
import { CreateProjectDialog } from './project-list-page.dialogs.js';
import {
  ProjectListEmptyState,
  ProjectListFilteredEmptyState,
  ProjectListGrid,
} from './project-list-page.cards.js';
import {
  buildProjectSortDirectionLabel,
  filterProjects,
  normalizeProjects,
  sortProjects,
  type ProjectListSortState,
} from './project-list-page.support.js';

export function ProjectListPage(): JSX.Element {
  const [showInactive, setShowInactive] = useState(false);
  const [sort, setSort] = useState<ProjectListSortState>({
    key: 'recent_activity',
    direction: 'desc',
  });
  const { data, isLoading, error } = useQuery({
    queryKey: ['projects'],
    queryFn: () => dashboardApi.listProjects(),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Failed to load projects: {String(error)}
        </div>
      </div>
    );
  }

  const projects = normalizeProjects(data ?? []);
  const hasInactiveProjects = projects.some((project) => project.is_active === false);
  const visibleProjects = sortProjects(filterProjects(projects, showInactive), sort);

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">Projects</h1>
          <p className="max-w-3xl text-sm text-muted">
            Open the project you need, skim the current description, and jump straight to settings,
            knowledge, automation, or delivery from the card.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {hasInactiveProjects ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowInactive((current) => !current)}
            >
              {showInactive ? 'Hide inactive' : 'Show inactive'}
            </Button>
          ) : null}
          {projects.length > 1 ? (
            <>
              <select
                aria-label="Sort projects"
                className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground shadow-sm outline-none focus:ring-2 focus:ring-ring"
                value={sort.key}
                onChange={(event) =>
                  setSort((current) => ({
                    ...current,
                    key: event.target.value as ProjectListSortState['key'],
                  }))
                }
              >
                <option value="recent_activity">Recent activity</option>
                <option value="project_name">Project name</option>
                <option value="workflow_volume">Workflow volume</option>
              </select>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setSort((current) => ({
                    ...current,
                    direction: current.direction === 'asc' ? 'desc' : 'asc',
                  }))
                }
              >
                {buildProjectSortDirectionLabel(sort.key, sort.direction)}
              </Button>
            </>
          ) : null}
          <CreateProjectDialog />
        </div>
      </div>

      {visibleProjects.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted">
          <span>{visibleProjects.length} visible project{visibleProjects.length === 1 ? '' : 's'}</span>
          {hasInactiveProjects && !showInactive ? (
            <span>{projects.length - visibleProjects.length} inactive hidden</span>
          ) : null}
        </div>
      ) : null}

      {projects.length === 0 ? (
        <ProjectListEmptyState />
      ) : visibleProjects.length === 0 ? (
        <ProjectListFilteredEmptyState
          onShowInactive={() => {
            setShowInactive(true);
          }}
        />
      ) : (
        <ProjectListGrid projects={visibleProjects} />
      )}
    </div>
  );
}
