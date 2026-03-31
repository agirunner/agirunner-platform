import { useState } from 'react';
import { Bot, Cpu, FilePenLine } from 'lucide-react';

import type {
  FleetWorkerRecord,
} from '../../../lib/api.js';
import { Badge } from '../../../components/ui/badge.js';
import { Button } from '../../../components/ui/button.js';
import { DashboardSectionCard } from '../../../components/layout/dashboard-section-card.js';
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
    cpuLimit: string;
    memoryLimit: string;
    replicas: number;
    enabled: boolean;
  }) => Promise<unknown>;
}): JSX.Element {
  const [isPromptOpen, setIsPromptOpen] = useState(false);
  const [isModelOpen, setIsModelOpen] = useState(false);
  const [isPoolOpen, setIsPoolOpen] = useState(false);

  return (
    <>
      <DashboardSectionCard
        title="Orchestrator"
        description="Configure the orchestrator prompt, model, and agent pool."
        bodyClassName="space-y-4"
      >
          {props.hasError ? (
            <InlineWarning>
              Some orchestrator posture data could not be refreshed. Quick-edit actions still use
              the live configuration routes and will refresh the page state after save.
            </InlineWarning>
          ) : null}
          <ReadinessBanner readiness={props.readiness} />
          <div className="grid gap-4 xl:grid-cols-3">
            <EditableControlPacket
              icon={FilePenLine}
              title="Prompt"
              status={props.promptSummary.statusLabel}
              value={props.promptSummary.versionLabel}
              detail={props.promptSummary.excerpt}
              detailClassName="line-clamp-3"
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
              primaryLabel="Edit model"
              isLoading={props.isLoading}
              onEdit={() => setIsModelOpen(true)}
            />
            <EditableControlPacket
              icon={Cpu}
              title="Pool posture"
              status={`${props.poolSummary.enabledWorkers} enabled agents`}
              value={`${props.poolSummary.runningContainers} running / ${props.poolSummary.desiredReplicas} desired replicas`}
              detail="Configure the runtime environment for the orchestrator and how many replicas should be available."
              facts={[
                {
                  label: 'Agent image',
                  value: props.poolSummary.runtimeLabel,
                  mono: true,
                },
                {
                  label: 'CPU / memory',
                  value: props.poolSummary.resourceLabel,
                },
              ]}
              primaryLabel="Edit pool"
              isLoading={props.isLoading}
              onEdit={() => setIsPoolOpen(true)}
            />
          </div>
      </DashboardSectionCard>

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
        isOpen={isPoolOpen}
        isSaving={props.isPoolSaving}
        onOpenChange={setIsPoolOpen}
        onSave={props.onSavePool}
      />
    </>
  );
}
