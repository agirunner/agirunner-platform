import { useState } from 'react';
import { Bot, Cpu, FilePenLine } from 'lucide-react';

import type {
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
  EditableControlPacket,
  InlineWarning,
  ReadinessBanner,
} from './role-definitions-orchestrator.sections.js';
import type {
  OrchestratorControlReadiness,
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
  orchestratorConfig: { prompt: string; updatedAt: string } | undefined;
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
              <CardTitle>Orchestrator</CardTitle>
              <CardDescription>
                Configure the orchestrator prompt, model, and worker pool.
              </CardDescription>
            </div>
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
              title="Prompt"
              status={props.promptSummary.statusLabel}
              value={props.promptSummary.versionLabel}
              detail={props.promptSummary.excerpt}
              primaryLabel="Edit prompt"
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
              isLoading={props.isLoading}
              onEdit={() => setIsPoolOpen(true)}
            />
          </div>
        </CardContent>
      </Card>

      <OrchestratorPromptDialog
        orchestratorConfig={props.orchestratorConfig}
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
