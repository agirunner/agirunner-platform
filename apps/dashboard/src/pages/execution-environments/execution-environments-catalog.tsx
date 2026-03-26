import { Plus } from 'lucide-react';

import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card.js';
import type {
  DashboardExecutionEnvironmentCatalogRecord,
  DashboardExecutionEnvironmentRecord,
} from '../../lib/api.js';

export function ExecutionEnvironmentCatalogSection(props: {
  catalog: DashboardExecutionEnvironmentCatalogRecord[];
  environments: DashboardExecutionEnvironmentRecord[];
  addingCatalogKey: string | null;
  onAddStarter: (catalog: DashboardExecutionEnvironmentCatalogRecord) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Starter environments</CardTitle>
        <CardDescription>
          Seed tenant environments from the shared catalog, then edit or verify them as needed.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {props.catalog.map((entry) => (
          <StarterCard
            key={`${entry.catalog_key}:${entry.catalog_version}`}
            entry={entry}
            existingCount={countExistingCatalogEnvironments(props.environments, entry)}
            isAdding={props.addingCatalogKey === entry.catalog_key}
            onAdd={() => props.onAddStarter(entry)}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function StarterCard(props: {
  entry: DashboardExecutionEnvironmentCatalogRecord;
  existingCount: number;
  isAdding: boolean;
  onAdd: () => void;
}) {
  return (
    <div className="rounded-xl border border-border/70 bg-background/80 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium text-foreground">{props.entry.name}</p>
        <Badge variant={props.entry.support_status === 'active' ? 'outline' : 'warning'}>
          {props.entry.support_status}
        </Badge>
        <Badge variant="secondary">{`${props.entry.catalog_key} v${props.entry.catalog_version}`}</Badge>
      </div>
      <p className="mt-2 text-sm text-muted">{props.entry.description ?? 'No description.'}</p>
      <dl className="mt-4 grid gap-2 text-sm">
        <Detail label="Image" value={props.entry.image} mono />
        <Detail label="Resources" value={`CPU ${props.entry.cpu} | Memory ${props.entry.memory}`} />
        <Detail label="Pull policy" value={props.entry.pull_policy} />
      </dl>
      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-xs text-muted">
          {props.existingCount > 0
            ? `${props.existingCount} tenant environment${props.existingCount === 1 ? '' : 's'} already seeded`
            : 'Not yet added to this tenant'}
        </span>
        <Button size="sm" onClick={props.onAdd} disabled={props.isAdding}>
          <Plus className="h-4 w-4" />
          Add starter
        </Button>
      </div>
    </div>
  );
}

function Detail(props: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted">{props.label}</dt>
      <dd className={props.mono ? 'mt-1 font-mono text-foreground' : 'mt-1 text-foreground'}>
        {props.value}
      </dd>
    </div>
  );
}

function countExistingCatalogEnvironments(
  environments: DashboardExecutionEnvironmentRecord[],
  entry: DashboardExecutionEnvironmentCatalogRecord,
): number {
  return environments.filter(
    (environment) =>
      environment.catalog_key === entry.catalog_key
      && environment.catalog_version === entry.catalog_version,
  ).length;
}
