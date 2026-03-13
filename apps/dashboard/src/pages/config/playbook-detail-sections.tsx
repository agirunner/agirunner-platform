import { Archive, ArrowRight, Bot, Cpu, History, RotateCcw, Save, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';

import { DiffViewer } from '../../components/diff-viewer.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs.js';
import type {
  DashboardLlmModelRecord,
  DashboardLlmProviderRecord,
  DashboardPlaybookRecord,
} from '../../lib/api.js';
import {
  renderPlaybookSnapshot,
  summarizePlaybookControls,
  type PlaybookRevisionDiffRow,
} from './playbook-detail-support.js';

interface PlaybookControlCenterCardProps {
  playbook: DashboardPlaybookRecord;
  activeRoleCount: number;
  llmProviders: DashboardLlmProviderRecord[];
  llmModels: DashboardLlmModelRecord[];
}

export function PlaybookControlCenterCard(
  props: PlaybookControlCenterCardProps,
): JSX.Element {
  const summary = summarizePlaybookControls(props.playbook);
  const enabledProviderCount = props.llmProviders.filter(
    (provider) => provider.credentials_configured !== false,
  ).length;
  const enabledModelCount = props.llmModels.filter((model) => model.is_enabled !== false).length;

  return (
    <Card id="playbook-control-center">
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle>Orchestrator Configuration</CardTitle>
            <CardDescription>
              This playbook owns cadence, concurrency, stages, and runtime posture. Shared prompts,
              model catalog, and specialist escalation policy are linked here so operators can find
              the full control surface without hunting across the dashboard.
            </CardDescription>
          </div>
          <Badge variant="outline">Playbook-owned controls</Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 xl:grid-cols-[1.3fr,0.9fr]">
        <div className="grid gap-3 md:grid-cols-2">
          <SignalCard title="Team roles" value={summary.roles} href="#playbook-team-roles" />
          <SignalCard
            title="Cadence and recovery"
            value={summary.cadence}
            href="#playbook-orchestrator-controls"
          />
          <SignalCard
            title="Parallelism policy"
            value={summary.parallelism}
            href="#playbook-orchestrator-controls"
          />
          <SignalCard
            title="Runtime pools"
            value={summary.runtime}
            href="#playbook-runtime-controls"
          />
          <SignalCard
            title="Stages and gates"
            value={summary.stages}
            href="#playbook-workflow-stages"
          />
          <SignalCard
            title="Launch parameters"
            value={summary.parameters}
            href="#playbook-parameters"
          />
        </div>

        <div className="grid gap-3">
          <LinkedConfigCard
            icon={<Bot className="h-4 w-4" />}
            title="Global instructions"
            description="Platform-wide guidance applied to orchestrator and specialist context."
            value="Configure system instructions"
            href="/config/instructions"
          />
          <LinkedConfigCard
            icon={<Bot className="h-4 w-4" />}
            title="Role prompts and escalation"
            description="Specialist prompts, tool grants, verification, and escalation routing."
            value={`${props.activeRoleCount} active role definitions`}
            href="/config/roles"
          />
          <LinkedConfigCard
            icon={<Cpu className="h-4 w-4" />}
            title="Model catalog and launch policy"
            description="Provider credentials and available models used by workflow-scoped overrides."
            value={`${enabledProviderCount} providers • ${enabledModelCount} enabled models`}
            href="/config/llm"
          />
          <LinkedConfigCard
            icon={<Bot className="h-4 w-4" />}
            title="Launch-time model overrides"
            description="Preview and set role-scoped model policy for this playbook before each workflow launch."
            value="Open launch form"
            href={`/config/playbooks/${props.playbook.id}/launch`}
          />
          <LinkedConfigCard
            icon={<Cpu className="h-4 w-4" />}
            title="Runtime defaults"
            description="Global runtime posture that playbook pool overrides inherit from."
            value="Inspect shared runtime defaults"
            href="/config/runtime-defaults"
          />
        </div>
      </CardContent>
    </Card>
  );
}

interface PlaybookRevisionHistoryCardProps {
  currentPlaybook: DashboardPlaybookRecord;
  revisions: DashboardPlaybookRecord[];
  comparedRevisionId: string;
  diffRows: PlaybookRevisionDiffRow[];
  onComparedRevisionChange(nextRevisionId: string): void;
  onRestore(): void;
  isRestoring: boolean;
}

export function PlaybookRevisionHistoryCard(
  props: PlaybookRevisionHistoryCardProps,
): JSX.Element {
  const comparedPlaybook =
    props.revisions.find((revision) => revision.id === props.comparedRevisionId) ?? null;
  const canRestore =
    comparedPlaybook !== null && comparedPlaybook.id !== props.currentPlaybook.id;

  return (
    <Card id="playbook-revision-history">
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <History className="h-4 w-4" />
              Revision History
            </CardTitle>
            <CardDescription>
              Compare versions by workflow behavior, then restore an older revision as the next
              immutable playbook version.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">Current v{props.currentPlaybook.version}</Badge>
            <Button
              variant="outline"
              onClick={props.onRestore}
              disabled={!canRestore || props.isRestoring}
            >
              <RotateCcw className="h-4 w-4" />
              {canRestore && comparedPlaybook
                ? `Restore v${comparedPlaybook.version} as v${props.currentPlaybook.version + 1}`
                : 'Select an older version to restore'}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 xl:grid-cols-[0.8fr,1.2fr]">
        <div className="space-y-3">
          <label className="grid gap-2 text-sm">
            <span className="font-medium">Compare against revision</span>
            <Select
              value={props.comparedRevisionId}
              onValueChange={props.onComparedRevisionChange}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose a revision" />
              </SelectTrigger>
              <SelectContent>
                {props.revisions.map((revision) => (
                  <SelectItem key={revision.id} value={revision.id}>
                    v{revision.version} · {formatDate(revision.updated_at ?? revision.created_at)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <div className="space-y-2">
            {props.revisions.map((revision) => (
              <div
                key={revision.id}
                className="rounded-lg border border-border/70 bg-muted/10 p-3 text-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium">
                      v{revision.version}
                      {revision.id === props.currentPlaybook.id ? ' · current' : ''}
                    </div>
                    <div className="text-muted">
                      {formatDate(revision.updated_at ?? revision.created_at)}
                    </div>
                  </div>
                  <Badge variant={revision.id === props.currentPlaybook.id ? 'secondary' : 'outline'}>
                    {revision.lifecycle}
                  </Badge>
                </div>
                <div className="mt-2 text-muted">{revision.outcome}</div>
              </div>
            ))}
          </div>
        </div>

        <Tabs defaultValue="summary" className="space-y-3">
          <TabsList>
            <TabsTrigger value="summary">Structured Diff</TabsTrigger>
            <TabsTrigger value="rendered">Rendered Snapshot Diff</TabsTrigger>
          </TabsList>
          <TabsContent value="summary" className="space-y-3">
            {comparedPlaybook ? (
              <div className="space-y-2">
                {props.diffRows.map((row) => (
                  <div
                    key={row.label}
                    className={`rounded-lg border p-3 text-sm ${
                      row.changed
                        ? 'border-amber-300 bg-amber-50/70 dark:border-amber-700 dark:bg-amber-950/20'
                        : 'border-border/70 bg-muted/10'
                    }`}
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="font-medium">{row.label}</div>
                      <Badge variant={row.changed ? 'secondary' : 'outline'}>
                        {row.changed ? 'Changed' : 'Same'}
                      </Badge>
                    </div>
                    <div className="grid gap-2 md:grid-cols-2">
                      <DiffValue label={`Current v${props.currentPlaybook.version}`} value={row.current} />
                      <DiffValue label={`Compared v${comparedPlaybook.version}`} value={row.compared} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted">Select a revision to compare.</p>
            )}
          </TabsContent>
          <TabsContent value="rendered">
            {comparedPlaybook ? (
              <DiffViewer
                oldLabel={`v${comparedPlaybook.version}`}
                newLabel={`v${props.currentPlaybook.version}`}
                oldText={renderPlaybookSnapshot(comparedPlaybook)}
                newText={renderPlaybookSnapshot(props.currentPlaybook)}
              />
            ) : (
              <p className="text-sm text-muted">Select a revision to compare.</p>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

interface PlaybookEditingActionRailCardProps {
  playbookId: string;
  isActive: boolean;
  canSave: boolean;
  isSaving: boolean;
  isArchiving: boolean;
  isDeleting: boolean;
  onArchive(): void;
  onRestore(): void;
  onSave(): void;
  onDelete(): void;
}

export function PlaybookEditingActionRailCard(
  props: PlaybookEditingActionRailCardProps,
): JSX.Element {
  return (
    <Card className="border-border/70">
      <CardHeader className="space-y-2">
        <CardTitle className="text-lg">Editing Actions</CardTitle>
        <p className="text-sm text-muted">
          Keep the main workflow actions visible while the authoring sections scroll beneath them.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button
          className="w-full justify-between"
          disabled={!props.canSave || props.isSaving}
          onClick={props.onSave}
        >
          <span>Save Playbook</span>
          <Save className="h-4 w-4" />
        </Button>

        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
          <Button asChild variant="outline" className="w-full justify-between">
            <Link to="/config/roles">Manage Roles</Link>
          </Button>
          {props.isActive ? (
            <Button asChild variant="outline" className="w-full justify-between">
              <Link to={`/config/playbooks/${props.playbookId}/launch`}>Launch</Link>
            </Button>
          ) : (
            <div className="rounded-xl border border-border/70 bg-muted/15 px-4 py-3 text-sm text-muted">
              Launch stays disabled until this playbook is active again.
            </div>
          )}
          {props.isActive ? (
            <Button
              variant="destructive"
              className="w-full justify-between"
              onClick={props.onArchive}
              disabled={props.isArchiving}
            >
              <span>Archive</span>
              <Archive className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              variant="outline"
              className="w-full justify-between"
              onClick={props.onRestore}
              disabled={props.isArchiving}
            >
              <span>Restore</span>
              <RotateCcw className="h-4 w-4" />
            </Button>
          )}
        </div>

        <Button
          variant="outline"
          className="w-full justify-between"
          onClick={props.onDelete}
          disabled={props.isDeleting}
        >
          <span>Delete Revision</span>
          <Trash2 className="h-4 w-4" />
        </Button>
      </CardContent>
    </Card>
  );
}

interface PlaybookEditOutlineCardProps {
  links: Array<{
    href: string;
    title: string;
    description: string;
  }>;
}

export function PlaybookEditOutlineCard(
  props: PlaybookEditOutlineCardProps,
): JSX.Element {
  return (
    <Card className="border-border/70">
      <CardHeader className="space-y-2">
        <CardTitle className="text-lg">Jump to Editor Sections</CardTitle>
        <p className="text-sm text-muted">
          Long playbooks stay manageable when navigation is explicit. Jump straight to the part you
          need instead of re-scanning the full page.
        </p>
      </CardHeader>
      <CardContent className="grid gap-2">
        {props.links.map((link) => (
          <a
            key={link.href}
            href={link.href}
            className="rounded-xl border border-border/70 bg-muted/10 p-3 transition-colors hover:bg-muted/20"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="text-sm font-medium">{link.title}</div>
                <p className="text-sm text-muted">{link.description}</p>
              </div>
              <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
            </div>
          </a>
        ))}
      </CardContent>
    </Card>
  );
}

function SignalCard(props: {
  title: string;
  value: string;
  href: string;
}): JSX.Element {
  return (
    <a
      href={props.href}
      className="rounded-lg border border-border/70 bg-muted/10 p-4 transition-colors hover:bg-muted/20"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-sm font-medium">{props.title}</div>
        <ArrowRight className="h-4 w-4 text-muted" />
      </div>
      <p className="text-sm text-muted">{props.value}</p>
    </a>
  );
}

function LinkedConfigCard(props: {
  icon: JSX.Element;
  title: string;
  description: string;
  value: string;
  href: string;
}): JSX.Element {
  return (
    <div className="rounded-lg border border-border/70 bg-muted/10 p-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
        {props.icon}
        {props.title}
      </div>
      <p className="text-sm text-muted">{props.description}</p>
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{props.value}</span>
        <Button asChild variant="outline" size="sm">
          <Link to={props.href}>Open</Link>
        </Button>
      </div>
    </div>
  );
}

function DiffValue(props: { label: string; value: string }): JSX.Element {
  return (
    <div className="rounded-md border border-border/70 bg-surface p-3">
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">
        {props.label}
      </div>
      <div className="whitespace-pre-wrap text-sm">{props.value}</div>
    </div>
  );
}

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return 'unknown time';
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? value : parsed.toLocaleString();
}
