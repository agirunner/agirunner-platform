import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { dashboardApi } from '../../lib/api.js';
import { DashboardPageHeader } from '../../components/layout/dashboard-page-header.js';
import { Skeleton } from '../../components/ui/skeleton.js';
import {
  STATUS_FILTERS,
  TASK_LIST_PAGE_SIZE,
  buildTaskSearchText,
  normalizeTaskListRecords,
  resolveTaskStatus,
  summarizeTaskPosture,
  type StatusFilter,
} from './task-list-page.support.js';
import {
  TaskListContent,
  TaskListFilters,
  TaskPostureSection,
} from './task-list-page.sections.js';

export function TaskListPage(): JSX.Element {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(STATUS_FILTERS[0]);
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(0);
  const tasksQuery = useQuery({
    queryKey: ['tasks'],
    queryFn: () => dashboardApi.listTasks(),
  });

  const allTasks = useMemo(
    () => normalizeTaskListRecords(tasksQuery.data),
    [tasksQuery.data],
  );
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const filteredTasks = useMemo(
    () =>
      allTasks.filter((task) => {
        const matchesStatus =
          statusFilter === 'all' || resolveTaskStatus(task) === statusFilter;
        if (!matchesStatus) {
          return false;
        }
        return normalizedSearch
          ? buildTaskSearchText(task).includes(normalizedSearch)
          : true;
      }),
    [allTasks, normalizedSearch, statusFilter],
  );
  const posture = useMemo(() => summarizeTaskPosture(filteredTasks), [filteredTasks]);
  const totalPages = Math.max(1, Math.ceil(filteredTasks.length / TASK_LIST_PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const paginatedTasks = filteredTasks.slice(
    safePage * TASK_LIST_PAGE_SIZE,
    (safePage + 1) * TASK_LIST_PAGE_SIZE,
  );

  if (tasksQuery.isLoading) {
    return (
      <div className="space-y-6 p-6">
        <Skeleton className="h-8 w-40" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-28 w-full" />
          ))}
        </div>
        <Skeleton className="h-56 w-full" />
      </div>
    );
  }

  if (tasksQuery.error) {
    return (
      <div className="p-6 text-red-600">
        Failed to load execution steps. Please retry when the operator API is reachable.
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <DashboardPageHeader
        navHref="/work/tasks"
        description="Operator view of specialist steps, reviews, escalations, and orchestrator turns. Lead with the next action, then open the step or board only when you need deeper context."
      />
      <TaskListFilters
        filteredCount={filteredTasks.length}
        searchQuery={searchQuery}
        statusFilter={statusFilter}
        onSearchChange={(value) => {
          setSearchQuery(value);
          setPage(0);
        }}
        onStatusChange={(value) => {
          setStatusFilter(value);
          setPage(0);
        }}
      />
      <TaskPostureSection posture={posture} />
      <TaskListContent
        tasks={paginatedTasks}
        filteredCount={filteredTasks.length}
        page={safePage}
        totalPages={totalPages}
        hasFilters={statusFilter !== 'all' || normalizedSearch.length > 0}
        onPrevious={() => setPage((current) => Math.max(0, current - 1))}
        onNext={() => setPage((current) => current + 1)}
      />
    </div>
  );
}
