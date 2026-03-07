import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Filter, RefreshCw } from 'lucide-react';

import { dashboardApi, type DashboardEventRecord } from '../../lib/api.js';
import { cn } from '../../lib/utils.js';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/card.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '../../components/ui/table.js';

type EntityFilter = 'all' | 'workflow' | 'task' | 'worker' | 'agent';

const ENTITY_FILTERS: EntityFilter[] = ['all', 'workflow', 'task', 'worker', 'agent'];
const REFETCH_INTERVAL = 3000;

function eventTypeBadgeVariant(eventType: string): 'default' | 'success' | 'warning' | 'destructive' | 'secondary' {
  if (eventType.includes('failed') || eventType.includes('error')) {
    return 'destructive';
  }
  if (eventType.includes('completed') || eventType.includes('success')) {
    return 'success';
  }
  if (eventType.includes('approval') || eventType.includes('pending') || eventType.includes('escalat')) {
    return 'warning';
  }
  return 'secondary';
}

function normalizeEvents(response: unknown): DashboardEventRecord[] {
  if (Array.isArray(response)) {
    return response as DashboardEventRecord[];
  }
  const wrapped = response as { data?: unknown } | null;
  if (wrapped && Array.isArray(wrapped.data)) {
    return wrapped.data as DashboardEventRecord[];
  }
  return [];
}

export function ActivityFeedPage(): JSX.Element {
  const [entityFilter, setEntityFilter] = useState<EntityFilter>('all');

  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ['events', entityFilter],
    queryFn: () => {
      const filters: Record<string, string> = {};
      if (entityFilter !== 'all') {
        filters.entity_type = entityFilter;
      }
      return dashboardApi.listEvents(filters);
    },
    refetchInterval: REFETCH_INTERVAL,
  });

  const events = useMemo(() => normalizeEvents(data), [data]);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Activity Feed</h1>
        {isFetching && <RefreshCw className="h-4 w-4 animate-spin text-muted" />}
      </div>

      <FilterBar activeFilter={entityFilter} onFilterChange={setEntityFilter} />

      {isLoading && (
        <div className="flex items-center justify-center p-12 text-muted">
          <RefreshCw className="mr-2 h-5 w-5 animate-spin" />
          Loading events...
        </div>
      )}

      {error && (
        <Card className="border-red-300">
          <CardContent className="p-6 text-red-600">
            Failed to load events. Please retry.
          </CardContent>
        </Card>
      )}

      {!isLoading && !error && <EventTable events={events} />}
    </div>
  );
}

interface FilterBarProps {
  activeFilter: EntityFilter;
  onFilterChange: (filter: EntityFilter) => void;
}

function FilterBar({ activeFilter, onFilterChange }: FilterBarProps): JSX.Element {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <Filter className="h-4 w-4 text-muted" />
        <span className="text-sm font-medium text-muted">Entity Type:</span>
        <div className="flex flex-wrap gap-2">
          {ENTITY_FILTERS.map((filter) => (
            <Button
              key={filter}
              size="sm"
              variant={activeFilter === filter ? 'default' : 'outline'}
              onClick={() => onFilterChange(filter)}
            >
              {filter === 'all' ? 'All' : filter.charAt(0).toUpperCase() + filter.slice(1)}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

interface EventTableProps {
  events: DashboardEventRecord[];
}

function EventTable({ events }: EventTableProps): JSX.Element {
  if (events.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-muted">
          No events match the current filter.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Events ({events.length})</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Timestamp</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Entity</TableHead>
              <TableHead>Actor</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.map((event) => (
              <TableRow key={event.id}>
                <TableCell className="whitespace-nowrap text-xs text-muted">
                  {new Date(event.created_at).toLocaleString()}
                </TableCell>
                <TableCell>
                  <Badge variant={eventTypeBadgeVariant(event.type)}>{event.type}</Badge>
                </TableCell>
                <TableCell>
                  <span className="text-sm">
                    <span className="font-medium">{event.entity_type}</span>
                    {event.entity_id && (
                      <span className="ml-1 text-muted">({event.entity_id.slice(0, 8)})</span>
                    )}
                  </span>
                </TableCell>
                <TableCell>
                  <span className={cn('text-sm', event.actor_id ? '' : 'text-muted')}>
                    {event.actor_type}
                    {event.actor_id && <span className="ml-1 text-muted">({event.actor_id.slice(0, 8)})</span>}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
