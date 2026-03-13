import { useState } from 'react';
import { Bot, Cpu, ExternalLink, FilePenLine } from 'lucide-react';
import { Link } from 'react-router-dom';

import type {
  DashboardPlatformInstructionRecord,
  FleetWorkerRecord,
} from '../../lib/api.js';
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
  OrchestratorModelDialog,
  OrchestratorPromptDialog,
} from './role-definitions-orchestrator.dialogs.js';
import { OrchestratorPoolDialog } from './role-definitions-orchestrator.pool-dialog.js';
import {
  AdvancedSurfaceCard,
  EditableControlPacket,
  InlineWarning,
  ReadinessBanner,
} from './role-definitions-orchestrator.sections.js';
import type {
  OrchestratorControlReadiness,
  OrchestratorControlSurface,
  OrchestratorModelSummary,
  OrchestratorPoolSummary,
  OrchestratorPromptSummary,
  RoleAssignmentRecord,
  SystemDefaultRecord,
} from './role-definitions-orchestrator.support.js';
import type { LlmModelRecord } from './role-definitions-page.support.js';

export function OrchestratorControlPlane(props: {
  promptSummary: OrchestratorPromptSummary;
  modelSummary: OrchestratorModelSummary;
  poolSummary: OrchestratorPoolSummary;
  readiness: OrchestratorControlReadiness;
  controlSurfaces: OrchestratorControlSurface[];
  instructions: DashboardPlatformInstructionRecord | undefined;
  assignments: RoleAssignmentRecord[] | undefined;
  systemDefault: SystemDefaultRecord | undefined;
  models: LlmModelRecord[];
  workers: FleetWorkerRecord[];
  isLoading: boolean;
  hasError: boolean;
  isPromptSaving: boolean;
  isModelSaving: boolean;
  isPoolSaving: boolean;
  onSavePrompt: (content: string) => Promise<unknown>;
  onSaveModel: (input: {
    modelId: string;
    reasoningConfig: Record<string, unknown> | null;
  }) => Promise<unknown>;
  onSavePool: (input: {
    workerId: string | null;
    workerName: string;
    runtimeImage: string;
    replicas: number;
    enabled: boolean;
    modelId: string;
  }) => Promise<unknown>;
}): JSX.Element {
  const [isPromptOpen, setIsPromptOpen] = useState(false);
  const [isModelOpen, setIsModelOpen] = useState(false);
  const [isPoolOpen, setIsPoolOpen] = useState(false);

  return (
    <>
      <Card className="border-border/70 shadow-sm">
        <CardHeader className="space-y-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle>Orchestrator control plane</CardTitle>
                <Badge variant="secondary">First-class system actor</Badge>
              </div>
              <CardDescription className="max-w-3xl leading-6">
                Keep the workflow orchestrator fully manageable from this page: prompt baseline,
                model override, and worker-pool posture all stay directly editable here. Use the
                advanced links only when you need deeper history or topology controls.
              </CardDescription>
            </div>
            <Button asChild variant="outline">
              <Link to="/config/instructions">
                <ExternalLink className="h-4 w-4" />
                Advanced instruction history
              </Link>
            </Button>
          </div>
          {props.hasError ? (
            <InlineWarning>
              Some orchestrator posture data could not be refreshed. Quick-edit actions still use
              the live configuration routes and will refresh the page state after save.
            </InlineWarning>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-4">
          <ReadinessBanner readiness={props.readiness} />
          <div className="grid gap-4 xl:grid-cols-3">
            <EditableControlPacket
              icon={FilePenLine}
              title="Prompt baseline"
              status={props.promptSummary.statusLabel}
              value={props.promptSummary.versionLabel}
              detail={props.promptSummary.excerpt}
              primaryLabel="Edit prompt here"
              secondaryHref="/config/instructions"
              secondaryLabel="Open history"
              isLoading={props.isLoading}
              onEdit={() => setIsPromptOpen(true)}
            />
            <EditableControlPacket
              icon={Bot}
              title="Model routing"
              status={props.modelSummary.sourceLabel}
              value={props.modelSummary.modelLabel}
              detail={props.modelSummary.reasoningLabel}
              primaryLabel="Edit model here"
              secondaryHref="/config/llm"
              secondaryLabel="Open full routing"
              isLoading={props.isLoading}
              onEdit={() => setIsModelOpen(true)}
            />
            <EditableControlPacket
              icon={Cpu}
              title="Pool posture"
              status={`${props.poolSummary.enabledWorkers} enabled workers`}
              value={`${props.poolSummary.runningContainers} running / ${props.poolSummary.desiredReplicas} desired replicas`}
              detail={`Runtime: ${props.poolSummary.runtimeLabel} · Model pin: ${props.poolSummary.modelLabel}`}
              primaryLabel="Edit pool here"
              secondaryHref="/fleet/workers"
              secondaryLabel="Open full fleet"
              isLoading={props.isLoading}
              onEdit={() => setIsPoolOpen(true)}
            />
          </div>
          <div className="space-y-3">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-foreground">Advanced surfaces</p>
              <p className="max-w-3xl text-sm text-muted">
                The primary path is direct editing above. These surfaces stay available for
                revision history, full role/model routing, and advanced worker topology.
              </p>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              {props.controlSurfaces.map((surface) => (
                <AdvancedSurfaceCard key={surface.id} surface={surface} />
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <OrchestratorPromptDialog
        instructions={props.instructions}
        isOpen={isPromptOpen}
        isSaving={props.isPromptSaving}
        onOpenChange={setIsPromptOpen}
        onSave={props.onSavePrompt}
      />
      <OrchestratorModelDialog
        assignments={props.assignments}
        systemDefault={props.systemDefault}
        models={props.models}
        isOpen={isModelOpen}
        isSaving={props.isModelSaving}
        onOpenChange={setIsModelOpen}
        onSave={(input) =>
          props.onSaveModel({
            modelId: input.modelId,
            reasoningConfig: input.reasoningConfig,
          })
        }
      />
      <OrchestratorPoolDialog
        workers={props.workers}
        models={props.models}
        isOpen={isPoolOpen}
        isSaving={props.isPoolSaving}
        onOpenChange={setIsPoolOpen}
        onSave={props.onSavePool}
      />
    </>
  );
}
