import type { DatabasePool } from '../db/database.js';

import { createApiKey, type ApiKeyIdentity } from '../auth/api-key.js';
import { NotFoundError } from '../errors/domain-errors.js';
import { EventService } from './event/event-service.js';
import { readAgentSupervisionTimingDefaults } from './platform-config/platform-timing-defaults.js';
import {
  sanitizeSecretLikeRecord,
  sanitizeSecretLikeValue,
} from './secret-redaction.js';

const AGENT_SECRET_REDACTION = 'redacted://agent-secret';
const AGENT_REDACTION_OPTIONS = { redactionValue: AGENT_SECRET_REDACTION, allowSecretReferences: false };

interface RegisterAgentInput {
  name: string;
  protocol?: 'rest' | 'acp';
  routing_tags?: string[];
  execution_mode?: 'specialist' | 'orchestrator' | 'hybrid';
  playbook_id?: string;
  issue_api_key?: boolean;
  tools?: { required?: string[]; optional?: string[] };
  worker_id?: string;
  heartbeat_interval_seconds?: number;
  metadata?: Record<string, unknown>;
  acp?: {
    transports?: Array<'stdio' | 'http' | 'websocket'>;
    session_modes?: Array<'run' | 'session'>;
    capabilities?: Record<string, unknown>;
  };
  profile?: Record<string, unknown>;
}

export class AgentService {
  constructor(
    private readonly pool: DatabasePool,
    private readonly eventService: EventService,
  ) {}

  async registerAgent(identity: ApiKeyIdentity, input: RegisterAgentInput) {
    const timingDefaults = await readAgentSupervisionTimingDefaults(this.pool);
    const executionMode = input.execution_mode ?? 'specialist';
    const routingTags = normalizeAgentRoutingTags(input.routing_tags ?? [], executionMode);
    const metadata = {
      ...(input.metadata ?? {}),
      protocol: input.protocol ?? 'rest',
      execution_mode: executionMode,
      ...(input.playbook_id ? { playbook_id: input.playbook_id } : {}),
      ...(input.acp ? { acp: input.acp } : {}),
      ...(input.profile ? { profile: input.profile } : {}),
      ...(input.tools ? { tools: input.tools } : {}),
    };

    const result = await this.pool.query(
      `INSERT INTO agents (
        tenant_id, worker_id, name, routing_tags, status, heartbeat_interval_seconds, last_heartbeat_at, metadata
      ) VALUES ($1,$2,$3,$4,'active',$5,now(),$6)
      RETURNING *`,
      [
        identity.tenantId,
        input.worker_id ?? null,
        input.name,
        routingTags,
        input.heartbeat_interval_seconds ?? timingDefaults.defaultHeartbeatIntervalSeconds,
        metadata,
      ],
    );

    const agent = result.rows[0];
    const apiKey = input.issue_api_key === false
      ? undefined
      : (await createApiKey(this.pool, {
        tenantId: identity.tenantId,
        scope: 'agent',
        ownerType: 'agent',
        ownerId: agent.id,
        label: `agent:${agent.name}`,
        expiresAt: new Date(Date.now() + timingDefaults.keyExpiryMs),
      })).apiKey;

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
      routing_tags: agent.routing_tags,
      status: agent.status,
      api_key: apiKey,
      metadata: sanitizeSecretLikeRecord(agent.metadata, AGENT_REDACTION_OPTIONS),
      tools: sanitizeSecretLikeValue(
        (agent.metadata as Record<string, unknown>)?.tools ?? { required: [], optional: [] },
        AGENT_REDACTION_OPTIONS,
      ),
    };
  }

  async heartbeat(identity: ApiKeyIdentity, agentId: string) {
    const result = await this.pool.query(
      `UPDATE agents
       SET last_heartbeat_at = now(),
           status = (CASE WHEN current_task_id IS NULL THEN 'active'::agent_status ELSE 'busy'::agent_status END)
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
      `SELECT id, worker_id, name, status, current_task_id, heartbeat_interval_seconds,
              last_heartbeat_at, metadata, registered_at, created_at, updated_at
       FROM agents
      WHERE tenant_id = $1
       ORDER BY created_at DESC`,
      [tenantId],
    );
    return result.rows.map((row) => sanitizeAgentRow(row as Record<string, unknown>));
  }

  async enforceHeartbeatTimeouts(now = new Date()): Promise<number> {
    const timingDefaults = await readAgentSupervisionTimingDefaults(this.pool);
    const staleAgents = await this.pool.query(
      `SELECT id, tenant_id, status, heartbeat_interval_seconds, last_heartbeat_at, current_task_id
       FROM agents
       WHERE (
         status IN ('active', 'idle', 'busy', 'degraded')
       )
         AND last_heartbeat_at IS NOT NULL
         AND last_heartbeat_at < ($1::timestamptz - (heartbeat_interval_seconds * $2::double precision * INTERVAL '1 second'))`,
      [now, timingDefaults.heartbeatThresholdMultiplier],
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
        const heartbeatCutoffMs =
          Number(agent.heartbeat_interval_seconds) * timingDefaults.heartbeatThresholdMultiplier * 1000;
        const lastHeartbeatMs = new Date(agent.last_heartbeat_at as string | Date).getTime();
        const failAfterMs = lastHeartbeatMs + heartbeatCutoffMs + timingDefaults.heartbeatGracePeriodMs;

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
             WHERE tenant_id = $1 AND id = $2 AND state IN ('claimed', 'in_progress')`,
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

function normalizeAgentRoutingTags(
  routingTags: string[],
  executionMode: NonNullable<RegisterAgentInput['execution_mode']>,
): string[] {
  const values = new Set(routingTags.map((routingTag) => routingTag.trim()).filter(Boolean));
  if (executionMode === 'orchestrator' || executionMode === 'hybrid') {
    values.add('orchestrator');
  }
  return [...values];
}

function sanitizeAgentRow(row: Record<string, unknown>) {
  return {
    ...row,
    metadata: sanitizeSecretLikeRecord(row.metadata, AGENT_REDACTION_OPTIONS),
  };
}
