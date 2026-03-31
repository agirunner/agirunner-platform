import type { DatabasePool } from '../db/database.js';

import {
  FleetWorkerService,
} from './fleet-service/worker-service.js';
import type {
  CreateDesiredStateInput,
  UpdateDesiredStateInput,
} from './fleet-service/worker-support.js';
import {
  FleetDcmService,
  type ContainerManagerConfig,
  type FleetEventFilters,
  type FleetEventRow,
  type HeartbeatPayload,
  type RecordFleetEventInput,
  type FleetStatus,
} from './fleet-service/dcm-service.js';

export type { CreateDesiredStateInput, UpdateDesiredStateInput } from './fleet-service/worker-support.js';
export type {
  ContainerManagerConfig,
  FleetEventFilters,
  FleetEventRow,
  HeartbeatPayload,
  RecordFleetEventInput,
  FleetStatus,
} from './fleet-service/dcm-service.js';

type ReconcileSnapshot = {
  desired_states: Awaited<ReturnType<FleetWorkerService['listWorkers']>>;
  runtime_targets: Awaited<ReturnType<FleetDcmService['getRuntimeTargets']>>;
  heartbeats: Awaited<ReturnType<FleetDcmService['listHeartbeats']>>;
  container_manager_config: Awaited<ReturnType<FleetDcmService['getContainerManagerConfig']>>;
};

export class FleetService {
  private readonly workerService: FleetWorkerService;
  private readonly dcmService: FleetDcmService;

  constructor(private readonly pool: DatabasePool) {
    this.workerService = new FleetWorkerService(pool);
    this.dcmService = new FleetDcmService(pool);
  }

  listWorkers(tenantId: string, options: { enabledOnly?: boolean } = {}) {
    return this.workerService.listWorkers(tenantId, options);
  }

  getWorker(tenantId: string, id: string) {
    return this.workerService.getWorker(tenantId, id);
  }

  createWorker(tenantId: string, input: CreateDesiredStateInput) {
    return this.workerService.createWorker(tenantId, input);
  }

  updateWorker(tenantId: string, id: string, input: UpdateDesiredStateInput) {
    return this.workerService.updateWorker(tenantId, id, input);
  }

  deleteWorker(tenantId: string, id: string) {
    return this.workerService.deleteWorker(tenantId, id);
  }

  restartWorker(tenantId: string, id: string) {
    return this.workerService.restartWorker(tenantId, id);
  }

  acknowledgeWorkerRestart(tenantId: string, id: string) {
    return this.workerService.acknowledgeWorkerRestart(tenantId, id);
  }

  drainWorker(tenantId: string, id: string) {
    return this.workerService.drainWorker(tenantId, id);
  }

  drainAllRuntimesForTenant(tenantId: string) {
    return this.workerService.drainAllRuntimesForTenant(tenantId);
  }

  listContainers(tenantId: string) {
    return this.workerService.listContainers(tenantId);
  }

  getContainerStats(id: string) {
    return this.workerService.getContainerStats(id);
  }

  listImages() {
    return this.workerService.listImages();
  }

  reportActualState(
    desiredStateId: string,
    containerId: string,
    status: string,
    stats: { cpuPercent?: number; memoryBytes?: number; rxBytes?: number; txBytes?: number },
  ) {
    return this.workerService.reportActualState(desiredStateId, containerId, status, stats);
  }

  pruneStaleActualState(desiredStateId: string, activeContainerIds: string[]) {
    return this.workerService.pruneStaleActualState(desiredStateId, activeContainerIds);
  }

  pruneStaleHeartbeats() {
    return this.workerService.pruneStaleHeartbeats();
  }

  pruneStaleContainers(tenantId: string) {
    return this.workerService.pruneStaleContainers(tenantId);
  }

  requestImagePull(repository: string, tag: string) {
    return this.workerService.requestImagePull(repository, tag);
  }

  reportImage(repository: string, tag: string | null, digest: string | null, sizeBytes: number | null) {
    return this.workerService.reportImage(repository, tag, digest, sizeBytes);
  }

  getQueueDepth(tenantId: string, playbookId?: string) {
    return this.dcmService.getQueueDepth(tenantId, playbookId);
  }

  getRuntimeTargets(tenantId: string) {
    return this.dcmService.getRuntimeTargets(tenantId);
  }

  async getReconcileSnapshot(tenantId: string): Promise<ReconcileSnapshot> {
    const [desiredStates, runtimeTargets, heartbeats, containerManagerConfig] = await Promise.all([
      this.workerService.listWorkers(tenantId, { enabledOnly: true }),
      this.dcmService.getRuntimeTargets(tenantId),
      this.dcmService.listHeartbeats(tenantId),
      this.dcmService.getContainerManagerConfig(tenantId),
    ]);

    return {
      desired_states: desiredStates,
      runtime_targets: runtimeTargets,
      heartbeats,
      container_manager_config: containerManagerConfig,
    };
  }

  recordHeartbeat(tenantId: string, payload: HeartbeatPayload) {
    return this.dcmService.recordHeartbeat(tenantId, payload);
  }

  listHeartbeats(tenantId: string) {
    return this.dcmService.listHeartbeats(tenantId);
  }

  getFleetStatus(tenantId: string) {
    return this.dcmService.getFleetStatus(tenantId);
  }

  listFleetEvents(tenantId: string, filters: FleetEventFilters) {
    return this.dcmService.listFleetEvents(tenantId, filters);
  }

  drainRuntime(tenantId: string, runtimeId: string) {
    return this.dcmService.drainRuntime(tenantId, runtimeId);
  }

  removeHeartbeat(tenantId: string, runtimeId: string) {
    return this.dcmService.removeHeartbeat(tenantId, runtimeId);
  }

  recordFleetEvent(tenantId: string, event: RecordFleetEventInput) {
    return this.dcmService.recordFleetEvent(tenantId, event);
  }
}
