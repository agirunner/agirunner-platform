import { randomUUID } from 'node:crypto';

import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabasePool } from '../db/database.js';
import { EventService } from './event-service.js';
import {
  advanceScheduledFireAt,
  buildScheduledWorkItem,
  type ScheduledWorkItemTriggerRow,
} from './scheduled-work-item-trigger-helpers.js';
import type { WorkflowService } from './workflow-service.js';

interface InvocationRow {
  work_item_id: string | null;
}

export interface FireDueScheduledWorkItemTriggersResult {
  claimed: number;
  fired: number;
  duplicates: number;
  failed: number;
}

const DEFAULT_CLAIM_BATCH_SIZE = 25;
const DEFAULT_LEASE_DURATION_MS = 30_000;

export class ScheduledWorkItemTriggerExecutor {
  constructor(
    private readonly pool: DatabasePool,
    private readonly eventService: EventService,
    private readonly workflowService: WorkflowService,
    private readonly claimBatchSize = DEFAULT_CLAIM_BATCH_SIZE,
    private readonly leaseDurationMs = DEFAULT_LEASE_DURATION_MS,
  ) {}

  async fireDueTriggers(now = new Date()): Promise<FireDueScheduledWorkItemTriggersResult> {
    const claimed = await this.claimDueTriggers(now);
    const result: FireDueScheduledWorkItemTriggersResult = {
      claimed: claimed.length,
      fired: 0,
      duplicates: 0,
      failed: 0,
    };

    for (const trigger of claimed) {
      const fired = await this.fireClaimedTrigger(trigger);
      result.fired += fired.fired;
      result.duplicates += fired.duplicates;
      result.failed += fired.failed;
    }

    return result;
  }

  private async fireClaimedTrigger(trigger: ScheduledWorkItemTriggerRow) {
    const scheduledFor = trigger.next_fire_at;
    const built = buildScheduledWorkItem(trigger, scheduledFor);
    const identity = triggerIdentity(trigger);

    try {
      const existing = await this.findExistingInvocation(trigger, scheduledFor);
      if (existing?.work_item_id) {
        await this.completeClaim(trigger, scheduledFor, existing.work_item_id);
        return { fired: 0, duplicates: 1, failed: 0 };
      }

      const createdWorkItem = await this.workflowService.createWorkflowWorkItem(identity, trigger.workflow_id, {
        ...built.input,
        request_id: built.requestId,
      });

      await this.recordInvocationSuccess(trigger, scheduledFor, createdWorkItem.id);
      await this.completeClaim(trigger, scheduledFor, createdWorkItem.id);
      await this.emitFiredEvent(trigger, scheduledFor, createdWorkItem.id);
      return { fired: 1, duplicates: 0, failed: 0 };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Scheduled trigger execution failed';
      await this.recordInvocationFailure(trigger, scheduledFor, message);
      await this.releaseClaim(trigger);
      return { fired: 0, duplicates: 0, failed: 1 };
    }
  }

  private async claimDueTriggers(now: Date) {
    const leaseToken = randomUUID();
    const leaseExpiresAt = new Date(now.getTime() + this.leaseDurationMs);
    const result = await this.pool.query<ScheduledWorkItemTriggerRow>(
      `WITH due AS (
         SELECT id
           FROM scheduled_work_item_triggers
          WHERE is_active = true
            AND next_fire_at <= $1
            AND (lease_expires_at IS NULL OR lease_expires_at <= $1)
          ORDER BY next_fire_at ASC
          LIMIT $2
          FOR UPDATE SKIP LOCKED
       )
       UPDATE scheduled_work_item_triggers scheduled_trigger
          SET lease_token = $3,
              lease_expires_at = $4,
              updated_at = now()
         FROM due
        WHERE scheduled_trigger.id = due.id
      RETURNING scheduled_trigger.*`,
      [now, this.claimBatchSize, leaseToken, leaseExpiresAt],
    );
    return result.rows;
  }

