import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';

import { dashboardApi } from '../../lib/api.js';
import { CreateProjectDialog } from './project-list-page.dialogs.js';
import {
  ProjectListEmptyState,
  ProjectListGrid,
  ProjectListPackets,
} from './project-list-page.cards.js';
import {
  buildProjectListPackets,
  normalizeProjects,
} from './project-list-page.support.js';

export function ProjectListPage(): JSX.Element {
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
  const packets = buildProjectListPackets(projects);

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
            Project operator surface
          </p>
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold">Projects</h1>
            <p className="max-w-3xl text-sm text-muted">
              Review workspace posture, connect repositories, and step into the project that needs
              the next board, memory, or artifact intervention.
            </p>
          </div>
        </div>
        <CreateProjectDialog />
      </div>

      <ProjectListPackets packets={packets} />
      {projects.length === 0 ? <ProjectListEmptyState /> : <ProjectListGrid projects={projects} />}
    </div>
  );
}
