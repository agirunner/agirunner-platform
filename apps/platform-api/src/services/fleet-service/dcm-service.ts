import type { DatabasePool } from '../../db/database.js';

import {
  FleetRuntimeService,
} from './dcm-runtime-service.js';
import type { HeartbeatPayload } from './dcm-support.js';
import { FleetStatusService } from './dcm-status-service.js';

export type {
  ContainerManagerConfig,
  FleetEventFilters,
  FleetEventRow,
  HeartbeatPayload,
  PlaybookFleetSummary,
  PlaybookPoolFleetSummary,
  QueueDepthResult,
  RecordFleetEventInput,
  RuntimeTarget,
  FleetStatus,
  WorkerPoolSummary,
} from './dcm-support.js';

export class FleetDcmService {
  private readonly runtimeService: FleetRuntimeService;
  private readonly statusService: FleetStatusService;

  constructor(pool: DatabasePool) {
    this.runtimeService = new FleetRuntimeService(pool);
    this.statusService = new FleetStatusService(pool, this.runtimeService);
  }

  getQueueDepth(tenantId: string, playbookId?: string): ReturnType<FleetRuntimeService['getQueueDepth']> {
    return this.runtimeService.getQueueDepth(tenantId, playbookId);
  }

  getRuntimeTargets(tenantId: string): ReturnType<FleetRuntimeService['getRuntimeTargets']> {
    return this.runtimeService.getRuntimeTargets(tenantId);
  }

  recordHeartbeat(tenantId: string, payload: HeartbeatPayload): ReturnType<FleetRuntimeService['recordHeartbeat']> {
    return this.runtimeService.recordHeartbeat(tenantId, payload);
  }

  listHeartbeats(tenantId: string): ReturnType<FleetRuntimeService['listHeartbeats']> {
    return this.runtimeService.listHeartbeats(tenantId);
  }

  getContainerManagerConfig(tenantId: string): ReturnType<FleetRuntimeService['getContainerManagerConfig']> {
    return this.runtimeService.getContainerManagerConfig(tenantId);
  }

  getFleetStatus(tenantId: string): ReturnType<FleetStatusService['getFleetStatus']> {
    return this.statusService.getFleetStatus(tenantId);
  }

  listFleetEvents(
    tenantId: string,
    filters: Parameters<FleetStatusService['listFleetEvents']>[1],
  ): ReturnType<FleetStatusService['listFleetEvents']> {
    return this.statusService.listFleetEvents(tenantId, filters);
  }

  drainRuntime(tenantId: string, runtimeId: string): ReturnType<FleetStatusService['drainRuntime']> {
    return this.statusService.drainRuntime(tenantId, runtimeId);
  }

  removeHeartbeat(tenantId: string, runtimeId: string): ReturnType<FleetStatusService['removeHeartbeat']> {
    return this.statusService.removeHeartbeat(tenantId, runtimeId);
  }

  recordFleetEvent(tenantId: string, event: Parameters<FleetStatusService['recordFleetEvent']>[1]): ReturnType<FleetStatusService['recordFleetEvent']> {
    return this.statusService.recordFleetEvent(tenantId, event);
  }
}
