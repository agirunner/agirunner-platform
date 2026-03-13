import type { ComponentType } from 'react';
import { AlertTriangle, Bot, Cpu, ExternalLink, FilePenLine } from 'lucide-react';
import { Link } from 'react-router-dom';

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
  OrchestratorControlReadiness,
  OrchestratorModelSummary,
  OrchestratorPoolSummary,
  OrchestratorPromptSummary,
} from './role-definitions-orchestrator.support.js';

export function OrchestratorControlPlane(props: {
  promptSummary: OrchestratorPromptSummary;
  modelSummary: OrchestratorModelSummary;
  poolSummary: OrchestratorPoolSummary;
  readiness: OrchestratorControlReadiness;
  isLoading: boolean;
  hasError: boolean;
}): JSX.Element {
  return (
    <Card className="border-border/70 shadow-sm">
      <CardHeader className="space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>Orchestrator control plane</CardTitle>
              <Badge variant="secondary">First-class system actor</Badge>
            </div>
            <CardDescription className="max-w-3xl leading-6">
              Configure the workflow orchestrator from one place: prompt baseline, live model
              routing, and orchestrator worker pool posture. Specialist roles are managed below;
              the orchestrator itself is not a normal role definition.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link to="/config/instructions">
                <FilePenLine className="h-4 w-4" />
                Edit prompt
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/config/llm">
                <Bot className="h-4 w-4" />
                Manage model routing
              </Link>
            </Button>
            <Button asChild>
              <Link to="/fleet/workers">
                <Cpu className="h-4 w-4" />
                Manage orchestrator pool
              </Link>
            </Button>
          </div>
        </div>
        {props.hasError ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              Some orchestrator posture data could not be refreshed. The edit links still open the
              live configuration pages.
            </p>
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          className={
            props.readiness.isReady
              ? 'rounded-xl bg-emerald-500/10 p-4'
              : 'rounded-xl bg-amber-500/10 p-4'
          }
        >
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-foreground">{props.readiness.headline}</p>
                <Badge variant={props.readiness.isReady ? 'success' : 'warning'}>
                  {props.readiness.isReady ? 'Ready' : `${props.readiness.issues.length} blockers`}
                </Badge>
              </div>
              <p className="max-w-3xl text-sm leading-6 text-muted">{props.readiness.detail}</p>
            </div>
            {!props.readiness.isReady ? (
              <div className="flex flex-wrap gap-2">
                {props.readiness.issues.some((issue) => issue.id === 'prompt') ? (
                  <Button asChild variant="outline" size="sm">
                    <Link to="/config/instructions">
                      <FilePenLine className="h-4 w-4" />
                      Fix prompt baseline
                    </Link>
                  </Button>
                ) : null}
                {props.readiness.issues.some((issue) => issue.id === 'model') ? (
                  <Button asChild variant="outline" size="sm">
                    <Link to="/config/llm">
                      <Bot className="h-4 w-4" />
                      Fix model routing
                    </Link>
                  </Button>
                ) : null}
                {props.readiness.issues.some((issue) => issue.id === 'pool') ? (
                  <Button asChild variant="outline" size="sm">
                    <Link to="/fleet/workers">
                      <Cpu className="h-4 w-4" />
                      Fix worker pool
                    </Link>
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
          {props.readiness.issues.length > 0 ? (
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {props.readiness.issues.map((issue) => (
                <div key={issue.id} className="rounded-lg bg-background/80 p-3">
                  <p className="text-sm font-medium text-foreground">{issue.title}</p>
                  <p className="mt-1 text-sm leading-6 text-muted">{issue.detail}</p>
                </div>
              ))}
            </div>
          ) : null}
        </div>
        <div className="grid gap-4 xl:grid-cols-3">
        <ControlPacket
          icon={FilePenLine}
          title="Prompt baseline"
          status={props.promptSummary.statusLabel}
          value={props.promptSummary.versionLabel}
          detail={props.promptSummary.excerpt}
          footerLabel="Open platform instructions"
          href="/config/instructions"
          isLoading={props.isLoading}
        />
        <ControlPacket
          icon={Bot}
          title="Model routing"
          status={props.modelSummary.sourceLabel}
          value={props.modelSummary.modelLabel}
          detail={props.modelSummary.reasoningLabel}
          footerLabel="Open LLM assignments"
          href="/config/llm"
          isLoading={props.isLoading}
        />
        <ControlPacket
          icon={Cpu}
          title="Pool posture"
          status={`${props.poolSummary.enabledWorkers} enabled workers`}
          value={`${props.poolSummary.runningContainers} containers / ${props.poolSummary.desiredReplicas} desired replicas`}
          detail={`Runtime: ${props.poolSummary.runtimeLabel} · Model: ${props.poolSummary.modelLabel}`}
          footerLabel="Open worker desired state"
          href="/fleet/workers"
          secondaryLabel="Runtime defaults"
          secondaryHref="/config/runtimes"
          isLoading={props.isLoading}
        />
        </div>
      </CardContent>
    </Card>
  );
}

function ControlPacket(props: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  status: string;
  value: string;
  detail: string;
  href: string;
  footerLabel: string;
  secondaryLabel?: string;
  secondaryHref?: string;
  isLoading: boolean;
}): JSX.Element {
  return (
    <div className="grid gap-3 rounded-xl border border-border/70 bg-muted/10 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">{props.title}</p>
          <p className="text-xs text-muted">{props.status}</p>
        </div>
        <props.icon className="h-4 w-4 text-muted" />
      </div>
      {props.isLoading ? (
        <div className="space-y-2">
          <div className="h-6 w-2/3 rounded bg-border/70" />
          <div className="h-4 w-full rounded bg-border/50" />
        </div>
      ) : (
        <>
          <p className="text-lg font-semibold leading-6 text-foreground">{props.value}</p>
          <p className="text-sm leading-6 text-muted">{props.detail}</p>
        </>
      )}
      <div className="flex flex-wrap gap-2 pt-1">
        <Button asChild variant="ghost" size="sm">
          <Link to={props.href}>
            <ExternalLink className="h-4 w-4" />
            {props.footerLabel}
          </Link>
        </Button>
        {props.secondaryHref && props.secondaryLabel ? (
          <Button asChild variant="ghost" size="sm">
            <Link to={props.secondaryHref}>
              <ExternalLink className="h-4 w-4" />
              {props.secondaryLabel}
            </Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
