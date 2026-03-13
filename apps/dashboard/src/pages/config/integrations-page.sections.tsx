import { Search } from 'lucide-react';

import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import { Input } from '../../components/ui/input.js';
import type {
  IntegrationLibrarySummaryCard,
  IntegrationScopeFilter,
  IntegrationStatusFilter,
} from './integrations-page.support.js';

export function IntegrationSummaryCards(props: {
  cards: IntegrationLibrarySummaryCard[];
}): JSX.Element {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {props.cards.map((card) => (
        <Card key={card.label} className="border-border/70 shadow-sm">
          <CardHeader className="space-y-1">
            <p className="text-sm font-medium text-muted">{card.label}</p>
            <CardTitle className="text-xl">{card.value}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-6 text-muted">{card.detail}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function IntegrationFilters(props: {
  search: string;
  statusFilter: IntegrationStatusFilter;
  scopeFilter: IntegrationScopeFilter;
  onSearchChange(value: string): void;
  onStatusFilterChange(value: IntegrationStatusFilter): void;
  onScopeFilterChange(value: IntegrationScopeFilter): void;
}): JSX.Element {
  return (
    <Card className="border-border/70 shadow-sm">
      <CardHeader className="space-y-1">
        <CardTitle className="text-base">Library filters</CardTitle>
        <p className="text-sm text-muted">
          Narrow the integrations list by destination status, delivery scope, or search terms.
        </p>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-[minmax(0,1fr),auto,auto]">
        <div className="relative max-w-xl">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input
            value={props.search}
            onChange={(event) => props.onSearchChange(event.target.value)}
            placeholder="Search integrations..."
            className="pl-9"
          />
        </div>
        <SegmentedFilter
          label="Status"
          value={props.statusFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'active', label: 'Active' },
            { value: 'paused', label: 'Paused' },
          ]}
          onChange={(value) => props.onStatusFilterChange(value as IntegrationStatusFilter)}
        />
        <SegmentedFilter
          label="Scope"
          value={props.scopeFilter}
          options={[
            { value: 'all', label: 'All scopes' },
            { value: 'global', label: 'Global' },
            { value: 'workflow', label: 'Workflow' },
          ]}
          onChange={(value) => props.onScopeFilterChange(value as IntegrationScopeFilter)}
        />
      </CardContent>
    </Card>
  );
}

function SegmentedFilter(props: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange(value: string): void;
}): JSX.Element {
  return (
    <div className="grid gap-2">
      <span className="text-xs font-medium uppercase tracking-wide text-muted">{props.label}</span>
      <div className="flex flex-wrap gap-2">
        {props.options.map((option) => (
          <Button
            key={option.value}
            type="button"
            size="sm"
            variant={props.value === option.value ? 'default' : 'outline'}
            onClick={() => props.onChange(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
