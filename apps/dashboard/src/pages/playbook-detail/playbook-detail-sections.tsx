import { ArrowRight, Bot, Cpu, History } from 'lucide-react';
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
              This playbook owns loop policy, concurrency, and workflow stages. Shared prompts,
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
            title="Loop and concurrency policy"
            value={summary.parallelism}
            href="#playbook-orchestrator-controls"
          />
          <SignalCard
            title="Parallelism policy"
            value={summary.parallelism}
            href="#playbook-orchestrator-controls"
          />
          <SignalCard
            title="Checkpoints and rules"
            value={summary.checkpoints}
            href="#playbook-checkpoints"
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
            title="Container defaults"
            description="Global specialist runtime and execution-container defaults live outside the playbook."
            value="Inspect specialist container defaults"
            href="/config/runtimes"
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
}

export function PlaybookRevisionHistoryCard(
  props: PlaybookRevisionHistoryCardProps,
): JSX.Element {
  const comparedPlaybook =
    props.revisions.find((revision) => revision.id === props.comparedRevisionId) ?? null;

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
              Compare every saved playbook setting against an earlier revision.
            </CardDescription>
          </div>
          <Badge variant="outline">Current v{props.currentPlaybook.version}</Badge>
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
              <SelectTrigger className="w-full">
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

          <div className="max-h-[26rem] space-y-2 overflow-y-auto pr-1">
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
            <TabsList className="grid h-auto w-full gap-2 rounded-xl bg-border/20 p-2 sm:grid-cols-2">
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
