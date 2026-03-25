export interface TaskContextFact {
  label: string;
  value: string;
}

export interface TaskContextPacket {
  summary: string;
  facts: TaskContextFact[];
}

const CONTINUITY_METRIC_LABELS: Array<[key: string, label: string]> = [
  ['effective_context_strategy', 'Context strategy'],
  ['context_warnings', 'Context warnings'],
  ['context_compactions', 'Context compactions'],
  ['context_compaction_tokens_saved', 'Tokens saved'],
  ['activation_finish_prepares', 'Activation finish prepares'],
  ['activation_finish_checkpoint_writes', 'Activation checkpoints'],
  ['activation_finish_memory_writes', 'Activation memory writes'],
  ['activation_finish_continuity_writes', 'Activation continuity writes'],
];

export function buildClarificationPacket({
  answers,
  history,
}: {
  answers: Record<string, unknown>;
  history: Array<{
    answered_at?: string;
    answered_by?: string;
  }>;
}): TaskContextPacket {
  const answerCount = Object.keys(answers).length;
  const roundCount = history.length;
  const latestEntry = history[0] ?? null;

  return {
    summary:
      answerCount > 0 || roundCount > 0
        ? `${formatCount(answerCount, 'captured answer')} across ${formatCount(roundCount, 'clarification round')}.`
        : 'No clarification requests or answers are recorded for this step.',
    facts: [
      { label: 'Captured answers', value: String(answerCount) },
      { label: 'Clarification rounds', value: String(roundCount) },
      { label: 'Latest responder', value: latestEntry?.answered_by ?? 'No responder recorded' },
      { label: 'Latest response', value: latestEntry?.answered_at ?? 'No response time recorded' },
    ],
  };
}

export function buildEscalationPacket({
  escalationResponse,
  reviewSignals,
}: {
  escalationResponse: Record<string, unknown>;
  reviewSignals: {
    escalationAwaitingHuman: boolean;
    escalationTarget?: string;
    escalationReason?: string;
  };
}): TaskContextPacket {
  const responseFieldCount = Object.keys(escalationResponse).length;
  const hasResponse = responseFieldCount > 0;
  let summary = 'No human escalation response is recorded for this step.';

  if (reviewSignals.escalationAwaitingHuman) {
    summary = hasResponse
      ? 'A human escalation response is recorded, and the step is still waiting on follow-up.'
      : 'The step is waiting on a human escalation response before work can continue.';
  } else if (hasResponse) {
    summary = 'Human escalation guidance is recorded and ready for operator review.';
  }

  return {
    summary,
    facts: [
      {
        label: 'Awaiting human',
        value: reviewSignals.escalationAwaitingHuman ? 'Yes' : 'No',
      },
      {
        label: 'Escalation target',
        value: reviewSignals.escalationTarget ?? 'No target recorded',
      },
      {
        label: 'Escalation reason',
        value: reviewSignals.escalationReason ?? 'No reason recorded',
      },
      {
        label: 'Response fields',
        value: String(responseFieldCount),
      },
    ],
  };
}

export function buildExecutionPacket({
  verification,
  metrics,
  runtimeContext,
}: {
  verification: Record<string, unknown>;
  metrics: Record<string, unknown>;
  runtimeContext: Record<string, unknown>;
}): TaskContextPacket {
  const verificationCount = Object.keys(verification).length;
  const metricCount = Object.keys(metrics).length;
  const runtimeContextCount = Object.keys(runtimeContext).length;

  return {
    summary:
      verificationCount > 0 || metricCount > 0 || runtimeContextCount > 0
        ? `${formatCount(verificationCount, 'verification field')}, ${formatCount(metricCount, 'execution metric')}, and ${formatCount(runtimeContextCount, 'agent context field')} are available for deeper review.`
        : 'No verification fields, execution metrics, or agent context are recorded for this step yet.',
    facts: [
      { label: 'Verification fields', value: String(verificationCount) },
      { label: 'Execution metrics', value: String(metricCount) },
      { label: 'Agent context fields', value: String(runtimeContextCount) },
      {
        label: 'Most detailed source',
        value: selectMostDetailedSource(verificationCount, metricCount, runtimeContextCount),
      },
    ],
  };
}

