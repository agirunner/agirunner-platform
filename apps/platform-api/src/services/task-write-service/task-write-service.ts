import type { ApiKeyIdentity } from '../../auth/api-key.js';
import type { DatabaseClient, DatabasePool } from '../../db/database.js';
import type { CreateTaskInput } from '../task/task-service.types.js';
import { TaskWriteCreateService } from './task-write-service-create.js';
import { TaskWriteUpdateService } from './task-write-service-update.js';
import type { TaskWriteDependencies } from './task-write-service.types.js';

export class TaskWriteService {
  private readonly createService: TaskWriteCreateService;
  private readonly updateService: TaskWriteUpdateService;

  constructor(private readonly deps: TaskWriteDependencies) {
    this.createService = new TaskWriteCreateService(deps);
    this.updateService = new TaskWriteUpdateService(deps);
  }

  async createTask(
    identity: ApiKeyIdentity,
    input: CreateTaskInput,
    db: DatabaseClient | DatabasePool = this.deps.pool,
  ) {
    return this.createService.createTask(identity, input, db);
  }

  async updateTask(tenantId: string, taskId: string, payload: Record<string, unknown>) {
    return this.updateService.updateTask(tenantId, taskId, payload);
  }

  async updateTaskInput(
    tenantId: string,
    taskId: string,
    input: Record<string, unknown>,
    db: DatabaseClient | DatabasePool = this.deps.pool,
  ) {
    return this.updateService.updateTaskInput(tenantId, taskId, input, db);
  }
}
