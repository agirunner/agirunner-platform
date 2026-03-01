/**
 * Scenario Registry — exports all live test scenarios.
 *
 * Priority order per the test plan:
 * 1. AP-1/AP-2/AP-4 (SDLC variants)
 * 2. AP-5/AP-6 (Maintenance variants)
 * 3. AP-7 (Failure/recovery)
 * 4. OT-1 through OT-4 (Orchestrator)
 * 5. IT-1 (SDK), IT-2 (MCP), SI-1 (Tenant isolation)
 */

export { runAp1SdlcPipeline } from './ap1-sdlc-pipeline.js';
export { runAp2ExternalRuntime } from './ap2-external-runtime.js';
export { runAp4MixedWorkers } from './ap4-mixed-workers.js';
export { runAp5MaintenancePipeline, runAp5SingleBug } from './ap5-maintenance-pipeline.js';
export { runAp6RuntimeMaintenance } from './ap6-runtime-maintenance.js';
export { runAp7FailureRecovery } from './ap7-failure-recovery.js';
export { runOt1DependencyCascade } from './ot1-dependency-cascade.js';
export { runOt2TaskRouting } from './ot2-task-routing.js';
export { runOt3PipelineState } from './ot3-pipeline-state.js';
export { runOt4WorkerHealth } from './ot4-worker-health.js';
export { runIt1Sdk } from './it1-sdk.js';
export { runIt2Mcp } from './it2-mcp.js';
export { runSi1TenantIsolation } from './si1-tenant-isolation.js';

// Backward-compatible re-exports
export { runSdlcHappyScenario } from './sdlc-happy.js';
export { runSdlcSadScenario } from './sdlc-sad.js';
export { runMaintenanceHappyScenario } from './maintenance-happy.js';
export { runMaintenanceSadScenario } from './maintenance-sad.js';