export function buildContinuityHighlightFacts({
  metrics,
  activationCheckpoint,
  limit = 4,
}: {
  metrics: Record<string, unknown>;
  activationCheckpoint: Record<string, unknown>;
  limit?: number;
}): TaskContextFact[] {
  const facts: TaskContextFact[] = [];

  for (const [key, label] of CONTINUITY_METRIC_LABELS) {
    if (!(key in metrics)) {
      continue;
    }
    facts.push({
      label,
      value: summarizeValue(metrics[key]),
    });
    if (facts.length >= limit) {
      return facts;
    }
  }

  const checkpointFacts: Array<[keyof typeof activationCheckpoint, string]> = [
    ['trigger', 'Checkpoint trigger'],
    ['next_expected_event', 'Next expected event'],
    ['current_working_state', 'Working state'],
  ];
  for (const [key, label] of checkpointFacts) {
    const value = activationCheckpoint[key];
    if (typeof value !== 'string' || value.trim().length === 0) {
      continue;
    }
    facts.push({ label, value: summarizeValue(value) });
    if (facts.length >= limit) {
      return facts;
    }
  }

  return facts;
}

export function buildActivationCheckpointPacket(
  checkpoint: Record<string, unknown>,
): TaskContextPacket {
  const trigger = typeof checkpoint.trigger === 'string' ? checkpoint.trigger : null;
  const nextExpectedEvent =
    typeof checkpoint.next_expected_event === 'string'
      ? checkpoint.next_expected_event
      : null;
  const importantIds = Array.isArray(checkpoint.important_ids)
    ? checkpoint.important_ids.length
    : 0;
  const recentMemoryKeys = Array.isArray(checkpoint.recent_memory_keys)
    ? checkpoint.recent_memory_keys.length
    : 0;

  return {
    summary:
      Object.keys(checkpoint).length === 0
        ? 'No orchestrator activation checkpoint is recorded for this step.'
        : `Latest orchestrator activation checkpoint captures ${importantIds} important ids and records the next expected event.`,
    facts: [
      {
        label: 'Checkpoint trigger',
        value: trigger ?? 'No trigger recorded',
      },
      {
        label: 'Next expected event',
        value: nextExpectedEvent ?? 'No next event recorded',
      },
      {
        label: 'Important ids',
        value: String(importantIds),
      },
      {
        label: 'Recent memory keys',
        value: String(recentMemoryKeys),
      },
    ],
  };
}

export function buildPreviewFacts(
  record: Record<string, unknown>,
  limit = 4,
): TaskContextFact[] {
  return Object.entries(record)
    .slice(0, limit)
    .map(([key, value]) => ({
      label: humanizeKey(key),
      value: summarizeValue(value),
    }));
}

function selectMostDetailedSource(
  verificationCount: number,
  metricCount: number,
  runtimeContextCount: number,
) {
  if (verificationCount >= metricCount && verificationCount >= runtimeContextCount) {
    return verificationCount > 0 ? 'Verification' : 'No execution data';
  }
  if (metricCount >= runtimeContextCount) {
    return 'Execution metrics';
  }
  return 'Agent context';
}

function humanizeKey(value: string) {
  return value.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function summarizeValue(value: unknown): string {
  if (typeof value === 'string') {
    return value.length > 48 ? `${value.slice(0, 45)}...` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return formatCount(value.length, 'item');
  }
  if (value && typeof value === 'object') {
    return formatCount(Object.keys(value as Record<string, unknown>).length, 'field');
  }
  return 'No value';
}

function formatCount(value: number, noun: string) {
  return `${value} ${noun}${value === 1 ? '' : 's'}`;
}
