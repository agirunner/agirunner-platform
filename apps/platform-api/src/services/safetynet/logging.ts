import { randomUUID } from 'node:crypto';

import { getRequestContext } from '../../observability/request-context.js';
import { createLogger } from '../../observability/logger.js';
import { safetynetTriggerCounter } from '../../observability/metrics.js';
import type { SafetynetEntry } from './types.js';

const logger = createLogger(process.env.LOG_LEVEL ?? 'debug');

export function logSafetynetTriggered(
  entry: SafetynetEntry,
  triggerReason: string,
  payload: Record<string, unknown> = {},
): void {
  safetynetTriggerCounter.inc({ behavior: entry.id });
  const requestContext = getRequestContext();
  logger.warn({
    event_type: 'platform.safetynet.triggered',
    safetynet_behavior_id: entry.id,
    classification: entry.classification,
    mechanism: entry.mechanism,
    layer: entry.layer,
    trigger_reason: triggerReason,
    request_id: requestContext?.requestId ?? randomUUID(),
    workflow_id: requestContext?.workflowId ?? null,
    task_id: requestContext?.taskId ?? null,
    ...payload,
  });
}
