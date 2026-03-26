import { Loader2 } from 'lucide-react';

import { DashboardPageHeader } from '../../components/layout/dashboard-page-header.js';
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
      <DashboardPageHeader
        navHref="/platform/orchestrator"
        description="Configure the workflow orchestrator — prompt baseline, model routing, and agent pool posture."
      />

      <OrchestratorControlPlane {...orchestratorState.controlPlaneProps} />
    </div>
  );
}
