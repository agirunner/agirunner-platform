import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Save } from 'lucide-react';

import type { DashboardProjectRecord } from '../../lib/api.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card.js';
import { dashboardApi } from '../../lib/api.js';
import { toast } from '../../lib/toast.js';
import { cn } from '../../lib/utils.js';
import {
  buildProjectModelOverview,
  buildRoleModelOverrides,
  hydrateRoleOverrideDrafts,
  type RoleOverrideDraft,
} from './project-detail-support.js';
import { WorkspaceMetricCard } from './project-detail-shared.js';
import { ResolvedModelCards, RoleOverrideEditor } from './project-model-overrides-sections.js';

export function ProjectModelOverridesTab({
  project,
}: {
  project: DashboardProjectRecord;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [overrideDrafts, setOverrideDrafts] = useState<RoleOverrideDraft[]>([]);
  const [isEditorExpanded, setIsEditorExpanded] = useState(false);
  const [isResolvedExpanded, setIsResolvedExpanded] = useState(false);
  const overridesQuery = useQuery({
    queryKey: ['project-model-overrides', project.id],
    queryFn: () => dashboardApi.getProjectModelOverrides(project.id),
  });
  const resolvedQuery = useQuery({
    queryKey: ['project-resolved-models', project.id],
    queryFn: () => dashboardApi.getResolvedProjectModels(project.id),
  });
  const providersQuery = useQuery({
    queryKey: ['llm-providers'],
    queryFn: () => dashboardApi.listLlmProviders(),
  });
  const modelsQuery = useQuery({
    queryKey: ['llm-models'],
    queryFn: () => dashboardApi.listLlmModels(),
  });

  useEffect(() => {
    if (!overridesQuery.data) {
      return;
    }
    const resolvedRoles = Object.keys(resolvedQuery.data?.effective_models ?? {});
    const overrideRoles = Object.keys(overridesQuery.data.model_overrides ?? {});
    const roleNames = [...new Set([...resolvedRoles, ...overrideRoles])];
    setOverrideDrafts(hydrateRoleOverrideDrafts(roleNames, overridesQuery.data.model_overrides ?? {}));
  }, [overridesQuery.data, resolvedQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const parsed = buildRoleModelOverrides(overrideDrafts) ?? {};
      return dashboardApi.patchProject(project.id, {
        settings: {
          ...asRecord(project.settings),
          model_overrides: parsed,
        },
      });
    },
    onSuccess: async () => {
      toast.success('Model overrides saved.');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['project', project.id] }),
        queryClient.invalidateQueries({ queryKey: ['project-model-overrides', project.id] }),
        queryClient.invalidateQueries({ queryKey: ['project-resolved-models', project.id] }),
      ]);
    },
  });

  const modelOverview = buildProjectModelOverview(
    overridesQuery.data?.model_overrides,
    resolvedQuery.data?.effective_models,
  );
  const overrideCount = countConfiguredDrafts(overrideDrafts);
  const resolvedSummary = summarizeResolvedModels(
    resolvedQuery.data?.effective_models ?? {},
    resolvedQuery.isLoading,
  );

  return (
    <div className="space-y-3">
      <Card className="border-border/70 shadow-none">
        <CardHeader className="space-y-1 p-4 pb-0">
          <CardTitle className="text-base">Override posture</CardTitle>
          <CardDescription className="leading-6">
            Project-only model changes are exceptional. Review the summary first, then open the
            editor only if this project truly needs to diverge.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 p-4 pt-4">
          <div className="grid gap-3 sm:grid-cols-3">
            {modelOverview.packets.map((packet) => (
              <WorkspaceMetricCard
                key={packet.label}
                label={packet.label}
                value={packet.value}
                detail={packet.detail}
              />
            ))}
          </div>
          <div className="rounded-xl border border-border/70 bg-muted/20 p-3 text-sm leading-6 text-muted">
            {modelOverview.summary}
          </div>
          <DisclosurePanel
            title="Edit overrides"
            description="Only roles that need a project-specific provider, model, or reasoning posture belong here."
            summary={
              overrideCount > 0
                ? `${overrideCount} ${overrideCount === 1 ? 'role override' : 'role overrides'} configured.`
                : 'Using shared model posture.'
            }
            isExpanded={isEditorExpanded}
            onToggle={() => setIsEditorExpanded((current) => !current)}
          >
            <div className="space-y-3">
              {overridesQuery.isLoading ? (
                <p className="text-sm text-muted">Loading project model overrides...</p>
              ) : null}
              {overridesQuery.error ? (
                <SurfaceMessage tone="warning">
                  Failed to load project model overrides.
                </SurfaceMessage>
              ) : null}
              {!overridesQuery.isLoading && !overridesQuery.error ? (
                <RoleOverrideEditor
                  drafts={overrideDrafts}
                  resolvedRoles={Object.keys(resolvedQuery.data?.effective_models ?? {})}
                  providerOptions={(providersQuery.data ?? []).map((provider) => provider.name)}
                  modelOptions={modelsQuery.data ?? []}
                  onChange={(drafts) => setOverrideDrafts(drafts)}
                />
              ) : null}
              {saveMutation.error ? (
                <SurfaceMessage tone="warning">
                  {saveMutation.error instanceof Error
                    ? saveMutation.error.message
                    : 'Failed to save project model overrides.'}
                </SurfaceMessage>
              ) : null}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-background/70 p-3">
                <p className="text-sm leading-6 text-muted">
                  Save after changing provider, model, or reasoning config so the project summary
                  stays aligned with the live posture.
                </p>
                <Button disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
                  <Save className="h-4 w-4" />
                  Save overrides
                </Button>
              </div>
            </div>
          </DisclosurePanel>
        </CardContent>
      </Card>

      <DisclosurePanel
        title="Review effective models"
        description="Open this only when you need to audit the final provider, model, or fallback outcome."
        summary={resolvedSummary}
        isExpanded={isResolvedExpanded}
        onToggle={() => setIsResolvedExpanded((current) => !current)}
      >
        <div className="space-y-3">
          {resolvedQuery.isLoading ? <p className="text-sm text-muted">Resolving effective models...</p> : null}
          {resolvedQuery.error ? (
            <SurfaceMessage tone="warning">
              Failed to load resolved effective models.
            </SurfaceMessage>
          ) : null}
          {resolvedQuery.data ? (
            <ResolvedModelCards effectiveModels={resolvedQuery.data.effective_models} />
          ) : null}
        </div>
      </DisclosurePanel>
    </div>
  );
}

