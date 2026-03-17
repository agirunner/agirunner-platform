import type { DatabasePool } from '../db/database.js';

import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { AppEnv } from '../config/schema.js';
import { EventService } from './event-service.js';
import { readWorkerSupervisionTimingDefaults } from './platform-timing-defaults.js';
import { WorkerConnectionHub } from './worker-connection-hub.js';
import {
  acknowledgeTask,
  dispatchReadyTasks,
  releaseExpiredDispatches,
  selectLeastLoadedWorker,
} from './worker-dispatch-service.js';
import { enforceHeartbeatTimeouts, heartbeat } from './worker-heartbeat-service.js';
import { deleteWorker, getWorker, listWorkers, registerWorker } from './worker-registration-service.js';
import { acknowledgeSignal, sendSignal } from './worker-signal-service.js';
import { createWebhookSignature, generateWebhookSecret, verifyWebhookSignature } from './webhook-delivery.js';

export interface WorkerAgentInput {
  name: string;
  capabilities?: string[];
  execution_mode?: 'specialist' | 'orchestrator' | 'hybrid';
  metadata?: Record<string, unknown>;
}

export interface RegisterWorkerInput {
  name: string;
  runtime_type?: string;
  connection_mode?: 'websocket' | 'sse' | 'polling';
  capabilities?: string[];
  host_info?: Record<string, unknown>;
  heartbeat_interval_seconds?: number;
  agents?: WorkerAgentInput[];
  metadata?: Record<string, unknown>;
}

export interface WorkerHeartbeatInput {
  status?: 'online' | 'busy' | 'draining' | 'disconnected' | 'offline';
  current_task_id?: string | null;
  current_tasks?: string[];
  metrics?: Record<string, unknown>;
}

export interface WorkerSignalInput {
  type: 'cancel' | 'drain' | 'config_update';
  task_id?: string;
  data?: Record<string, unknown>;
}

export interface WorkerServiceContext {
  pool: DatabasePool;
  eventService: EventService;
  connectionHub: WorkerConnectionHub;
  config: AppEnv;
}

export class WorkerService {
  private readonly context: WorkerServiceContext;

  constructor(pool: DatabasePool, eventService: EventService, connectionHub: WorkerConnectionHub, config: AppEnv) {
    this.context = { pool, eventService, connectionHub, config };
  }

  async registerWorker(identity: ApiKeyIdentity, input: RegisterWorkerInput) {
    return registerWorker(await this.buildWorkerTimingContext(), identity, input);
  }

  listWorkers(tenantId: string) {
    return listWorkers(this.context, tenantId);
  }

  getWorker(tenantId: string, workerId: string) {
    return getWorker(this.context, tenantId, workerId);
  }

  deleteWorker(identity: ApiKeyIdentity, workerId: string) {
    return deleteWorker(this.context, identity, workerId);
  }

  heartbeat(identity: ApiKeyIdentity, workerId: string, payload: WorkerHeartbeatInput) {
    return heartbeat(this.context, identity, workerId, payload);
  }

  sendSignal(identity: ApiKeyIdentity, workerId: string, input: WorkerSignalInput) {
    return sendSignal(this.context, identity, workerId, input);
  }

  acknowledgeSignal(identity: ApiKeyIdentity, workerId: string, signalId: string): Promise<void> {
    return acknowledgeSignal(this.context, identity, workerId, signalId);
  }

  async dispatchReadyTasks(limit?: number): Promise<number> {
    return dispatchReadyTasks(await this.buildWorkerTimingContext(), limit);
  }

  acknowledgeTask(workerIdentity: ApiKeyIdentity, taskId: string, agentId?: string): Promise<void> {
    return acknowledgeTask(this.context, workerIdentity, taskId, agentId);
  }

  releaseExpiredDispatches(): Promise<number> {
    return releaseExpiredDispatches(this.context);
  }

  async enforceHeartbeatTimeouts(now = new Date()): Promise<number> {
    return enforceHeartbeatTimeouts(await this.buildWorkerTimingContext(), now);
  }

  private async buildWorkerTimingContext(): Promise<WorkerServiceContext> {
    const timingDefaults = await readWorkerSupervisionTimingDefaults(
      this.context.pool,
      {
        dispatchAckTimeoutMs: this.context.config.WORKER_DISPATCH_ACK_TIMEOUT_MS,
        defaultHeartbeatIntervalSeconds: this.context.config.WORKER_DEFAULT_HEARTBEAT_INTERVAL_SECONDS,
        offlineGracePeriodMs: this.context.config.WORKER_OFFLINE_GRACE_PERIOD_MS,
        offlineThresholdMultiplier: this.context.config.WORKER_OFFLINE_THRESHOLD_MULTIPLIER,
        degradedThresholdMultiplier: this.context.config.WORKER_DEGRADED_THRESHOLD_MULTIPLIER,
      },
    );

    return {
      ...this.context,
      config: {
        ...this.context.config,
        WORKER_DISPATCH_ACK_TIMEOUT_MS: timingDefaults.dispatchAckTimeoutMs,
        WORKER_DEFAULT_HEARTBEAT_INTERVAL_SECONDS: timingDefaults.defaultHeartbeatIntervalSeconds,
        WORKER_OFFLINE_GRACE_PERIOD_MS: timingDefaults.offlineGracePeriodMs,
        WORKER_OFFLINE_THRESHOLD_MULTIPLIER: timingDefaults.offlineThresholdMultiplier,
        WORKER_DEGRADED_THRESHOLD_MULTIPLIER: timingDefaults.degradedThresholdMultiplier,
      },
    };
  }
}

export { createWebhookSignature, generateWebhookSecret, selectLeastLoadedWorker, verifyWebhookSignature };
