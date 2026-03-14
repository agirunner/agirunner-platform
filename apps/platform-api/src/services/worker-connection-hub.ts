import type { WebSocket } from 'ws';

interface WorkerConnection {
  tenantId: string;
  socket: WebSocket;
}

interface PendingDispatch {
  tenantId: string;
  workerId: string;
  deadlineAt: number;
}

export class WorkerConnectionHub {
  private readonly workers = new Map<string, WorkerConnection>();
  private readonly pendingDispatches = new Map<string, PendingDispatch>();

  registerWorker(workerId: string, tenantId: string, socket: WebSocket): void {
    this.workers.set(workerId, { tenantId, socket });
  }

  unregisterWorker(workerId: string): void {
    this.workers.delete(workerId);
  }

  isWorkerConnected(workerId: string): boolean {
    return this.workers.has(workerId);
  }

  hasConnectedWorkers(): boolean {
    for (const connection of this.workers.values()) {
      if (isSocketOpen(connection.socket)) {
        return true;
      }
    }
    return false;
  }

  listConnectedWorkerIds(tenantId: string): string[] {
    const ids: string[] = [];
    for (const [workerId, connection] of this.workers.entries()) {
      if (connection.tenantId === tenantId && isSocketOpen(connection.socket)) {
        ids.push(workerId);
      }
    }
    return ids;
  }

  sendToWorker(workerId: string, payload: Record<string, unknown>): boolean {
    const connection = this.workers.get(workerId);
    if (!connection || !isSocketOpen(connection.socket)) {
      return false;
    }

    connection.socket.send(JSON.stringify(payload));
    return true;
  }

  markDispatchPending(taskId: string, tenantId: string, workerId: string, timeoutMs: number): void {
    this.pendingDispatches.set(taskId, {
      tenantId,
      workerId,
      deadlineAt: Date.now() + timeoutMs,
    });
  }

  acknowledgeDispatch(taskId: string): void {
    this.pendingDispatches.delete(taskId);
  }

  listExpiredDispatches(now = Date.now()): Array<{ taskId: string; tenantId: string; workerId: string }> {
    const expired: Array<{ taskId: string; tenantId: string; workerId: string }> = [];
    for (const [taskId, pending] of this.pendingDispatches.entries()) {
      if (pending.deadlineAt <= now) {
        expired.push({ taskId, tenantId: pending.tenantId, workerId: pending.workerId });
        this.pendingDispatches.delete(taskId);
      }
    }
    return expired;
  }
}

function isSocketOpen(socket: WebSocket): boolean {
  return socket.readyState === socket.OPEN;
}
