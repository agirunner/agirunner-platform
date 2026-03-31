import { Loader2 } from 'lucide-react';

import {
  type DashboardCommunityCatalogConflict,
  type DashboardCommunityCatalogConflictAction,
  type DashboardCommunityCatalogImportPreview,
  type DashboardCommunityCatalogPlaybookDetail,
} from '../../../lib/api.js';
import { Badge } from '../../../components/ui/badge.js';
import { Button } from '../../../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select.js';
import { Separator } from '../../../components/ui/separator.js';
import { resolveCommunityCatalogConflictAction } from './playbook-community-import.support.js';

export function PlaybookCommunityImportPreview(props: {
  highlightedDetail: DashboardCommunityCatalogPlaybookDetail | null;
  isDetailLoading: boolean;
  detailError: string | null;
  isReadmeVisible: boolean;
  onToggleReadme(): void;
  selectedCount: number;
  preview: DashboardCommunityCatalogImportPreview | null;
  isPreviewLoading: boolean;
  previewError: string | null;
  defaultConflictResolution: DashboardCommunityCatalogConflictAction;
  conflictResolutions: Record<string, DashboardCommunityCatalogConflictAction>;
  onDefaultConflictResolutionChange(value: DashboardCommunityCatalogConflictAction): void;
  onConflictResolutionChange(
    conflictKey: string,
    value: DashboardCommunityCatalogConflictAction,
  ): void;
}): JSX.Element {
  return (
    <div className="grid gap-4">
      <Card className="border-border/70 bg-card/80 shadow-sm">
        <CardHeader className="space-y-2">
          <CardTitle>Catalog Preview</CardTitle>
          <p className="text-sm text-muted">
            Review the highlighted playbook and inspect its README before importing.
          </p>
        </CardHeader>
        <CardContent className="grid gap-4">
          {props.isDetailLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading playbook details…
            </div>
          ) : props.detailError ? (
            <p className="text-sm text-red-600 dark:text-red-400">{props.detailError}</p>
          ) : props.highlightedDetail ? (
            <>
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-semibold">{props.highlightedDetail.playbook.name}</h3>
                  <Badge variant="outline">v{props.highlightedDetail.playbook.version}</Badge>
                  <span className="text-xs font-medium uppercase tracking-[0.12em] text-muted">
                    by {props.highlightedDetail.playbook.author}
                  </span>
                  <Badge
                    variant={
                      props.highlightedDetail.playbook.stability === 'experimental'
                        ? 'warning'
                        : 'success'
                    }
                  >
                    {props.highlightedDetail.playbook.stability === 'experimental'
                      ? 'Experimental'
                      : 'Stable'}
                  </Badge>
                </div>
                <p className="text-sm text-muted">{props.highlightedDetail.playbook.description}</p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-muted">
                <span>{props.highlightedDetail.specialists.length} specialists</span>
                <span>·</span>
                <span>{props.highlightedDetail.skills.length} skills</span>
                <span>·</span>
                <span>{props.highlightedDetail.playbook.category}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={props.onToggleReadme}>
                  {props.isReadmeVisible ? 'Hide README' : 'View README'}
                </Button>
              </div>
              {props.isReadmeVisible ? (
                <div className="max-h-72 overflow-y-auto rounded-xl border border-border/70 bg-background/70 p-4">
                  <div className="whitespace-pre-wrap text-sm leading-6 text-foreground">
                    {props.highlightedDetail.playbook.readme}
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-muted">
              Select a community playbook to inspect its summary and README.
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/70 bg-card/80 shadow-sm">
        <CardHeader className="space-y-2">
          <CardTitle>Import Preview</CardTitle>
          <p className="text-sm text-muted">
            Review the selected set, referenced artifacts, and any conflicts that need an import decision.
          </p>
        </CardHeader>
        <CardContent className="grid gap-4">
          {props.selectedCount === 0 ? (
            <p className="text-sm text-muted">
              Select one or more playbooks to build the import preview.
            </p>
          ) : props.isPreviewLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              Building import preview…
            </div>
          ) : props.previewError ? (
            <p className="text-sm text-red-600 dark:text-red-400">{props.previewError}</p>
          ) : props.preview ? (
            <>
              <div className="grid gap-3 md:grid-cols-3">
                <PreviewMetric label="Selected playbooks" value={props.preview.selectedPlaybooks.length} />
                <PreviewMetric label="Referenced specialists" value={props.preview.referencedSpecialistCount} />
                <PreviewMetric label="Referenced skills" value={props.preview.referencedSkillCount} />
              </div>

              <div className="grid gap-3">
                <PreviewList
                  title="Playbooks"
                  items={props.preview.selectedPlaybooks.map((item) => ({
                    id: item.id,
                    title: item.name,
                    subtitle: item.summary,
                    badge: item.stability === 'experimental' ? 'Experimental' : 'Stable',
                    badgeVariant: item.stability === 'experimental' ? 'warning' : 'success',
                  }))}
                />
                <PreviewList
                  title="Specialists"
                  items={props.preview.referencedSpecialists.map((item) => ({
                    id: item.id,
                    title: item.name,
                    subtitle: item.summary,
                    badge: item.category,
                    badgeVariant: 'outline',
                  }))}
                />
                <PreviewList
                  title="Skills"
                  items={props.preview.referencedSkills.map((item) => ({
                    id: item.id,
                    title: item.name,
                    subtitle: item.summary,
                    badge: item.category,
                    badgeVariant: 'outline',
                  }))}
                />
              </div>

              <Separator />

              <label className="grid gap-2 text-sm">
                <span className="font-medium">Default conflict action</span>
                <Select
                  value={props.defaultConflictResolution}
                  onValueChange={(value) =>
                    props.onDefaultConflictResolutionChange(value as DashboardCommunityCatalogConflictAction)
                  }
                >
                  <SelectTrigger aria-label="Default conflict action">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="create_new">Create new</SelectItem>
                    <SelectItem value="override_existing">Override existing</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted">
                  This applies where the selected action is allowed. Specialist conflicts will still stay override-only.
                </p>
              </label>

              <div className="grid gap-3">
                <h3 className="text-sm font-medium">Conflicts</h3>
                {props.preview.conflicts.length === 0 ? (
                  <p className="text-sm text-muted">No local conflicts were detected for the current selection.</p>
                ) : (
                  props.preview.conflicts.map((conflict) => (
                    <ConflictCard
                      key={conflict.key}
                      conflict={conflict}
                      value={resolveCommunityCatalogConflictAction(
                        conflict,
                        props.defaultConflictResolution,
                        props.conflictResolutions,
                      )}
                      onChange={(value) => props.onConflictResolutionChange(conflict.key, value)}
                    />
                  ))
                )}
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function PreviewMetric(props: { label: string; value: number }): JSX.Element {
  return (
    <div className="rounded-xl border border-border/70 bg-background/70 px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">
        {props.label}
      </div>
      <div className="mt-2 text-2xl font-semibold text-foreground">{props.value}</div>
    </div>
  );
}

function PreviewList(props: {
  title: string;
  items: Array<{
    id: string;
    title: string;
    subtitle: string;
    badge: string;
    badgeVariant: 'outline' | 'warning' | 'success';
  }>;
}): JSX.Element {
  return (
    <div className="grid gap-2">
      <h3 className="text-sm font-medium">{props.title}</h3>
      <div className="grid gap-2">
        {props.items.map((item) => (
          <div
            key={item.id}
            className="rounded-xl border border-border/70 bg-background/70 px-3 py-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-foreground">{item.title}</span>
              <Badge variant={item.badgeVariant}>{item.badge}</Badge>
            </div>
            <p className="mt-1 text-sm text-muted">{item.subtitle}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function ConflictCard(props: {
  conflict: DashboardCommunityCatalogConflict;
  value: DashboardCommunityCatalogConflictAction;
  onChange(value: DashboardCommunityCatalogConflictAction): void;
}): JSX.Element {
  return (
    <div className="grid gap-3 rounded-xl border border-border/70 bg-background/70 p-4">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-foreground">{props.conflict.catalogName}</span>
          <Badge variant="outline">{props.conflict.artifactType}</Badge>
        </div>
        <p className="text-sm text-muted">
          Existing local match: {props.conflict.localMatch.name}
          {props.conflict.localMatch.slug ? ` (${props.conflict.localMatch.slug})` : ''}
        </p>
      </div>
      <label className="grid gap-2 text-sm">
        <span className="font-medium">Conflict action</span>
        <Select
          value={props.value}
          onValueChange={(value) =>
            props.onChange(value as DashboardCommunityCatalogConflictAction)
          }
        >
          <SelectTrigger aria-label={`Conflict action for ${props.conflict.catalogName}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {props.conflict.availableActions.map((action) => (
              <SelectItem key={action} value={action}>
                {action === 'create_new' ? 'Create new' : 'Override existing'}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
    </div>
  );
}
