import { Bot, Loader2 } from 'lucide-react';

import {
  OrchestratorControlPlane,
} from '../role-definitions/role-definitions-orchestrator.js';
import { useRolePageOrchestratorState } from '../role-definitions/role-definitions-page.orchestrator.js';

export function OrchestratorPage(): JSX.Element {
  const orchestratorState = useRolePageOrchestratorState();

  if (orchestratorState.controlPlaneProps.isLoading) {
    return <div className="flex items-center justify-center p-12"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>;
  }

  return (
    <div className="space-y-6 p-6">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-accent" />
          <h1 className="text-2xl font-semibold">Orchestrator</h1>
        </div>
        <p className="max-w-3xl text-sm text-muted">
          Configure the workflow orchestrator — prompt baseline, model routing, and worker pool posture.
        </p>
      </div>

      <OrchestratorControlPlane {...orchestratorState.controlPlaneProps} />
    </div>
  );
}
