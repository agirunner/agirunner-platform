import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import { DashboardSectionCard } from '../../components/layout/dashboard-section-card.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Switch } from '../../components/ui/switch.js';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table.js';
import { SubsectionPanel } from './models-page.chrome.js';
import { formatContextWindow, getModelEnablementState } from './models-page.defaults.js';
import type { LlmModel, LlmProvider } from './models-page.types.js';

export function ModelCatalog(props: {
  models: LlmModel[];
  providers: LlmProvider[];
  onToggleEnabled(modelId: string, isEnabled: boolean): void;
}): JSX.Element {
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(new Set());

  if (props.models.length === 0) {
    return (
      <DashboardSectionCard
        id="llm-model-catalog"
        title="Model Catalog"
        description="No models registered. Models appear when providers are configured and discovery is run."
      >
        <p className="text-sm text-muted">
          Add a provider and run discovery to populate the catalog.
        </p>
      </DashboardSectionCard>
    );
  }

  const grouped = new Map<string, { providerName: string; authMode: string; models: LlmModel[] }>();
  for (const model of props.models) {
    const providerId = model.provider_id ?? 'unknown';
    if (!grouped.has(providerId)) {
      const provider = props.providers.find((entry) => entry.id === providerId);
      const providerName = model.provider_name ?? provider?.name ?? 'Unknown';
      const authMode = provider?.auth_mode ?? 'api_key';
      grouped.set(providerId, { providerName, authMode, models: [] });
    }
    grouped.get(providerId)!.models.push(model);
  }

  const apiKeyGroups = [...grouped.entries()].filter(([, group]) => group.authMode !== 'oauth');
  const subscriptionGroups = [...grouped.entries()].filter(
    ([, group]) => group.authMode === 'oauth',
  );

  function toggleProvider(providerId: string) {
    setExpandedProviders((prev) => {
      const next = new Set(prev);
      if (next.has(providerId)) {
        next.delete(providerId);
      } else {
        next.add(providerId);
      }
      return next;
    });
  }

  return (
    <div className="space-y-6">
      <DashboardSectionCard
        id="llm-model-catalog"
        title="Model Catalog"
        description={
          apiKeyGroups.length > 0
            ? `${apiKeyGroups.reduce((sum, [, group]) => sum + group.models.length, 0)} discovered API-key models.`
            : undefined
        }
        bodyClassName="space-y-2"
      >
        {apiKeyGroups.length === 0 ? (
          <p className="text-sm text-muted">
            No API-key provider models. Add a provider and run discovery.
          </p>
        ) : (
          <div className="space-y-2">
            {apiKeyGroups.map(([providerId, group]) =>
              renderProviderGroup(providerId, group, expandedProviders.has(providerId), {
                onToggleProvider: () => toggleProvider(providerId),
                onToggleEnabled: props.onToggleEnabled,
              }),
            )}
          </div>
        )}
      </DashboardSectionCard>
      {subscriptionGroups.length > 0 ? (
        <DashboardSectionCard
          title="Subscription Models"
          description={`${subscriptionGroups.reduce((sum, [, group]) => sum + group.models.length, 0)} subscription-backed models.`}
          bodyClassName="space-y-2"
        >
          <div className="space-y-2">
            {subscriptionGroups.map(([providerId, group]) =>
              renderProviderGroup(providerId, group, expandedProviders.has(providerId), {
                onToggleProvider: () => toggleProvider(providerId),
                onToggleEnabled: props.onToggleEnabled,
              }),
            )}
          </div>
        </DashboardSectionCard>
      ) : null}
    </div>
  );
}

function renderProviderGroup(
  providerId: string,
  group: { providerName: string; authMode: string; models: LlmModel[] },
  isExpanded: boolean,
  handlers: {
    onToggleProvider(): void;
    onToggleEnabled(modelId: string, isEnabled: boolean): void;
  },
): JSX.Element {
  const enabledCount = group.models.filter((model) => model.is_enabled !== false).length;
  return (
    <SubsectionPanel
      key={providerId}
      title={group.providerName}
      description={`${enabledCount} enabled of ${group.models.length} discovered models.`}
      contentClassName="space-y-0"
      headerAction={
        <div className="flex items-center gap-2">
          <Badge variant="outline">
            {enabledCount}/{group.models.length} enabled
          </Badge>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handlers.onToggleProvider}
            aria-expanded={isExpanded}
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4 text-muted" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted" />
            )}
            {isExpanded ? 'Hide models' : 'Show models'}
          </Button>
        </div>
      }
    >
      {isExpanded ? (
        <div className="overflow-x-auto border-t border-border/70 pt-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Model ID</TableHead>
                <TableHead>Context Window</TableHead>
                <TableHead>Endpoint</TableHead>
                <TableHead>Enabled</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...group.models]
                .sort((left, right) => {
                  const leftEnabled = left.is_enabled !== false ? 0 : 1;
                  const rightEnabled = right.is_enabled !== false ? 0 : 1;
                  return leftEnabled - rightEnabled;
                })
                .map((model) => {
                  const enablement = getModelEnablementState(model);
                  const isCurrentlyEnabled = model.is_enabled !== false;
                  return (
                    <TableRow key={model.id ?? model.model_id}>
                      <TableCell className="font-mono text-sm">{model.model_id}</TableCell>
                      <TableCell>{formatContextWindow(model.context_window)}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{model.endpoint_type ?? '-'}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <Switch
                            checked={isCurrentlyEnabled}
                            disabled={!enablement.canEnable && !isCurrentlyEnabled}
                            onCheckedChange={(checked) => handlers.onToggleEnabled(model.id, checked)}
                          />
                          {enablement.reason ? (
                            <p className="max-w-56 text-xs leading-5 text-muted">
                              {enablement.reason}
                            </p>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </SubsectionPanel>
  );
}
