import type { DatabasePool } from '../db/database.js';

import { createApiKey, type ApiKeyIdentity } from '../auth/api-key.js';
import type { AppEnv } from '../config/schema.js';
import { NotFoundError } from '../errors/domain-errors.js';
import { EventService } from './event-service.js';

interface RegisterAgentInput {
  name: string;
  capabilities?: string[];
  worker_id?: string;
  heartbeat_interval_seconds?: number;
  metadata?: Record<string, unknown>;
  profile?: Record<string, unknown>;
}

type AgentServiceConfig = Pick<
  AppEnv,
  | 'AGENT_HEARTBEAT_GRACE_PERIOD_MS'
  | 'AGENT_DEFAULT_HEARTBEAT_INTERVAL_SECONDS'
  | 'AGENT_KEY_EXPIRY_MS'
  | 'AGENT_HEARTBEAT_TOLERANCE_MS'
>;

export class AgentService {
  constructor(
    private readonly pool: DatabasePool,
    private readonly eventService: EventService,
    private readonly config: AgentServiceConfig,
  ) {}

  async registerAgent(identity: ApiKeyIdentity, input: RegisterAgentInput) {
    const metadata = { ...(input.metadata ?? {}), ...(input.profile ? { profile: input.profile } : {}) };

    const result = await this.pool.query(
      `INSERT INTO agents (
        tenant_id, worker_id, name, capabilities, status, heartbeat_interval_seconds, last_heartbeat_at, metadata
      ) VALUES ($1,$2,$3,$4,'active',$5,now(),$6)
      RETURNING *`,
      [
        identity.tenantId,
        input.worker_id ?? null,
        input.name,
        input.capabilities ?? [],
        input.heartbeat_interval_seconds ?? this.config.AGENT_DEFAULT_HEARTBEAT_INTERVAL_SECONDS,
        metadata,
      ],
    );

    const agent = result.rows[0];
    const { apiKey } = await createApiKey(this.pool, {
      tenantId: identity.tenantId,
      scope: 'agent',
      ownerType: 'agent',
      ownerId: agent.id,
      label: `agent:${agent.name}`,
      expiresAt: new Date(Date.now() + this.config.AGENT_KEY_EXPIRY_MS),
    });

    await this.eventService.emit({
      tenantId: identity.tenantId,
      type: 'agent.registered',
      entityType: 'agent',
      entityId: agent.id,
      actorType: identity.scope,
      actorId: identity.keyPrefix,
      data: { name: agent.name },
    });

    return {
      id: agent.id,
      name: agent.name,
      capabilities: agent.capabilities,
      status: agent.status,
      api_key: apiKey,
      metadata: agent.metadata,
    };
  }

  async heartbeat(identity: ApiKeyIdentity, agentId: string) {
    const result = await this.pool.query(
      `UPDATE agents
       SET last_heartbeat_at = now(),
           status = CASE WHEN current_task_id IS NULL THEN 'active' ELSE 'busy' END
       WHERE tenant_id = $1 AND id = $2
       RETURNING *`,
      [identity.tenantId, agentId],
    );

    if (!result.rowCount) {
      throw new NotFoundError('Agent not found');
    }

    return { ack: true, status: result.rows[0].status };
  }

  async listAgents(tenantId: string) {
    const result = await this.pool.query(
      `SELECT id, worker_id, name, capabilities, status, current_task_id, heartbeat_interval_seconds,
              last_heartbeat_at, metadata, registered_at, created_at, updated_at
       FROM agents
       WHERE tenant_id = $1
       ORDER BY created_at DESC`,
      [tenantId],
    );
    return result.rows;
  }

  async enforceHeartbeatTimeouts(now = new Date()): Promise<number> {
    const staleAgents = await this.pool.query(
      `SELECT id, tenant_id, status, heartbeat_interval_seconds, last_heartbeat_at, current_task_id
       FROM agents
       WHERE status IN ('active', 'idle', 'busy', 'degraded', 'inactive')
         AND last_heartbeat_at IS NOT NULL
         AND last_heartbeat_at < ($1::timestamptz - (heartbeat_interval_seconds * $2::double precision * INTERVAL '1 millisecond'))`,
      [now, this.config.AGENT_HEARTBEAT_TOLERANCE_MS],
    );

    let affected = 0;
    for (const agent of staleAgents.rows) {
      const alreadyInactive = agent.status === 'inactive';

      if (!alreadyInactive) {
        await this.pool.query(
          "UPDATE agents SET status = 'inactive' WHERE tenant_id = $1 AND id = $2",
          [agent.tenant_id, agent.id],
        );

        await this.eventService.emit({
          tenantId: agent.tenant_id,
          type: 'agent.heartbeat_missed',
          entityType: 'agent',
          entityId: agent.id,
          actorType: 'system',
          actorId: 'heartbeat_monitor',
          data: {
            last_heartbeat_at: agent.last_heartbeat_at,
            heartbeat_interval_seconds: agent.heartbeat_interval_seconds,
          },
        });
      }

      if (agent.current_task_id) {
        const heartbeatCutoffMs = Number(agent.heartbeat_interval_seconds) * this.config.AGENT_HEARTBEAT_TOLERANCE_MS;
        const lastHeartbeatMs = new Date(agent.last_heartbeat_at as string | Date).getTime();
        const failAfterMs = lastHeartbeatMs + heartbeatCutoffMs + this.config.AGENT_HEARTBEAT_GRACE_PERIOD_MS;

        if (now.getTime() >= failAfterMs) {
          await this.pool.query(
            `UPDATE tasks
             SET state = 'failed',
                 state_changed_at = now(),
                 error = jsonb_build_object('category', 'infrastructure', 'message', 'Agent heartbeat timeout', 'recoverable', true),
                 assigned_agent_id = NULL,
                 assigned_worker_id = NULL,
                 claimed_at = NULL,
                 started_at = NULL
             WHERE tenant_id = $1 AND id = $2 AND state IN ('claimed', 'running')`,
            [agent.tenant_id, agent.current_task_id],
          );

          await this.pool.query(
            "UPDATE agents SET current_task_id = NULL WHERE tenant_id = $1 AND id = $2",
            [agent.tenant_id, agent.id],
          );

          await this.eventService.emit({
            tenantId: agent.tenant_id,
            type: 'task.state_changed',
            entityType: 'task',
            entityId: agent.current_task_id,
            actorType: 'system',
            actorId: 'heartbeat_monitor',
            data: {
              from_state: 'claimed',
              to_state: 'failed',
              reason: 'agent_heartbeat_timeout',
            },
          });
        }
      }

      affected += 1;
    }

    return affected;
  }
}