  private async completeClaim(trigger: ScheduledWorkItemTriggerRow, scheduledFor: Date, workItemId: string) {
    const nextFireAt = advanceScheduledFireAt(scheduledFor, trigger.cadence_minutes);
    await this.pool.query(
      `UPDATE scheduled_work_item_triggers
          SET last_fired_at = $3,
              next_fire_at = $4,
              lease_token = NULL,
              lease_expires_at = NULL,
              updated_at = now()
        WHERE tenant_id = $1
          AND id = $2
          AND lease_token = $5`,
      [trigger.tenant_id, trigger.id, scheduledFor, nextFireAt, trigger.lease_token],
    );
    await this.pool.query(
      `UPDATE scheduled_work_item_trigger_invocations
          SET work_item_id = COALESCE(work_item_id, $4),
              status = 'created',
              error = NULL
        WHERE tenant_id = $1
          AND trigger_id = $2
          AND scheduled_for = $3`,
      [trigger.tenant_id, trigger.id, scheduledFor, workItemId],
    );
  }

  private async releaseClaim(trigger: ScheduledWorkItemTriggerRow) {
    await this.pool.query(
      `UPDATE scheduled_work_item_triggers
          SET lease_token = NULL,
              lease_expires_at = NULL,
              updated_at = now()
        WHERE tenant_id = $1
          AND id = $2
          AND lease_token = $3`,
      [trigger.tenant_id, trigger.id, trigger.lease_token],
    );
  }

  private async findExistingInvocation(trigger: ScheduledWorkItemTriggerRow, scheduledFor: Date) {
    const result = await this.pool.query<InvocationRow>(
      `SELECT work_item_id
         FROM scheduled_work_item_trigger_invocations
        WHERE tenant_id = $1
          AND trigger_id = $2
          AND scheduled_for = $3
        LIMIT 1`,
      [trigger.tenant_id, trigger.id, scheduledFor],
    );
    return result.rows[0] ?? null;
  }

  private async recordInvocationSuccess(trigger: ScheduledWorkItemTriggerRow, scheduledFor: Date, workItemId: string) {
    await this.pool.query(
      `INSERT INTO scheduled_work_item_trigger_invocations (
         tenant_id, trigger_id, scheduled_for, work_item_id, status
       ) VALUES ($1,$2,$3,$4,'created')
       ON CONFLICT (trigger_id, scheduled_for)
       DO UPDATE
         SET work_item_id = COALESCE(scheduled_work_item_trigger_invocations.work_item_id, EXCLUDED.work_item_id),
             status = 'created',
             error = NULL`,
      [trigger.tenant_id, trigger.id, scheduledFor, workItemId],
    );
  }

  private async recordInvocationFailure(trigger: ScheduledWorkItemTriggerRow, scheduledFor: Date, error: string) {
    await this.pool.query(
      `INSERT INTO scheduled_work_item_trigger_invocations (
         tenant_id, trigger_id, scheduled_for, status, error
       ) VALUES ($1,$2,$3,'failed',$4)
       ON CONFLICT (trigger_id, scheduled_for)
       DO UPDATE
         SET status = 'failed',
             error = EXCLUDED.error`,
      [trigger.tenant_id, trigger.id, scheduledFor, error],
    );
  }

  private async emitFiredEvent(trigger: ScheduledWorkItemTriggerRow, scheduledFor: Date, workItemId: string) {
    try {
      await this.eventService.emit({
        tenantId: trigger.tenant_id,
        type: 'trigger.fired',
        entityType: 'workflow',
        entityId: trigger.workflow_id,
        actorType: 'system',
        actorId: `trigger:${trigger.id}`,
        data: {
          trigger_id: trigger.id,
          source: trigger.source,
          workflow_id: trigger.workflow_id,
          work_item_id: workItemId,
          scheduled_for: scheduledFor.toISOString(),
          trigger_kind: 'schedule',
        },
      });
    } catch {
      return;
    }
  }
}

function triggerIdentity(trigger: ScheduledWorkItemTriggerRow): ApiKeyIdentity {
  return {
    id: `trigger:${trigger.id}`,
    tenantId: trigger.tenant_id,
    scope: 'admin',
    ownerType: 'scheduled_trigger',
    ownerId: null,
    keyPrefix: `trigger:${trigger.id}`,
  };
}