function DisclosurePanel(props: {
  title: string;
  description: string;
  summary: string;
  isExpanded: boolean;
  onToggle(): void;
  children: ReactNode;
}): JSX.Element {
  return (
    <Card className="border-border/70 bg-background/70 shadow-none">
      <button
        type="button"
        className="flex w-full items-start justify-between gap-3 px-4 py-4 text-left"
        aria-expanded={props.isExpanded}
        onClick={props.onToggle}
      >
        <div className="space-y-1">
          <div className="text-sm font-semibold text-foreground">{props.title}</div>
          <p className="text-sm leading-6 text-muted">{props.description}</p>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted">
            {props.summary}
          </p>
        </div>
        <ChevronDown
          className={cn(
            'mt-1 h-4 w-4 shrink-0 text-muted transition-transform',
            props.isExpanded && 'rotate-180',
          )}
        />
      </button>
      {props.isExpanded ? (
        <CardContent className="border-t border-border/70 p-4 pt-4">{props.children}</CardContent>
      ) : null}
    </Card>
  );
}

function SurfaceMessage(props: {
  tone: 'default' | 'warning';
  children: ReactNode;
}): JSX.Element {
  const className =
    props.tone === 'warning'
      ? 'rounded-xl border border-border/70 bg-muted/30 px-3 py-2 text-sm text-rose-700 dark:text-rose-300'
      : 'rounded-xl border border-border/70 bg-muted/20 px-3 py-2 text-sm text-muted';

  return <p className={className}>{props.children}</p>;
}

function countConfiguredDrafts(drafts: RoleOverrideDraft[]): number {
  return drafts.filter((draft) =>
    Boolean(
      draft.role.trim() || draft.provider.trim() || draft.model.trim() || draft.reasoningConfig.trim(),
    ),
  ).length;
}

function summarizeResolvedModels(
  effectiveModels: Record<string, { fallback?: boolean }>,
  isLoading: boolean,
): string {
  if (isLoading) {
    return 'Loading resolved model posture.';
  }

  const resolutions = Object.values(effectiveModels);
  if (resolutions.length === 0) {
    return 'No resolved role assignments available yet.';
  }

  const fallbackCount = resolutions.filter((resolution) => resolution.fallback).length;
  if (fallbackCount > 0) {
    return `${fallbackCount} ${fallbackCount === 1 ? 'fallback' : 'fallbacks'} active.`;
  }

  return `${resolutions.length} ${resolutions.length === 1 ? 'resolved role' : 'resolved roles'} available.`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
